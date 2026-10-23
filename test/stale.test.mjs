// The base of a resumed branch, re-asked before the work (ADR 0026).
//
// Two halves. The trial itself — `wouldConflict` — has to answer the question
// without touching anything, and has to answer "no conflict" for every shape
// that is not one: a branch merely behind, a branch already a descendant, two
// histories with nothing in common. And the run has to stop on a conflict
// before it has asked an agent for anything, with a line that says so.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotRefs, wouldConflict } from '../core/git.mjs'
import { readJournal } from '../core/journal.mjs'
import { runTask } from '../core/run.mjs'
import { readQueue } from '../core/task.mjs'
import { assertInvariant, gitProduct, notifier, sh, show } from './support/product.mjs'

const BRANCH = 'agent/task-0042-wallet-endpoint'
const GAUGE = { exit: [{ stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok || { echo "value is $(cat value.txt 2>/dev/null)"; exit 1; }' }] }

function setup(repo = {}) {
  const context = gitProduct({ gauge: GAUGE, models: { implement: { agent: 'claude', model: 'claude-opus-5' } }, ...repo })
  const todo = join(context.dir, 'tasks', 'todo')
  mkdirSync(todo, { recursive: true })
  writeFileSync(
    join(todo, '0042-wallet-endpoint.md'),
    '---\nid: 0042\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n',
  )
  const [task] = readQueue(context.dir, context.product)
  return { ...context, task, before: snapshotRefs(context.repoDir) }
}

function answer(extra = {}) {
  return { agent: 'claude', ok: true, message: 'Commit: feat(wallet): balance endpoint', model: { requested: 'claude-opus-5', actual: 'claude-opus-5' }, cost: { usd: 0.25, tokens: { input: 1000, output: 100 } }, session: 's', error: null, ms: 10, ...extra }
}

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

// A commit on `branch`, made the way a person or an agent makes one.
function commitOn(repoDir, branch, file, text) {
  sh(repoDir, 'switch', '--quiet', branch)
  writeFileSync(join(repoDir, file), `${text}\n`)
  sh(repoDir, 'add', '--all')
  sh(repoDir, 'commit', '--quiet', '-m', `${file}: ${text}`)
  sh(repoDir, 'switch', '--quiet', 'agent/dev')
}

// Everything the trial must not have touched: every ref, where HEAD is, what
// the working tree says, and the index itself.
function everything(repoDir) {
  return {
    refs: [...snapshotRefs(repoDir)].sort(),
    head: sh(repoDir, 'rev-parse', 'HEAD'),
    symbolic: sh(repoDir, 'symbolic-ref', 'HEAD'),
    status: sh(repoDir, 'status', '--porcelain=v1', '--untracked-files=all'),
    index: sh(repoDir, 'ls-files', '--stage'),
  }
}

test('the trial answers a conflict without touching the working tree, the index or any ref', () => {
  const { repoDir } = setup()
  sh(repoDir, 'branch', BRANCH, 'agent/dev')
  // The branch's own work, and something that landed on agent/dev over the
  // same file after the branch was cut.
  commitOn(repoDir, BRANCH, 'app.js', 'export const a = "the task"')
  commitOn(repoDir, 'agent/dev', 'app.js', 'export const a = "landed meanwhile"')
  // A dirty-looking tree the check must not disturb either: an untracked file
  // a person left here is work, and the trial is not allowed an opinion.
  writeFileSync(join(repoDir, 'scratch.txt'), 'mine\n')

  const before = everything(repoDir)
  const trial = wouldConflict(repoDir, 'agent/dev', BRANCH)
  assert.deepEqual(trial, { conflicts: ['app.js'] })
  assert.deepEqual(everything(repoDir), before, 'the trial wrote no ref, moved no HEAD and left the index and the tree exactly as they were')
  // Asked twice, it says the same thing: the answer is not a side effect of
  // the first call.
  assert.deepEqual(wouldConflict(repoDir, 'agent/dev', BRANCH), { conflicts: ['app.js'] })
})

test('a branch that is merely behind is not a conflict, and neither is one that is already a descendant', () => {
  const { repoDir } = setup()
  sh(repoDir, 'branch', BRANCH, 'agent/dev')
  commitOn(repoDir, BRANCH, 'wallet.js', 'export const balance = 0')
  // The ordinary state of nearly every resumed branch: agent/dev has moved,
  // over files this branch has not touched.
  commitOn(repoDir, 'agent/dev', 'notes.txt', 'from another task')
  assert.deepEqual(wouldConflict(repoDir, 'agent/dev', BRANCH), { clean: true })

  // And the state a person leaves behind by resolving: agent/dev merged in, so
  // there is nothing left to bring in at all.
  sh(repoDir, 'switch', '--quiet', BRANCH)
  sh(repoDir, 'merge', '--quiet', '--no-edit', 'agent/dev')
  sh(repoDir, 'switch', '--quiet', 'agent/dev')
  assert.deepEqual(wouldConflict(repoDir, 'agent/dev', BRANCH), { clean: true })

  // A branch that is exactly the integration branch — cut a moment ago and not
  // worked on yet — is the same answer.
  sh(repoDir, 'branch', 'agent/task-0043-other', 'agent/dev')
  assert.deepEqual(wouldConflict(repoDir, 'agent/dev', 'agent/task-0043-other'), { clean: true })
})

test('a repository with no commits on the integration branch is not a conflict', () => {
  const { dir } = setup()
  const empty = join(dir, 'empty')
  mkdirSync(empty)
  sh(empty, 'init', '--quiet', '--initial-branch=agent/dev')
  // Nothing has been committed here, so neither branch has a commit and there
  // is no base to compare: the trial says nothing rather than inventing a
  // conflict.
  assert.deepEqual(wouldConflict(empty, 'agent/dev', BRANCH), { clean: true })
})

test('a history with nothing in common is not a conflict', () => {
  const { repoDir } = setup()
  // No commit in common: git refuses to merge these without being told to, and
  // the trial is not the place that tells it to.
  sh(repoDir, 'checkout', '--quiet', '--orphan', BRANCH)
  sh(repoDir, 'rm', '--quiet', '-rf', '.')
  writeFileSync(join(repoDir, 'elsewhere.txt'), 'nothing in common\n')
  sh(repoDir, 'add', '--all')
  sh(repoDir, 'commit', '--quiet', '-m', 'a root of its own')
  sh(repoDir, 'switch', '--quiet', '--force', 'agent/dev')

  assert.deepEqual(wouldConflict(repoDir, 'agent/dev', BRANCH), { clean: true })
})

test('a resumed branch that conflicts pauses before the first attempt, and the journal says it cost nothing', async () => {
  const s = setup()
  // Task 0042 is paused with its work parked on its branch.
  await runTask(s.product, s.repo, s.task, { invoke: agent(write('no'), write('no'), write('no')).invoke, notify: notifier().notify })
  const parked = sh(s.repoDir, 'rev-parse', BRANCH)

  // Meanwhile task 0043 lands over the same file.
  writeFileSync(join(s.dir, 'tasks', 'todo', '0043-other.md'), '---\nid: 0043\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  const other = readQueue(s.dir, s.product).find((t) => t.id === '0043')
  const landed = await runTask(s.product, s.repo, other, { invoke: agent(write('ok')).invoke, notify: notifier().notify })
  assert.equal(landed.outcome, 'passed')
  const devTip = sh(s.repoDir, 'rev-parse', 'agent/dev')

  // And 0042 is resumed on the base it was cut from.
  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])
  const [resumed] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const n = notifier()
  const a = agent()
  const before = snapshotRefs(s.repoDir)
  const result = await runTask(s.product, s.repo, resumed, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'stale', 'not escalated: this one is distinguishable from a merge that conflicted after three attempts')
  assert.equal(result.reason, 'agent/task-0042-wallet-endpoint was cut from an earlier agent/dev and merging into it conflicts in value.txt')
  assert.deepEqual(result.conflicts, ['value.txt'])
  assert.equal(result.resumed, true)

  // Nothing was asked of anybody, and the line says so with numbers rather
  // than with a null that would read as "nobody reported one".
  assert.equal(a.prompts.length, 0, 'the task did not reach the agent')
  assert.equal(result.attempts, 0)
  assert.deepEqual(result.rounds, [])
  assert.deepEqual(result.cost, { usd: 0, tokens: { input: 0, output: 0 } })
  assert.equal(result.commit, null)
  assert.equal(result.acceptance.verdict, 'absent')
  assert.equal(result.gauge.failedStage, null)

  // Nothing moved, here or on the branch.
  assert.deepEqual([...snapshotRefs(s.repoDir)].sort(), [...before].sort(), 'the run that asked the question moved no ref')
  assert.equal(sh(s.repoDir, 'rev-parse', BRANCH), parked, 'the parked work is exactly as it was')
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), devTip)
  assertInvariant(s.repoDir, s.before, s.product)

  // The task is paused and the person is told, as for any other pause — with
  // the paths named and the step that is theirs.
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md')))
  assert.equal(n.sent.length, 1)
  assert.equal(n.sent[0].event, 'paused')
  assert.equal(n.sent[0].outcome, 'stale')
  assert.equal(n.sent[0].branch, BRANCH)
  assert.match(n.sent[0].message, /conflicts in value\.txt\. Resolve it on the task branch — git switch agent\/task-0042-wallet-endpoint && git merge agent\/dev — then move tasks\/hold\/0042-wallet-endpoint\.md back to todo\/\./)

  const line = readJournal(s.dir).lines.at(-1)
  assert.equal(line.outcome, 'stale')
  assert.equal(line.attempts, 0)
  assert.equal(line.cost.usd, 0)
  assert.equal(line.branch, BRANCH)
  assert.deepEqual(line.conflicts, ['value.txt'])

  // The person's step, and then the run that follows it: detent merged nothing
  // into the task branch and resolved nothing — this is the first merge of
  // agent/dev into it, and it is a person's.
  sh(s.repoDir, 'switch', '--quiet', BRANCH)
  assert.throws(() => sh(s.repoDir, 'merge', '--quiet', 'agent/dev'))
  write('ok')(s.repoDir)
  sh(s.repoDir, 'commit', '--quiet', '-am', 'resolve the conflict with 0043')
  sh(s.repoDir, 'switch', '--quiet', 'agent/dev')
  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])

  const [again] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const second = agent((cwd) => {
    write('ok')(cwd)
    writeFileSync(join(cwd, 'wallet.js'), 'export const balance = 0\n')
  })
  const finished = await runTask(s.product, s.repo, again, { invoke: second.invoke, notify: notifier().notify })
  assert.equal(finished.outcome, 'passed', finished.reason)
  assert.equal(second.prompts.length, 1)
  assert.doesNotMatch(second.prompts[0], /conflict|merge agent\/dev/, 'a conflict is not the agent\'s problem, and it is not told about one')
  // What it is told is the last run that asked it for something: the stale
  // line is not that run, and naming its reason would be naming the
  // integration branch and a merge (ADR 0013).
  assert.match(second.prompts[0], /It was paused because: 3 identical failures on test\./)
  assert.equal(show(s.repoDir, 'agent/dev', 'wallet.js'), 'export const balance = 0')
})

