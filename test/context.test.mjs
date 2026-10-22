// The shared context (ADR 0012, parts 1 and 2): a documentation repository
// mounted as a submodule, brought to its remote's tip before the agent starts,
// and its pointer committed with the task — but only once that commit is
// verified to be somewhere everyone else can see.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotRefs } from '../core/git.mjs'
import { readJournal } from '../core/journal.mjs'
import { runTask } from '../core/run.mjs'
import { readQueue } from '../core/task.mjs'
import { assertInvariant, gitProduct, notifier, sharedContext, sh } from './support/product.mjs'

const BRANCH = 'agent/task-0042-wallet-endpoint'
const GAUGE = { exit: [{ stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok' }] }

function setup(repo = {}) {
  const context = gitProduct({ gauge: GAUGE, models: { implement: { agent: 'claude', model: 'claude-opus-5' } }, ...repo })
  const docs = sharedContext(context)
  const todo = join(context.dir, 'tasks', 'todo')
  mkdirSync(todo, { recursive: true })
  writeFileSync(
    join(todo, '0042-wallet-endpoint.md'),
    '---\nid: 0042\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n',
  )
  const [task] = readQueue(context.dir, context.product)
  return { ...context, docs, task, before: snapshotRefs(context.repoDir) }
}

function answer(extra = {}) {
  return { agent: 'claude', ok: true, message: 'Commit: feat(wallet): balance endpoint', model: { requested: 'claude-opus-5', actual: 'claude-opus-5' }, cost: { usd: 0.25, tokens: null }, session: 's', error: null, ms: 10, ...extra }
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

test('the context is at its remote tip before the first turn, and the pointer lands with the task', async () => {
  const s = setup()
  const pushed = s.docs.write('a decision the task was done against\n')
  let read = null
  const a = agent((cwd) => {
    read = readFileSync(join(cwd, 'docs', 'adr.md'), 'utf8')
    writeFileSync(join(cwd, 'value.txt'), 'ok\n')
  })

  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })

  assert.equal(result.outcome, 'passed', result.reason)
  assert.equal(read, 'a decision the task was done against\n', 'the agent read the context as of the moment the task started')
  assert.match(
    a.prompts[0],
    /Read "docs" and do not write there: it is the shared context, brought up to date before you started, and detent records which revision you read\./,
    'an agent that finds a submodule it may read and may not write is told which it is',
  )
  assert.deepEqual(result.submodules, { docs: pushed }, 'the journal line says which commit it read')
  assert.equal(s.docs.pointer('agent/dev'), pushed, 'the pointer reached agent/dev with the task')
  assert.equal(s.docs.pointer('agent/dev^2'), pushed, 'and was part of the task commit, not only of the merge')
  assert.deepEqual(readJournal(s.dir).lines.at(-1).submodules, { docs: pushed })
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a submodule in neverCommit is not fetched, not moved, and the sentence about it is unchanged', async () => {
  const s = setup({ neverCommit: ['docs'] })
  const before = { head: s.docs.head(), remote: s.docs.remoteTip(), pointer: s.docs.pointer('agent/dev') }
  s.docs.write('written after the run started, and never read\n')
  const a = agent((cwd) => writeFileSync(join(cwd, 'value.txt'), 'ok\n'))

  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })

  assert.equal(result.outcome, 'passed', result.reason)
  assert.equal(s.docs.head(), before.head, 'the submodule was not moved')
  assert.equal(s.docs.remoteTip(), before.remote, 'and not even fetched')
  assert.equal(s.docs.pointer('agent/dev'), before.pointer, 'so there was no pointer to commit')
  assert.equal(result.submodules, undefined, 'nothing is tracked, so the line says nothing')
  assert.match(a.prompts[0], /Do not change "docs": changes there are never committed and will be lost\./)
  assert.doesNotMatch(a.prompts[0], /shared context/, 'and is not also called tracked, which it is not')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a submodule with commits nobody else can see pauses the task, and no pointer is committed', async () => {
  const s = setup()
  const tip = s.docs.write('pushed, and the one the pointer may record\n')
  const a = agent((cwd) => {
    // An agent with a shell, committing in the shared context and not pushing:
    // exactly the reference to nowhere §13 refused to allow into a pointer.
    writeFileSync(join(cwd, 'docs', 'adr.md'), 'mine, and only mine\n')
    sh(join(cwd, 'docs'), 'commit', '--quiet', '-am', 'a decision nobody else has')
    writeFileSync(join(cwd, 'value.txt'), 'ok\n')
  })
  const n = notifier()

  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })

  assert.equal(result.outcome, 'escalated')
  assert.match(result.reason, /^the submodule docs is at [0-9a-f]{7}, which is in none of its remote branches — it has unpushed commits, so this task cannot record which revision it read; push docs first$/)
  assert.equal(result.merged, false)
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), sh(s.repoDir, 'rev-parse', 'dev'), 'nothing landed')
  assert.equal(s.docs.pointer(BRANCH), s.docs.pointer('agent/dev'), 'the parked work carries no pointer of its own')
  assert.notEqual(s.docs.pointer(BRANCH), tip, 'not even the verified one it was refreshed to')
  assert.equal(result.submodules.docs, tip, 'the journal still says what the agent read')
  assert.equal(sh(s.repoDir, 'show', `${BRANCH}:value.txt`), 'ok', 'the work itself is kept')
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md')))
  assert.match(n.sent[0].message, /is paused — escalated: the submodule docs/)
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a context that cannot be reached pauses the task before the agent is asked for anything', async () => {
  const s = setup()
  sh(join(s.repoDir, 'docs'), 'remote', 'set-url', 'origin', join(s.dir, '.remotes', 'gone.git'))
  const a = agent()

  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })

  assert.equal(result.outcome, 'escalated')
  assert.match(result.reason, /^the shared context could not be brought up to date: docs — fatal:/)
  assert.deepEqual(a.prompts, [], 'no agent was asked to work against a context nobody chose')
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0042-wallet-endpoint.md')))
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a run whose only change is the context moving forward changed nothing', async () => {
  const s = setup({ gauge: { exit: [{ stage: 'test', command: 'true' }] } })
  s.docs.write('new, and not this task\n')
  const result = await runTask(s.product, s.repo, s.task, { invoke: agent(() => {}).invoke, notify: notifier().notify })

  assert.equal(result.outcome, 'error')
  assert.equal(result.reason, 'the gauge is green but the agent changed nothing')
  assert.equal(sh(s.repoDir, 'rev-parse', 'agent/dev'), sh(s.repoDir, 'rev-parse', 'dev'))
  assertInvariant(s.repoDir, s.before, s.product)
})
