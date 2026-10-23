// Build step 11: the acceptance pass, against a real repository and gauge,
// with both agents scripted. The implementer and the reviewer are told apart
// by the read-only flag the reviewer is always called with.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotRefs } from '../core/git.mjs'
import { parseVerdict } from '../core/acceptance.mjs'
import { readJournal } from '../core/journal.mjs'
import { runTask } from '../core/run.mjs'
import { readQueue } from '../core/task.mjs'
import { assertInvariant, gitProduct, notifier, sh, show } from './support/product.mjs'

const BRANCH = 'agent/task-0042-wallet-endpoint'
const GAUGE = { exit: [{ stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok' }] }
const MODELS = { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'claude', model: 'claude-sonnet-5' } }

function setup(repo = {}, productOverrides = {}) {
  const s = gitProduct({ gauge: GAUGE, models: MODELS, ...repo }, productOverrides)
  mkdirSync(join(s.dir, 'tasks', 'todo'), { recursive: true })
  writeFileSync(
    join(s.dir, 'tasks', 'todo', '0042-wallet-endpoint.md'),
    '---\nid: 0042\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n\n# Out of scope\n\nTouching README.md.\n',
  )
  const [task] = readQueue(s.dir, s.product)
  return { ...s, task, before: snapshotRefs(s.repoDir) }
}

function reply(message, extra = {}) {
  return { ok: true, message, model: { requested: null, actual: null }, cost: { usd: 0.1, tokens: { input: 10, output: 1 } }, session: null, error: null, ms: 1, ...extra }
}

// Each call goes to `implement` or `review` by the read-only flag; prompts and
// flags are recorded.
function agents({ implement = [(cwd) => writeFileSync(join(cwd, 'value.txt'), 'ok\n')], review = [() => reply('Looks complete.\nVERDICT: NO DOUBTS')] } = {}) {
  const calls = { implement: [], review: [] }
  const invoke = async (role, { cwd, prompt, readOnly }) => {
    const kind = readOnly ? 'review' : 'implement'
    calls[kind].push({ role, prompt, readOnly })
    const step = (kind === 'review' ? review : implement)[calls[kind].length - 1]
    if (!step) throw new Error(`no ${kind} step ${calls[kind].length}`)
    return (await step(cwd)) ?? reply('Commit: feat(wallet): balance')
  }
  return { invoke, calls }
}

test('no doubts: the machine-checked green stands, and the merge says who read it', async () => {
  const s = setup()
  const a = agents()
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.deepEqual(result.acceptance, { verdict: 'accepted', doubts: [], cost: { usd: 0.1, tokens: { input: 10, output: 1 } } })
  assert.deepEqual(result.models.accept, { agent: 'claude', requested: 'claude-sonnet-5', actual: null })
  assert.equal(result.cost.usd, 0.2, 'the review is part of what the pass cost')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev'), /^Acceptance: claude \(claude-sonnet-5\) — no doubts$/m)

  const [review] = a.calls.review
  assert.equal(review.readOnly, true)
  assert.equal(review.role.agent, 'claude')
  assert.match(review.prompt, /You cannot approve it/)
  assert.match(review.prompt, /- \[ \] value.txt says ok/)
  assert.match(review.prompt, /Touching README\.md/)
  assert.match(review.prompt, /\+ok/, 'the diff is in the prompt')
  assert.match(review.prompt, /git diff agent\/dev\.\.\.agent\/task-0042-wallet-endpoint/)
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a doubt before the last attempt goes back to the agent, and the task lands without a person', async () => {
  const s = setup()
  const n = notifier()
  const a = agents({
    implement: [
      (cwd) => (writeFileSync(join(cwd, 'value.txt'), 'ok\n'), writeFileSync(join(cwd, 'README.md'), 'changed\n')),
      (cwd) => writeFileSync(join(cwd, 'README.md'), 'acme\n'),
    ],
    review: [
      () => reply('Value is right, but:\nVERDICT: DOUBTS\n- README.md was changed, which the task puts out of scope'),
      () => reply('VERDICT: NO DOUBTS'),
    ],
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'passed')
  assert.equal(result.merged, true)
  assert.equal(result.attempts, 2, 'a doubt costs an attempt, exactly as a red gauge does')
  assert.deepEqual(n.sent, [], 'nobody was called: the budget was not gone')
  assert.deepEqual(result.acceptance.verdict, 'accepted', 'the flat fields hold the last round')
  assert.deepEqual(result.acceptance.doubts, [])
  assert.equal(result.acceptance.cost.usd, 0.2, 'both reviews, which is what reading this task cost')
  assert.equal(result.cost.usd, 0.4, 'two attempts and two reviews')

  // The implementer heard what the reviewer said — and heard that passing the
  // gauge again is not what is missing, which the retry wording cannot say.
  const second = a.calls.implement[1].prompt
  assert.match(second, /Attempt 2 of 3\. Your previous attempt left the gauge green and a reviewer read it and still did not accept the work/)
  assert.match(second, /take a different approach rather than repairing the same one/)
  assert.match(second, /^- README\.md was changed, which the task puts out of scope$/m)
  assert.doesNotMatch(second, /did not leave the gauge green/, 'the gauge was green, and that is the sentence a reader trusts')

  // The doubted round is on the branch, which landed, so git says what the
  // reviewer said on the way — the rounds the journal lists.
  const log = sh(s.repoDir, 'log', '--format=%B', 'agent/dev')
  assert.match(log, /^wip\(wallet-endpoint\): attempt 1 doubted by the acceptance pass$/m)
  assert.match(log, /^Outcome: doubted — the gauge is green and the task is not done; attempt 2 of 3 follows$/m)
  assert.match(log, /^Doubt: README\.md was changed, which the task puts out of scope$/m)
  assert.equal(show(s.repoDir, 'agent/dev', 'README.md'), 'acme', 'and the doubt was addressed')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a doubt on the last attempt demotes: rejected, paused with the doubts on the branch, nothing lands', async () => {
  const s = setup({}, { attempts: 2 })
  const n = notifier()
  const a = agents({
    implement: [(cwd) => (writeFileSync(join(cwd, 'value.txt'), 'ok\n'), writeFileSync(join(cwd, 'README.md'), 'changed\n')), () => {}],
    review: [
      () => reply('VERDICT: DOUBTS\n- README.md was changed, which the task puts out of scope'),
      () => reply('Value is right, but:\nVERDICT: DOUBTS\n- README.md was changed, which the task puts out of scope\n- no test covers the balance'),
    ],
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'rejected')
  assert.equal(result.merged, false)
  assert.equal(result.attempts, 2)
  assert.equal(a.calls.implement.length, 2, 'no third attempt: the budget is gone')
  assert.deepEqual(result.acceptance.doubts, ['README.md was changed, which the task puts out of scope', 'no test covers the balance'])
  assert.equal(result.reason, 'the acceptance pass raised 2 doubts: README.md was changed, which the task puts out of scope; no test covers the balance')
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), sh(s.repoDir, 'rev-parse', 'dev'))
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md')))
  assert.match(n.sent[0].message, /rejected: the acceptance pass raised 2 doubts/)

  const parked = sh(s.repoDir, 'log', '-1', '--format=%B', BRANCH)
  assert.match(parked, /^wip\(wallet-endpoint\): rejected by the acceptance pass/)
  assert.match(parked, /^Outcome: rejected — the gauge is green and the task is not done$/m)
  assert.match(parked, /^Doubt: README\.md was changed, which the task puts out of scope$/m)
  assert.match(parked, /^Acceptance: claude \(claude-sonnet-5\) — rejected$/m)
  assert.equal(show(s.repoDir, BRANCH, 'value.txt'), 'ok', 'the green work is kept for a person to read')

  // Every rejected round, not only the last: a person reading git log on the
  // branch sees the rounds the journal lists.
  assert.deepEqual(
    sh(s.repoDir, 'log', '--format=%s', BRANCH).split('\n').filter((subject) => /acceptance pass$/.test(subject)),
    ['wip(wallet-endpoint): rejected by the acceptance pass', 'wip(wallet-endpoint): attempt 1 doubted by the acceptance pass'],
  )
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a rejected task resumed hands the doubts to the implementer', async () => {
  const s = setup({}, { attempts: 1 })
  await runTask(s.product, s.repo, s.task, {
    invoke: agents({ review: [() => reply('VERDICT: DOUBTS\n- no test covers the balance')] }).invoke,
    notify: notifier().notify,
  })
  execFileSync('mv', [join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md'), join(s.dir, 'tasks', 'todo')])
  const [task] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  const a = agents({ implement: [(cwd) => writeFileSync(join(cwd, 'balance.test.js'), 'test\n')] })
  const result = await runTask(s.product, s.repo, task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.match(a.calls.implement[0].prompt, /a reviewer read the change and doubted the task was done/)
  assert.match(a.calls.implement[0].prompt, /^- no test covers the balance$/m)
})

test('the journal line carries a round per attempt, and the flat fields keep the last one', async () => {
  const s = setup()
  const a = agents({
    implement: [
      (cwd) => writeFileSync(join(cwd, 'value.txt'), 'nearly\n'),
      (cwd) => writeFileSync(join(cwd, 'value.txt'), 'ok\n'),
      (cwd) => writeFileSync(join(cwd, 'balance.test.js'), 'test\n'),
    ],
    review: [() => reply('VERDICT: DOUBTS\n- no test covers the balance'), () => reply('VERDICT: NO DOUBTS')],
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })

  assert.equal(result.outcome, 'passed')
  assert.equal(result.attempts, 3)
  assert.deepEqual(result.rounds.map((r) => [r.attempt, r.gauge.green, r.gauge.failedStage, r.acceptance]), [
    [1, false, 'test', null],
    [2, true, null, { verdict: 'rejected', doubts: ['no test covers the balance'] }],
    [3, true, null, { verdict: 'accepted', doubts: [] }],
  ], 'a round that never reached the acceptance pass has null there, which is not "it raised nothing"')
  assert.deepEqual(result.rounds.map((r) => r.cost.usd), [0.1, 0.2, 0.2], 'what each attempt cost, the review it paid for included')

  // And the flat fields, which every line written before rounds existed has
  // and nothing was rewritten to walk the array.
  assert.deepEqual(result.gauge, { profile: 'exit', failedStage: null })
  assert.deepEqual(result.acceptance.verdict, 'accepted')

  // The red attempt was handed the gauge; the doubted one was handed the
  // doubts, and neither was handed the other's story.
  assert.match(a.calls.implement[1].prompt, /did not leave the gauge green/)
  assert.doesNotMatch(a.calls.implement[1].prompt, /did not accept the work/)
  assert.match(a.calls.implement[2].prompt, /did not accept the work/)
  assert.doesNotMatch(a.calls.implement[2].prompt, /did not leave the gauge green/, 'last-but-one\'s failure is not this round\'s news')
  assert.deepEqual(readJournal(s.dir).lines[0].rounds.length, 3)
})

// The three ways the acceptance pass itself goes wrong. None of them is a
// doubt, so none of them buys another attempt: a budget spent on a pass that
// broke, or wrote, or said nothing readable is a budget spent on nothing the
// agent can change (ADR 0023).
test('a verdict detent cannot read is an error, never a pass, and never retried', async () => {
  const s = setup()
  const a = agents({ review: [() => reply('I think it is probably fine.')] })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.equal(result.reason, 'the acceptance pass gave no verdict detent can read')
  assert.equal(result.acceptance.verdict, null)
  assert.equal(result.attempts, 1, 'the budget was 3 and nothing bought a second attempt')
  assert.equal(a.calls.implement.length, 1)
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), sh(s.repoDir, 'rev-parse', 'dev'))
})

test('a reviewer that fails is an error, and never retried', async () => {
  const s = setup()
  const a = agents({ review: [() => reply('', { ok: false, error: 'usage limit reached' })] })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.equal(result.reason, 'the acceptance pass failed: usage limit reached')
  assert.equal(result.attempts, 1)
  assert.equal(a.calls.implement.length, 1)
})

test('a reviewer that writes is caught, what it wrote is discarded rather than parked, and nothing is retried', async () => {
  const s = setup()
  const a = agents({
    review: [
      (cwd) => {
        writeFileSync(join(cwd, 'value.txt'), 'reviewer was here\n')
        sh(cwd, 'commit', '--quiet', '-am', 'the reviewer committed')
        writeFileSync(join(cwd, 'stray.txt'), 'x\n')
        return reply('VERDICT: NO DOUBTS')
      },
    ],
  })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'error')
  assert.match(result.reason, /^the acceptance pass changed the repository/)
  assert.equal(result.attempts, 1, 'a boundary breach is not a doubt and buys no attempt')
  assert.equal(a.calls.implement.length, 1)
  assert.equal(show(s.repoDir, BRANCH, 'value.txt'), 'ok', 'the branch is back at the implementer\'s commit')
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', BRANCH), /^Task: 0042$/m)
  assert.throws(() => show(s.repoDir, BRANCH, 'stray.txt'))
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), sh(s.repoDir, 'rev-parse', 'dev'))
  assertInvariant(s.repoDir, s.before, s.product)
})

