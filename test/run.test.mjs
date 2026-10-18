// Build step 4: one task from its file to a commit on its task branch. The
// agent is scripted — each attempt is a function that edits the working tree
// the way an agent would and returns what invoke() returns — so what is tested
// is detent's loop, against a real git repository and a real gauge.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failures } from '../core/doctor.mjs'
import { snapshotRefs } from '../core/git.mjs'
import { scanProduct } from '../core/scan.mjs'
import { createQueue, readQueue } from '../core/task.mjs'
import { readJournal } from '../core/journal.mjs'
import { runTask } from '../core/run.mjs'
import { assertInvariant, gitProduct, sh, show } from './support/product.mjs'

const BRANCH = 'agent/task-0042-wallet-endpoint'
// Green when value.txt says "ok".
const GAUGE = { exit: [{ stage: 'lint', command: 'true' }, { stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok || { echo "value is $(cat value.txt 2>/dev/null)"; exit 1; }' }] }

function setup(repo = {}, productOverrides = {}) {
  const context = gitProduct({ gauge: GAUGE, models: { implement: { agent: 'claude', model: 'claude-opus-5' } }, ...repo }, productOverrides)
  mkdirSync(join(context.dir, 'tasks', 'todo'), { recursive: true })
  writeFileSync(
    join(context.dir, 'tasks', 'todo', '0042-wallet-endpoint.md'),
    '---\nid: 0042\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n',
  )
  const [task] = readQueue(context.dir, context.product)
  return { ...context, task, before: snapshotRefs(context.repoDir) }
}

function answer(message = 'Done.\nCommit: feat(wallet): balance endpoint', extra = {}) {
  return { agent: 'claude', ok: true, message, model: { requested: 'claude-opus-5', actual: 'claude-opus-5' }, cost: { usd: 0.25, tokens: { input: 1000, output: 100 } }, session: 's', error: null, ms: 10, ...extra }
}

// An agent that runs `steps` in order, one per attempt, and records its prompts.
function agent(...steps) {
  const prompts = []
  const invoke = async (role, { cwd, prompt }) => {
    prompts.push(prompt)
    const step = steps[prompts.length - 1]
    if (!step) throw new Error(`no step for attempt ${prompts.length}`)
    return (await step(cwd)) ?? answer()
  }
  return { invoke, prompts }
}

const write = (value) => (cwd) => writeFileSync(join(cwd, 'value.txt'), `${value}\n`)

function notifier() {
  const sent = []
  return { sent, notify: (product, details) => (sent.push(details), { sent: true, via: 'test' }) }
}

test('green on the first attempt: one commit, merged into agent/dev, the branch deleted, the task done', async () => {
  const s = setup()
  const a = agent(write('ok'))
  const n = notifier()
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'passed')
  assert.equal(result.merged, true)
  assert.equal(result.attempts, 1)
  assert.equal(result.lock, 'enforced')
  assert.equal(result.branch, BRANCH)
  assert.equal(result.commit, sh(s.repoDir, 'rev-parse', 'agent/dev'), 'the commit recorded is the one that landed')
  assert.deepEqual(result.models.implement, { agent: 'claude', requested: 'claude-opus-5', actual: 'claude-opus-5' })
  assert.deepEqual(result.cost, { usd: 0.25, tokens: { input: 1000, output: 100 } })
  assert.equal(result.kind, 'task')
  assert.ok(result.started <= result.finished)

  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev^2'), 'feat(wallet): balance endpoint\n\nTask: 0042\nGauge: lint ✓ test ✓ (1 attempt)\nAgent: claude (claude-opus-5)')
  assert.equal(
    sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev').trimEnd(),
    'merge: task 0042 — feat(wallet): balance endpoint\n\nTask: 0042\nGauge: lint ✓ test ✓ (exit) · no gauge declared (merge)\nAgent: claude (claude-opus-5)\nAcceptance: none declared',
  )
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev^1'), sh(s.repoDir, 'rev-parse', 'dev'), 'one merge commit on top of where agent/dev was')
  assert.equal(show(s.repoDir, 'agent/dev', 'value.txt'), 'ok')
  assert.equal(sh(s.repoDir, 'branch', '--list', BRANCH), '', 'a passed task branch is deleted')
  assertInvariant(s.repoDir, s.before, s.product)
  assert.ok(existsSync(join(s.dir, 'tasks', 'done', '0042-wallet-endpoint.md')))
  assert.deepEqual(n.sent, [])
})

test('the prompt carries the task, the rules, and the gauge it is held to', async () => {
  const s = setup()
  const a = agent(write('ok'))
  await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  const [prompt] = a.prompts
  assert.match(prompt, /task 0042 in the repository "acme-api"/)
  assert.match(prompt, /The branch agent\/task-0042-wallet-endpoint is checked out/)
  assert.match(prompt, /Do not switch branches, commit, merge, rebase, stash or push/)
  assert.match(prompt, / {4}lint: true\n/)
  assert.match(prompt, /# Acceptance criteria\n\n- \[ \] value.txt says ok/)
  assert.doesNotMatch(prompt, /^id: 0042$/m, 'the frontmatter is bookkeeping, not prompt')
  assert.match(prompt, /Commit: feat\(wallet\)/)
  assert.doesNotMatch(prompt, /Attempt \d of/)
  assert.doesNotMatch(prompt, /shared context/, 'a repository that mounts nothing hears nothing about submodules')
})

test('red, then green: the retry is handed the failed stage and its output', async () => {
  const s = setup()
  const a = agent(write('nearly'), write('ok'))
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.equal(result.attempts, 2)
  assert.deepEqual(result.cost, { usd: 0.5, tokens: { input: 2000, output: 200 } }, 'cost is per pass, every attempt counted')
  assert.match(a.prompts[1], /Attempt 2 of 3\. Your previous attempt did not leave the gauge green\./)
  assert.match(a.prompts[1], /stage "test"/)
  assert.match(a.prompts[1], /value is nearly/)
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev^2'), /^Gauge: lint ✓ test ✓ \(2 attempts\)$/m)
  assertInvariant(s.repoDir, s.before, s.product)
})

test('red on the last attempt: paused in hold/, work parked with its outcome, the developer told', async () => {
  const s = setup()
  const a = agent(write('no'), write('no'), write('no'))
  const n = notifier()
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'escalated')
  assert.equal(result.reason, '3 identical failures on test')
  assert.equal(result.attempts, 3)
  assert.equal(result.gauge.failedStage, 'test')
  assert.equal(result.commit, null)
  assert.equal(a.prompts.length, 3, 'no fourth attempt')
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md')))
  assert.ok(!existsSync(join(s.dir, 'tasks', 'todo', '0042-wallet-endpoint.md')))

  assert.equal(n.sent.length, 1)
  assert.equal(n.sent[0].outcome, 'escalated')
  assert.equal(n.sent[0].branch, BRANCH)
  assert.match(n.sent[0].message, /task 0042 \(acme-api\) is paused — escalated: 3 identical failures on test/)
  assert.match(n.sent[0].message, /The work is on agent\/task-0042-wallet-endpoint; move tasks\/hold\/0042-wallet-endpoint\.md back to todo\/ to resume\./)

  assert.equal(
    sh(s.repoDir, 'log', '-1', '--format=%B', BRANCH),
    'wip(wallet-endpoint): attempt 3, gauge red on test\n\nTask: 0042\nGauge: lint ✓ test ✗\nOutcome: escalated — 3 identical failures on test\nAgent: claude (claude-opus-5)',
  )
  assert.equal(show(s.repoDir, BRANCH, 'value.txt'), 'no')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a paused task moved back to todo/ resumes on its branch, and the agent is told', async () => {
  const s = setup()
  await runTask(s.product, s.repo, s.task, { invoke: agent(write('no'), write('no'), write('no')).invoke, notify: notifier().notify })
  const parked = sh(s.repoDir, 'rev-parse', BRANCH)
  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])

  const [task] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const a = agent((cwd) => {
    assert.equal(readFileSync(join(cwd, 'value.txt'), 'utf8'), 'no\n', 'the parked work is in the tree')
    write('ok')(cwd)
  })
  const result = await runTask(s.product, s.repo, task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.equal(result.resumed, true)
  assert.match(a.prompts[0], /This task was paused and is being resumed/)
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev^2~1'), parked, 'the resumed work builds on the parked attempt')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('an agent error pauses the task, keeps the work and says why', async () => {
  const s = setup()
  const n = notifier()
  const a = agent((cwd) => {
    write('half')(cwd)
    return answer('', { ok: false, error: 'usage limit reached', cost: { usd: 0.1, tokens: null } })
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })
  assert.equal(result.outcome, 'error')
  assert.equal(result.reason, 'the agent failed: usage limit reached')
  assert.equal(result.cost.usd, 0.1, 'a failed attempt still cost what it cost')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', BRANCH), /^Outcome: error — the agent failed: usage limit reached$/m)
  assert.equal(show(s.repoDir, BRANCH, 'value.txt'), 'half')
  assert.equal(n.sent[0].outcome, 'error')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('green with nothing changed is not a pass', async () => {
  const s = setup({ gauge: { exit: [{ stage: 'test', command: 'true' }] } })
  const result = await runTask(s.product, s.repo, s.task, { invoke: agent(() => {}).invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.equal(result.reason, 'the gauge is green but the agent changed nothing')
  assert.equal(sh(s.repoDir, 'rev-parse', BRANCH), sh(s.repoDir, 'rev-parse', 'agent/dev'), 'no empty commit left behind')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('an agent that committed its own work still gets detent\'s commit, with the trailers', async () => {
  const s = setup()
  const a = agent((cwd) => {
    write('ok')(cwd)
    sh(cwd, 'add', '.')
    sh(cwd, 'commit', '--quiet', '-m', 'my own message')
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev^2'), /^Task: 0042$/m)
  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%s', 'agent/dev^2~1'), 'my own message')
})

test('an agent that commits to agent/dev has it restored, and its commits kept on a branch of their own', async () => {
  const s = setup()
  const devTip = sh(s.repoDir, 'rev-parse', 'agent/dev')
  const a = agent((cwd) => {
    sh(cwd, 'switch', '--quiet', 'agent/dev')
    write('ok')(cwd)
    sh(cwd, 'add', '.')
    sh(cwd, 'commit', '--quiet', '-m', 'straight onto integration')
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.match(result.reason, /the agent committed to agent\/dev; it is restored, and those commits are kept on agent\/task-0042-wallet-endpoint-stray/)
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), devTip)
  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%s', `${BRANCH}-stray`), 'straight onto integration')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('an agent that moves a human branch is named, and the branch is not touched by detent', async () => {
  const s = setup()
  const a = agent((cwd) => {
    write('ok')(cwd)
    sh(cwd, 'commit', '--quiet', '-am', 'x', '--allow-empty')
    sh(cwd, 'branch', '--force', 'feature/human-work', 'HEAD')
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.match(result.reason, /the agent moved refs\/heads\/feature\/human-work — detent does not write outside agent\/, so this is left for you/)
  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%s', 'feature/human-work'), 'x', 'still where the agent left it: not ours to move back')
})

test('neverCommit paths are left out of the commit', async () => {
  const s = setup({ neverCommit: ['shared-docs'] })
  const a = agent((cwd) => {
    write('ok')(cwd)
    mkdirSync(join(cwd, 'shared-docs'))
    writeFileSync(join(cwd, 'shared-docs', 'pointer'), 'moved\n')
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.equal(show(s.repoDir, 'agent/dev', 'value.txt'), 'ok')
  assert.throws(() => show(s.repoDir, 'agent/dev', 'shared-docs/pointer'))
  assert.match(a.prompts[0], /Do not change "shared-docs"/)
  assertInvariant(s.repoDir, s.before, s.product)
})

test('no gauge: landed with lock absent, never called green', async () => {
  const s = setup({ gauge: undefined })
  const a = agent(write('anything'))
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.equal(result.lock, 'absent')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev^2'), /^Gauge: no gauge declared \(1 attempt\)$/m)
  assert.match(a.prompts[0], /declares no gauge, so nothing checks your work/)
})

test('a malformed Commit: line falls back to a subject detent writes', async () => {
  const s = setup()
  const a = agent((cwd) => (write('ok')(cwd), answer('I did it.\nCommit: Fixed stuff.')))
  await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%s', 'agent/dev^2'), 'feat: task 0042, wallet endpoint')
})

test('a gate refusal skips the task and leaves it in todo/', async () => {
  const s = setup()
  writeFileSync(join(s.repoDir, 'scratch.txt'), 'mine')
  const a = agent()
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'skipped')
  assert.match(result.reason, /not clean/)
  assert.equal(a.prompts.length, 0)
  assert.ok(existsSync(join(s.dir, 'tasks', 'todo', '0042-wallet-endpoint.md')))
})

// --- detent run, end to end, with a fake Claude Code on PATH -----------------

test('detent run works the queue with a real CLI process standing in for the agent', () => {
  const s = setup()
  mkdirSync(join(s.dir, 'tasks', 'hold'))
  const bin = mkdtempSync(join(tmpdir(), 'detent-bin-'))
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh
cat > /dev/null
echo ok > value.txt
printf '%s' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Commit: feat(wallet): from the cli', total_cost_usd: 0.3, usage: { input_tokens: 5, output_tokens: 7 }, modelUsage: { 'claude-opus-5': { outputTokens: 7 } }, session_id: 'x' })}'
`,
  )
  chmodSync(join(bin, 'claude'), 0o755)
  const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  assert.match(out, /^0042 {2}passed — merged into agent\/dev \([0-9a-f]{7}\), 1 attempt, \$0\.30$/m)
  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%s', 'agent/dev^2'), 'feat(wallet): from the cli')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('detent run refuses to start when a repository has no implementing agent', () => {
  const s = setup({ models: undefined })
  let error
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    error = e
  }
  assert.equal(error.status, 2)
  assert.match(error.stderr, /no implementing agent for acme-api — set models\.implement/)
  assert.deepEqual(snapshotRefs(s.repoDir), s.before)
})

// A declared agent that is not installed used to be found out when it was
// invoked — after the task branch existed and the workspace had been taken.
// doctor has asked that question since step 7, and this is a run asking it
// before it starts anything (§12).
test('detent run refuses on what doctor already fails, before any branch is created', () => {
  const s = setup()
  let refused
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir], {
      encoding: 'utf8',
      stdio: 'pipe',
      // product.json declares claude, and nothing on this PATH is claude.
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' },
    })
  } catch (e) {
    refused = e
  }
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /^detent run: nothing was started — detent doctor fails a check on what this task needs:$/m)
  assert.match(refused.stderr, /^ {2}claude is not on PATH \(implement\) — whether it is signed in shows only when it runs$/m, "doctor's own sentence, not a second one")
  assert.match(refused.stderr, /^detent doctor for the rest\.$/m)
  assert.doesNotMatch(refused.stderr, /one person per workspace|clean tree|full clone/, 'the report is a command away, and not reprinted here')
  assert.deepEqual(snapshotRefs(s.repoDir), s.before, 'no branch was created')
  assert.ok(existsSync(join(s.dir, 'tasks', 'todo', '0042-wallet-endpoint.md')), 'and the task is still queued')
})

test('a doctor failure in a repository no queued task mentions leaves the run alone', () => {
  const s = setup()
  // A second repository, declared and not in shape — no agent/dev, which
  // doctor calls a failure — and nothing is queued for it.
  const web = join(s.dir, 'acme-web')
  mkdirSync(web)
  sh(web, 'init', '--quiet', '--initial-branch=dev')
  sh(web, 'config', 'user.name', 'P')
  sh(web, 'config', 'user.email', 'p@x')
  writeFileSync(join(web, 'README.md'), 'web\n')
  sh(web, 'add', '.')
  sh(web, 'commit', '--quiet', '-m', 'init')
  const file = join(s.dir, '.detent', 'product.json')
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.repos.push({ name: 'acme-web', compare: 'dev' })
  writeFileSync(file, JSON.stringify(raw))

  const scan = scanProduct(s.dir, { queue: s.product.queue })
  assert.ok(
    failures(s.dir, scan, ['acme-web']).some((c) => c.repo === 'acme-web' && /agent\/dev does not exist/.test(c.text)),
    'doctor does fail on it, when it is asked about',
  )
  assert.deepEqual(failures(s.dir, scan, ['acme-api']).filter((c) => c.repo === 'acme-web'), [], 'and is not asked about it for a task in another repository')

  const bin = mkdtempSync(join(tmpdir(), 'detent-bin-'))
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh
cat > /dev/null
echo ok > value.txt
printf '%s' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Commit: feat(wallet): balance endpoint', total_cost_usd: 0.3, usage: { input_tokens: 5, output_tokens: 7 }, session_id: 'x' })}'
`,
  )
  chmodSync(join(bin, 'claude'), 0o755)
  const out = execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  assert.match(out, /^0042 {2}passed — merged into agent\/dev/m, 'a run would not have touched acme-web, so it was never asked about it')
  assert.equal(sh(web, 'branch', '--list', 'agent/*'), '', 'and nothing was created there')
})

// --- build step 5: landing on agent/dev --------------------------------------

test('the merge gauge runs on the merged tree; red leaves agent/dev where it was and pauses the task', async () => {
  const s = setup({ gauge: { ...GAUGE, merge: [{ stage: 'build', command: 'test -f value.txt && test -f README.md && echo "build broke" && exit 1' }] } })
  const devTip = sh(s.repoDir, 'rev-parse', 'agent/dev')
  const n = notifier()
  const result = await runTask(s.product, s.repo, s.task, { invoke: agent(write('ok')).invoke, notify: n.notify })
  assert.equal(result.outcome, 'escalated')
  assert.equal(result.reason, 'the merge gauge is red on build')
  assert.deepEqual(result.gauge, { profile: 'merge', failedStage: 'build' })
  assert.equal(result.merged, false)
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), devTip, 'agent/dev never saw the red merge')
  assert.equal(show(s.repoDir, BRANCH, 'value.txt'), 'ok', 'the green task commit is kept on its branch')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', BRANCH), /^Gauge: lint ✓ test ✓ \(1 attempt\)$/m, 'nothing parked on top of it')
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md')))
  assert.equal(n.sent.length, 1)
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a green merge gauge is part of the merge commit', async () => {
  const s = setup({ gauge: { ...GAUGE, merge: [{ stage: 'build', command: 'test -f value.txt' }] } })
  const result = await runTask(s.product, s.repo, s.task, { invoke: agent(write('ok')).invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev'), /^Gauge: lint ✓ test ✓ \(exit\) · build ✓ \(merge\)$/m)
})

test('a conflict with agent/dev is aborted, never resolved, and the task paused with the paths named', async () => {
  const s = setup()
  // Task 0042 is paused; meanwhile task 0043 lands a different value.txt.
  await runTask(s.product, s.repo, s.task, { invoke: agent(write('no'), write('no'), write('no')).invoke, notify: notifier().notify })
  writeFileSync(
    join(s.dir, 'tasks', 'todo', '0043-other.md'),
    '---\nid: 0043\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n',
  )
  const other = readQueue(s.dir, s.product).find((t) => t.id === '0043')
  const landed = await runTask(s.product, s.repo, other, {
    invoke: agent((cwd) => (write('ok')(cwd), writeFileSync(join(cwd, 'notes.txt'), 'from 0043\n'))).invoke,
    notify: notifier().notify,
  })
  assert.equal(landed.outcome, 'passed')
  const devTip = sh(s.repoDir, 'rev-parse', 'agent/dev')

  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])
  const [resumed] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const n = notifier()
  const result = await runTask(s.product, s.repo, resumed, {
    invoke: agent((cwd) => (write('ok')(cwd), writeFileSync(join(cwd, 'notes.txt'), 'from 0042\n'))).invoke,
    notify: n.notify,
  })
  assert.equal(result.outcome, 'escalated')
  assert.equal(result.reason, 'merging into agent/dev conflicts in notes.txt')
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), devTip)
  assert.ok(sh(s.repoDir, 'branch', '--list', BRANCH), 'the branch is kept for a person to look at')
  assert.match(n.sent[0].message, /conflicts in notes\.txt\. Resolve it on the task branch — git switch agent\/task-0042-wallet-endpoint && git merge agent\/dev — then move tasks\/hold\/0042-wallet-endpoint\.md back to todo\/\./)
  assert.deepEqual(result.conflicts, ['notes.txt'])
  assertInvariant(s.repoDir, s.before, s.product)

  // The person's step: bring agent/dev in and resolve, on the task branch.
  sh(s.repoDir, 'switch', '--quiet', BRANCH)
  assert.throws(() => sh(s.repoDir, 'merge', '--quiet', 'agent/dev'))
  writeFileSync(join(s.repoDir, 'notes.txt'), 'from 0042 and 0043\n')
  sh(s.repoDir, 'commit', '--quiet', '-am', 'resolve the conflict with 0043')
  sh(s.repoDir, 'switch', '--quiet', 'agent/dev')
  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])

  const [again] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const prompts = agent((cwd) => writeFileSync(join(cwd, 'value.txt'), 'ok\n'))
  const finished = await runTask(s.product, s.repo, again, { invoke: prompts.invoke, notify: notifier().notify })
  assert.equal(finished.outcome, 'passed', finished.reason)
  assert.equal(show(s.repoDir, 'agent/dev', 'notes.txt'), 'from 0042 and 0043')
})

test('merge hooks do not run', async () => {
  const s = setup()
  for (const hook of ['pre-merge-commit', 'commit-msg', 'pre-commit']) {
    writeFileSync(join(s.repoDir, '.git', 'hooks', hook), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  }
  const result = await runTask(s.product, s.repo, s.task, { invoke: agent(write('ok')).invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
})

test('every run leaves exactly one journal line, skipped runs included', async () => {
  const s = setup()
  writeFileSync(join(s.repoDir, 'scratch.txt'), 'mine')
  await runTask(s.product, s.repo, s.task, { invoke: agent().invoke, notify: notifier().notify })
  execFileSync('rm', [join(s.repoDir, 'scratch.txt')])
  const result = await runTask(s.product, s.repo, s.task, { invoke: agent(write('ok')).invoke, notify: notifier().notify })

  const { lines, unreadable } = readJournal(s.dir)
  assert.equal(unreadable, 0)
  assert.deepEqual(lines.map((l) => l.outcome), ['skipped', 'passed'])
  assert.deepEqual(lines[1], JSON.parse(JSON.stringify(result)), 'the line is the result')
  assert.equal(lines[1].kind, 'task')
})

// --- the files that judge the agent ------------------------------------------

for (const [what, edit] of [
  ['.detent/product.json', (dir) => writeFileSync(join(dir, '.detent', 'product.json'), '{"loosened": true}')],
  ['tasks/todo/0042-wallet-endpoint.md', (dir) => writeFileSync(join(dir, 'tasks', 'todo', '0042-wallet-endpoint.md'), '---\nid: 0042\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] nothing\n')],
  ['runs/journal.jsonl', (dir) => (mkdirSync(join(dir, 'runs'), { recursive: true }), writeFileSync(join(dir, 'runs', 'journal.jsonl'), '{"kind":"task","outcome":"passed"}\n'))],
]) {
  test(`an agent that edits ${what} is caught, and the task paused`, async () => {
    const s = setup()
    const a = agent((cwd) => {
      write('ok')(cwd)
      edit(s.dir)
    })
    const n = notifier()
    const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })
    assert.equal(result.outcome, 'error')
    assert.equal(result.reason, `the agent changed ${what} — the files that judge it are not its to edit; look at them before resuming`)
    assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), sh(s.repoDir, 'rev-parse', 'dev'), 'nothing landed')
    assert.equal(n.sent.length, 1)
    assertInvariant(s.repoDir, s.before, s.product)
  })
}

test('an edited gauge never judges the attempt that edited it', async () => {
  const s = setup()
  const a = agent(() => {
    // Leaves value.txt wrong, and makes the gauge on disk always green.
    const raw = JSON.parse(readFileSync(join(s.dir, '.detent', 'product.json'), 'utf8'))
    raw.repos[0].gauge = { exit: [{ stage: 'test', command: 'true' }] }
    writeFileSync(join(s.dir, '.detent', 'product.json'), JSON.stringify(raw))
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.equal(result.merged, false)
})

test('every agent call carries the repository\'s time limit, and a stopped one pauses the task with its work', async () => {
  const s = setup({ timeout: 45 })
  const limits = []
  const n = notifier()
  const result = await runTask(s.product, s.repo, s.task, {
    invoke: async (role, { cwd, timeoutMs }) => {
      limits.push(timeoutMs)
      write('half')(cwd)
      return answer('', { ok: false, error: 'claude ran past the 45-minute limit and was stopped' })
    },
    notify: n.notify,
  })
  assert.deepEqual(limits, [45 * 60_000])
  assert.equal(result.outcome, 'error')
  assert.equal(result.reason, 'the agent failed: claude ran past the 45-minute limit and was stopped')
  assert.equal(show(s.repoDir, BRANCH, 'value.txt'), 'half', 'the work up to the cut is kept')
  assert.equal(n.sent.length, 1)
  assertInvariant(s.repoDir, s.before, s.product)
})

// --- a queue somewhere else ---------------------------------------------------

test('a configured queue is read, written and reported where the product says', async () => {
  const s = gitProduct({ gauge: GAUGE, models: { implement: { agent: 'claude', model: 'claude-opus-5' } } }, { queue: 'agent-loop/tasks' })
  const todo = join(s.dir, 'agent-loop', 'tasks', 'todo')
  mkdirSync(todo, { recursive: true })
  writeFileSync(join(todo, '0042-wallet-endpoint.md'), '---\nid: 0042\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  writeFileSync(join(todo, '0043-paused.md'), '---\nid: 0043\nrepo: acme-api\n---\n\n# Goal\n\nSomething red.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')

  const queued = readQueue(s.dir, s.product)
  assert.deepEqual(queued.map((t) => `${t.folder}/${t.id}`), ['todo/0042', 'todo/0043'], 'the queue is read where it is')

  const green = await runTask(s.product, s.repo, queued[0], { invoke: agent(write('ok')).invoke, notify: notifier().notify })
  assert.equal(green.outcome, 'passed')
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'done', '0042-wallet-endpoint.md')), 'and written where it is')

  // Nothing the person is told names tasks/, which this product does not have.
  const n = notifier()
  const red = await runTask(s.product, s.repo, queued[1], { invoke: agent(write('no'), write('no'), write('no')).invoke, notify: n.notify })
  assert.equal(red.outcome, 'escalated')
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'hold', '0043-paused.md')))
  assert.match(n.sent[0].message, /move agent-loop\/tasks\/hold\/0043-paused\.md back to todo\/ to resume\./)

  assert.equal(existsSync(join(s.dir, 'tasks')), false, 'and the default queue was never touched')
})

test('detent run works a configured queue, and names it in what it prints', () => {
  const s = gitProduct({ gauge: GAUGE, models: { implement: { agent: 'claude', model: 'claude-opus-5' } } }, { queue: 'agent-loop/tasks' })
  const detent = (...args) => execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  const bin = mkdtempSync(join(tmpdir(), 'detent-bin-'))
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh
cat > /dev/null
echo ok > value.txt
printf '%s' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Commit: feat(wallet): from a queue elsewhere', total_cost_usd: 0.3, usage: { input_tokens: 5, output_tokens: 7 }, session_id: 'x' })}'
`,
  )
  chmodSync(join(bin, 'claude'), 0o755)

  // Empty before anything is queued, and it says where it looked.
  createQueue(s.dir, s.product.queue)
  assert.equal(detent(), 'nothing to run: agent-loop/tasks/todo/ is empty\n')

  writeFileSync(
    join(s.dir, 'agent-loop', 'tasks', 'todo', '0042-wallet-endpoint.md'),
    '---\nid: 0042\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n',
  )
  assert.match(detent(), /^0042 {2}passed — merged into agent\/dev \([0-9a-f]{7}\), 1 attempt, \$0\.30$/m)
  assert.equal(sh(s.repoDir, 'log', '-1', '--format=%s', 'agent/dev^2'), 'feat(wallet): from a queue elsewhere')
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'done', '0042-wallet-endpoint.md')))

  let asked
  try {
    detent('0042')
  } catch (error) {
    asked = error
  }
  assert.equal(asked.status, 2, 'asking for a task that is not queued is a usage error')
  assert.match(asked.stderr, /^detent run: not in agent-loop\/tasks\/todo\/: 0042$/m)
  assert.equal(existsSync(join(s.dir, 'tasks')), false, 'and the default queue was never created')
})