test('a resumed branch that is merely behind says nothing and runs', async () => {
  const s = setup()
  // 0042's attempts leave a draft of their own on its branch and never get the
  // gauge green.
  const draft = (cwd) => writeFileSync(join(cwd, 'draft.txt'), 'half\n')
  await runTask(s.product, s.repo, s.task, { invoke: agent(draft, draft, draft).invoke, notify: notifier().notify })

  // 0043 lands files 0042 has never touched: 0042's branch is now behind
  // agent/dev, which is the ordinary state of a resumed branch.
  writeFileSync(join(s.dir, 'tasks', 'todo', '0043-other.md'), '---\nid: 0043\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  const other = readQueue(s.dir, s.product).find((t) => t.id === '0043')
  await runTask(s.product, s.repo, other, {
    invoke: agent((cwd) => (write('ok')(cwd), writeFileSync(join(cwd, 'notes.txt'), 'from 0043\n'))).invoke,
    notify: notifier().notify,
  })

  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])
  const [resumed] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const n = notifier()
  const a = agent(write('ok'))
  const result = await runTask(s.product, s.repo, resumed, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'passed', result.reason)
  assert.equal(result.resumed, true)
  assert.equal(a.prompts.length, 1, 'behind is not a reason to stop')
  assert.doesNotMatch(a.prompts[0], /behind|stale/, 'nor a reason to say anything')
  assert.deepEqual(n.sent, [])
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a fresh task is not asked the question: it was just cut from the integration tip', async () => {
  const s = setup()
  // agent/dev well ahead of where dev was, over the very file the task writes.
  commitOn(s.repoDir, 'agent/dev', 'value.txt', 'from somebody else')
  const a = agent(write('ok'))
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })

  assert.equal(result.resumed, false)
  assert.equal(result.outcome, 'passed', result.reason)
  assert.equal(a.prompts.length, 1)
  assert.equal(show(s.repoDir, 'agent/dev', 'value.txt'), 'ok')
})