test('without models.accept the pass is absent, and the gauge alone lands the task', async () => {
  const s = setup({ models: { implement: MODELS.implement } })
  const a = agents({ review: [] })
  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed')
  assert.equal(result.acceptance.verdict, 'absent')
  assert.equal(a.calls.review.length, 0)
  assert.match(sh(s.repoDir, 'log', '-1', '--format=%B', 'agent/dev'), /^Acceptance: none declared$/m)
})

const summary = (dir) => execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'summary', '--product', dir], { encoding: 'utf8' })

test('summary reports how often green was not done', async () => {
  const s = setup({}, { attempts: 1 })
  await runTask(s.product, s.repo, s.task, {
    invoke: agents({ review: [() => reply('VERDICT: DOUBTS\n- x')] }).invoke,
    notify: notifier().notify,
  })
  const out = summary(s.dir)
  assert.match(out, /^green but not done: 1 of 1 green run the acceptance pass read \(100%\)$/m)
  assert.equal(readJournal(s.dir).lines[0].acceptance.verdict, 'rejected')
})

test('summary reports how often a doubt was addressed, which is the number the retry has to earn', async () => {
  const s = setup()
  assert.match(summary(s.dir), /^no task runs in acme's journal yet$/m)

  // One run that was doubted and went round again, and one that passed first
  // time: the second is in the denominator and not the numerator.
  await runTask(s.product, s.repo, s.task, {
    invoke: agents({
      implement: [(cwd) => writeFileSync(join(cwd, 'value.txt'), 'ok\n'), (cwd) => writeFileSync(join(cwd, 'balance.test.js'), 'test\n')],
      review: [() => reply('VERDICT: DOUBTS\n- no test covers the balance'), () => reply('VERDICT: NO DOUBTS')],
    }).invoke,
    notify: notifier().notify,
  })
  writeFileSync(join(s.dir, 'tasks', 'todo', '0043-second.md'), '---\nid: 0043\nrepo: acme-api\n---\n\n# Goal\n\nMore.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  const [next] = readQueue(s.dir, s.product).filter((t) => t.folder === 'todo')
  await runTask(s.product, s.repo, next, {
    invoke: agents({ implement: [(cwd) => writeFileSync(join(cwd, 'again.txt'), 'x\n')] }).invoke,
    notify: notifier().notify,
  })

  assert.match(
    summary(s.dir),
    /^a doubt addressed: 1 of 2 passed runs were accepted on a round after the first, having been doubted on an earlier one \(50%\)$/m,
  )
})

test('parseVerdict reads the last verdict line, strictly', () => {
  assert.deepEqual(parseVerdict('All good.\nVERDICT: NO DOUBTS'), { verdict: 'accepted', doubts: [] })
  assert.deepEqual(parseVerdict('**VERDICT: NO DOUBTS**'), { verdict: 'accepted', doubts: [] })
  assert.deepEqual(parseVerdict('verdict: doubts\n- a\n* b\nnot a doubt'), { verdict: 'rejected', doubts: ['a', 'b'] })
  assert.deepEqual(parseVerdict('VERDICT: DOUBTS'), { verdict: 'rejected', doubts: ['the reviewer raised a doubt and gave no reason'] })
  assert.deepEqual(parseVerdict('VERDICT: NO DOUBTS\n…on reflection:\nVERDICT: DOUBTS\n- c'), { verdict: 'rejected', doubts: ['c'] })
  assert.deepEqual(parseVerdict('No doubts at all.'), { verdict: null, doubts: [] })
  assert.deepEqual(parseVerdict('VERDICT: APPROVED'), { verdict: null, doubts: [] }, 'there is no approval to give')
  assert.deepEqual(parseVerdict(undefined), { verdict: null, doubts: [] })
})
