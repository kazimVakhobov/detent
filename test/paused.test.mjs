// What `hold/` does to a run that has not started yet (ADR 0024): a paused
// barrier still bars, a paused task is offered to whoever is there, and
// neither of those is the other. The barring is driven here with no terminal
// anywhere near it — a scripted asker where a person would be, and once
// through the CLI, where there is no terminal by construction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendJournal } from '../core/journal.mjs'
import { validateProduct } from '../core/product.mjs'
import { run as runCommand } from '../core/commands/run.mjs'
import { runTask } from '../core/run.mjs'
import { readQueue } from '../core/task.mjs'
import { gitProduct, queueRepository, sh } from './support/product.mjs'

// Green when value.txt says "ok", like every other run fixture.
const GAUGE = { exit: [{ stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok' }] }
const MODELS = { implement: { agent: 'claude', model: 'claude-opus-5' } }

// doctor is asked before anything starts, and the only thing it fails on for
// this fixture is an agent that is not installed. One that answers nothing is
// enough: no test here lets a real agent be invoked.
const bin = mkdtempSync(join(tmpdir(), 'detent-bin-'))
writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n')
chmodSync(join(bin, 'claude'), 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`

function setup({ queue = 'tasks', shared = false } = {}) {
  const context = gitProduct({ gauge: GAUGE, models: MODELS }, { queue, models: MODELS })
  // Before the folders: the queue two machines share is a clone, and cloning
  // into a directory that already has the four folders in it is not one.
  const repository = shared ? queueRepository(context.dir, queue) : null
  for (const folder of ['todo', 'hold', 'done', 'failed']) mkdirSync(join(context.dir, queue, folder), { recursive: true })
  return { ...context, queue, repository }
}

// A second repository of the product, so that "in any repository" is a thing
// a test can tell apart from "in the one the barrier is in".
function addRepo(s, name) {
  const dir = join(s.dir, name)
  mkdirSync(dir)
  sh(dir, 'init', '--quiet', '--initial-branch=dev')
  sh(dir, 'config', 'user.name', 'Person')
  sh(dir, 'config', 'user.email', 'person@example.com')
  sh(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), `${name}\n`)
  sh(dir, 'add', '.')
  sh(dir, 'commit', '--quiet', '-m', 'init')
  sh(dir, 'branch', 'agent/dev', 'dev')

  const file = join(s.dir, '.detent', 'product.json')
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.repos.push({ name, compare: 'dev', gauge: GAUGE, models: MODELS })
  writeFileSync(file, JSON.stringify(raw))
  const { product, problems } = validateProduct(raw, s.dir)
  assert.deepEqual(problems, [])
  return { ...s, product }
}

function task(s, folder, id, slug, { barrier = false, repo = 'acme-api' } = {}) {
  const at = join(s.dir, s.queue, folder)
  mkdirSync(at, { recursive: true })
  writeFileSync(
    join(at, `${id}-${slug}.md`),
    `---\nid: ${id}\nrepo: ${repo}\ntouches_contract: ${barrier}\n---\n\n# Goal\n\nSomething.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n`,
  )
  return join(at, `${id}-${slug}.md`)
}

// The line a run left behind, which is where the reason a task is paused
// comes from.
function journal(s, id, { outcome = 'rejected', reason = 'the acceptance pass raised a doubt: the endpoint is not authorised', doubts = ['the endpoint is not authorised'], branch = null } = {}) {
  appendJournal(s.dir, { kind: 'task', task: id, repo: 'acme-api', outcome, reason, attempts: 3, acceptance: { verdict: 'rejected', doubts }, branch, commit: null, cost: { usd: 0.5, tokens: null } })
}

function sink() {
  const chunks = []
  return { write: (chunk) => (chunks.push(String(chunk)), true), text: () => chunks.join('') }
}

const passed = { outcome: 'passed', attempts: 1, merged: true, lock: 'enforced', commit: 'a'.repeat(40), cost: { usd: 0.25, tokens: null } }

// `detent run`, in this process: `script` is what a person types, and an empty
// script is nobody on stdin — which is what `ask` itself returns without a
// terminal, so the two are the same path.
async function detent(s, ids = [], { script = [], values = {}, runTask: runOne, spawnAgent } = {}) {
  const out = sink()
  const err = sink()
  const prompts = []
  const started = []
  const typed = [...script]
  let usage = null
  let code
  try {
    code = await runCommand(s.product, ids, { past: [], ...values }, {
      out,
      err,
      ask: (text) => {
        prompts.push(text)
        return Promise.resolve(typed.length ? typed.shift() : null)
      },
      runTask: runOne ?? ((product, repo, started_) => (started.push(started_.id), Promise.resolve(passed))),
      spawnAgent: spawnAgent ?? (() => assert.fail('plan was opened, and this test did not expect it')),
    })
  } catch (error) {
    if (error.name !== 'UsageError') throw error
    usage = error.message
  }
  return { code, usage, out: out.text(), err: err.text(), started, prompts }
}

// --- a paused barrier still bars ----------------------------------------------

test('a paused barrier bars every queued task with a higher number, in any repository, and no terminal changes that', async () => {
  const s = addRepo(setup(), 'acme-web')
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'todo', '0002', 'before-it')
  task(s, 'todo', '0004', 'admin-journal')
  task(s, 'todo', '0005', 'the-web-one', { repo: 'acme-web' })

  const r = await detent(s)
  assert.deepEqual(r.prompts.length, 1, 'the question was put once, for the one paused task')
  assert.deepEqual(r.started, ['0002'], 'what stands before the barrier runs; what stands behind it does not, whatever repository it names')
  assert.match(
    r.out,
    /^0004, 0005 not started: 0003 \(acme-api, who-may-act-on-whom\) is paused in tasks\/hold\/0003-who-may-act-on-whom\.md and changes the contract they would run against — resume it, or detent run --past 0003$/m,
  )
  assert.match(r.out, /^0003 {2}acme-api {2}who-may-act-on-whom {2}paused \(rejected\): the acceptance pass raised a doubt/m, 'and it is named, with why it stopped')
  assert.equal(r.code, 1, 'a run that did less than it was asked to is not a green run')
})

test('a paused task that is not a barrier bars nothing: it is named in one line and the queue runs', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'admin-journal')
  journal(s, '0003', { outcome: 'escalated', reason: '3 identical failures on test', doubts: [] })
  task(s, 'todo', '0004', 'wallet-endpoint')

  const r = await detent(s)
  assert.deepEqual(r.started, ['0004'])
  assert.equal(r.code, 0)
  assert.match(r.out, /^0003 {2}acme-api {2}admin-journal {2}paused \(escalated\): 3 identical failures on test$/m)
  assert.doesNotMatch(r.out, /not started/, 'only a contract change is a reason to hold other work')
})

test('the whole barring path through the CLI, where there is no terminal by construction', () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'todo', '0004', 'admin-journal')

  let refused
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir], { encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    refused = error
  }
  assert.equal(refused.status, 1)
  assert.match(refused.stdout, /^0004 not started: 0003 \(acme-api, who-may-act-on-whom\) is paused/m)
  assert.doesNotMatch(refused.stdout, /\n> $/, 'and nothing was asked of a pipeline')
  assert.equal(sh(s.repoDir, 'branch', '--list', 'agent/task-*'), '', 'no branch was created, so nothing was started')
})

test('a paused barrier that nothing stands behind stops nothing', async () => {
  const s = setup()
  task(s, 'hold', '0009', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0009')
  task(s, 'todo', '0004', 'wallet-endpoint')

  const r = await detent(s)
  assert.deepEqual(r.started, ['0004'])
  assert.equal(r.code, 0)
})

test('a task named on the command line is barred like any other, and the run says by what', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'todo', '0004', 'admin-journal')

  const r = await detent(s, ['0004'])
  assert.deepEqual(r.started, [])
  assert.match(r.out, /^0004 not started: 0003 \(acme-api, who-may-act-on-whom\) is paused .* — resume it, or detent run --past 0003$/m)
  assert.match(r.out, /^nothing started: everything this run would have taken stands behind a paused barrier$/m)
  assert.equal(r.code, 1)
})

test('resuming the barrier hands it back to the scheduler: it runs alone, and what was behind it follows', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'todo', '0004', 'admin-journal')

  const r = await detent(s, [], { script: ['resume'] })
  assert.deepEqual(r.started, ['0003', '0004'], 'the barrier first and alone, then what it was barring')
  assert.match(r.out, /^0003 {2}acme-api {2}who-may-act-on-whom {2}\(barrier — runs alone\) {2}…$/m)
  assert.doesNotMatch(r.out, /not started/)
  assert.equal(r.code, 0)
})

// --- running past one -----------------------------------------------------------

test('--past names the barrier it overrides, and the run says what it did', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'todo', '0004', 'admin-journal')

  const r = await detent(s, [], { values: { past: ['0003'] } })
  assert.deepEqual(r.started, ['0004'])
  assert.match(r.out, /^past a paused barrier: 0003 \(acme-api, who-may-act-on-whom\) is still paused in tasks\/hold\/0003-who-may-act-on-whom\.md$/m)
  assert.match(r.out, /^ {6}0004 starts against a contract it did not replace, because --past 0003 said so$/m)
  assert.equal(r.code, 0)
})

test('--past that names nothing paused, or a paused task that is no barrier, is a usage error', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'admin-journal')
  journal(s, '0003')
  task(s, 'todo', '0004', 'wallet-endpoint')

  const wrong = await detent(s, [], { values: { past: ['0003'] } })
  assert.match(wrong.usage, /^--past 0003: 0003 is paused but changes no contract/)
  assert.deepEqual(wrong.started, [], 'a typo is not consent, so nothing started')

  const absent = await detent(s, [], { values: { past: ['0007'] } })
  assert.match(absent.usage, /^--past 0007: nothing in tasks\/hold\/ has that number — paused: 0003$/)
})

// --- the question ---------------------------------------------------------------

test('the question offers three answers per paused task in id order, and Enter leaves it — which does not unbar it', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  task(s, 'hold', '0006', 'admin-journal')
  journal(s, '0003')
  journal(s, '0006', { outcome: 'error', reason: 'the agent failed: usage limit reached', doubts: [] })
  task(s, 'todo', '0007', 'wallet-endpoint')

  const r = await detent(s, [], { script: ['', ''] })
  assert.equal(r.prompts.length, 2)
  assert.match(r.prompts[0], /Task 0003 \(acme-api, who-may-act-on-whom\) is paused in tasks\/hold\/0003-who-may-act-on-whom\.md\./)
  assert.match(r.prompts[0], /rejected: the acceptance pass raised a doubt/)
  assert.match(r.prompts[0], /doubt: the endpoint is not authorised/)
  assert.match(r.prompts[0], /Nothing queued after it starts while it is paused: 0007\./)
  assert.match(r.prompts[0], /^ {2}1 {2}leave/m)
  assert.match(r.prompts[0], /^ {2}2 {2}resume/m)
  assert.match(r.prompts[0], /^ {2}3 {2}plan/m)
  assert.match(r.prompts[0], /Enter leaves it paused/)
  assert.match(r.prompts[1], /Task 0006 \(acme-api, admin-journal\) is paused/, 'in id order')

  assert.match(r.out, /^0003 {2}left paused \(the default: enter was pressed\)$/m)
  assert.deepEqual(r.started, [], 'leaving a barrier paused leaves it barring')
  assert.match(r.out, /^0007 not started: 0003 .* is paused/m)
  assert.equal(r.code, 1)
})

test('resume moves the file through moveAndRecord — a commit in the queue\'s repository and a push — and the run proceeds on the branch', async () => {
  const s = setup({ queue: 'agent-loop/tasks', shared: true })
  const { repository } = s
  task(s, 'todo', '0042', 'wallet-endpoint')
  sh(repository.dir, 'add', '--all', '--', 'tasks')
  sh(repository.dir, 'commit', '--quiet', '-m', 'session: 0042')
  sh(repository.dir, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main')

  // A real run that pauses, so there is a branch with work on it and a
  // journal line saying why — the state a person actually meets.
  const answer = (extra = {}) => ({ agent: 'claude', ok: true, message: 'Commit: feat(wallet): balance endpoint', model: { requested: 'claude-opus-5', actual: 'claude-opus-5' }, cost: { usd: 0.25, tokens: null }, session: 's', error: null, ms: 10, ...extra })
  const write = (value) => async (role, { cwd }) => (writeFileSync(join(cwd, 'value.txt'), `${value}\n`), answer())
  const notify = () => ({ sent: true, via: 'test' })
  const [queued] = readQueue(s.dir, s.product)
  const stopped = await runTask(s.product, s.repo, queued, { invoke: write('no'), notify })
  assert.equal(stopped.outcome, 'escalated')
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'hold', '0042-wallet-endpoint.md')))

  const results = []
  const r = await detent(s, [], {
    script: ['resume'],
    runTask: async (product, repo, task_) => {
      const result = await runTask(product, repo, task_, { invoke: write('ok'), notify })
      results.push(result)
      return result
    },
  })

  assert.equal(r.code, 0, r.out + r.err)
  assert.match(r.out, /^0042 {2}resuming$/m)
  assert.match(r.out, /^0042 {2}resumed: agent-loop\/tasks\/todo\/ \(from hold\/\) — queue [0-9a-f]{7}, pushed to origin main$/m)
  assert.equal(repository.subjects().split('\n')[0], 'queue: task 0042 wallet-endpoint → done', 'and the run that followed moved it again')
  assert.equal(repository.subjects().split('\n')[1], 'queue: task 0042 wallet-endpoint → todo', 'the resume is a move like any other: committed where the queue lives')
  assert.ok(repository.pushed().includes('queue: task 0042 wallet-endpoint → todo'), 'and pushed, so the next machine sees it')
  assert.equal(results[0].outcome, 'passed')
  assert.equal(results[0].resumed, true, 'exactly as after a hand-moved file')
})

test('a resume the queue\'s repository will not take ends the run, and nothing starts', async () => {
  const s = setup({ queue: 'agent-loop/tasks', shared: true })
  const { repository } = s
  task(s, 'hold', '0042', 'wallet-endpoint')
  journal(s, '0042')
  sh(repository.dir, 'add', '--all', '--', 'tasks')
  sh(repository.dir, 'commit', '--quiet', '-m', 'session: 0042')
  sh(repository.dir, 'remote', 'set-url', 'origin', join(s.dir, '.remotes', 'gone.git'))

  const r = await detent(s, [], { script: ['resume'] })
  assert.equal(r.code, 1)
  assert.match(r.err, /^stopped: the queue could not be pushed to origin main: .* — nothing was started$/m)
  assert.deepEqual(r.started, [])
})

test('plan is opened with the task in hand, the file stays in hold/, and the run stops saying what to type next', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003', { branch: 'agent/task-0003-who-may-act-on-whom' })
  task(s, 'hold', '0006', 'admin-journal')
  task(s, 'todo', '0007', 'wallet-endpoint')

  const opened = []
  const r = await detent(s, [], {
    script: ['plan'],
    spawnAgent: (command, args, cwd) => {
      opened.push({ command, args, cwd })
      // What the conversation is for: the one file, rewritten where it is.
      const file = join(cwd, 'tasks', 'hold', '0003-who-may-act-on-whom.md')
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n- [ ] and it is authorised\n`)
      return Promise.resolve(0)
    },
  })

  assert.equal(opened.length, 1)
  assert.equal(opened[0].command, 'claude')
  assert.equal(opened[0].cwd, s.dir)
  const prompt = opened[0].args.at(-1)
  assert.match(prompt, /Task 0003 of the product "acme" is paused, and we are changing the task itself/)
  assert.match(prompt, /The file is tasks\/hold\/0003-who-may-act-on-whom\.md, relative to this folder/)
  assert.match(prompt, /it ended rejected: the acceptance pass raised a doubt/)
  assert.match(prompt, /- the endpoint is not authorised/)
  assert.match(prompt, /the work it did is on the branch agent\/task-0003-who-may-act-on-whom/)
  assert.match(prompt, /change that one file, in place/)
  assert.match(prompt, /it stays in tasks\/hold\/0003-who-may-act-on-whom\.md while we edit it/)
  assert.match(prompt, /Write no code\./)

  assert.equal(r.prompts.length, 1, '0006 was never asked about: the run is over')
  assert.deepEqual(r.started, [], 'and it does not chain into a run')
  assert.ok(existsSync(join(s.dir, 'tasks', 'hold', '0003-who-may-act-on-whom.md')), 'a task whose criteria are being rewritten is not ready to run')
  assert.match(r.out, /^changed {2}tasks\/hold\/0003-who-may-act-on-whom\.md$/m, 'what the conversation left is checked, not assumed')
  assert.match(r.out, /^0003 is still paused, in tasks\/hold\/0003-who-may-act-on-whom\.md — read what the conversation left there\.$/m)
  assert.match(r.out, /^Then: detent run 0003 {3}\(it offers to resume it; nothing has started\)$/m)
  assert.equal(r.code, 0)
})

// --- and what the conversation did besides -------------------------------------
//
// The pre-prompt says to change one file and write no code. A prompt is an
// instruction rather than a guarantee, and the person it is handed back to has
// just finished a conversation they have not read — so `run` checks what it
// left, exactly as `plan` checks its own.

test('an amending conversation that wrote code, a new task and another task is reported, and the run is not green', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'done', '0001', 'already-landed')

  const r = await detent(s, [], {
    script: ['plan'],
    spawnAgent: (command, args, cwd) => {
      // Everything the prompt told it not to do.
      writeFileSync(join(cwd, 'acme-api', 'app.js'), 'export const a = 2\n')
      writeFileSync(join(cwd, '.detent', 'product.json'), '{}')
      task({ ...s, dir: cwd }, 'todo', '0004', 'a-task-nobody-asked-for')
      writeFileSync(join(cwd, 'tasks', 'done', '0001-already-landed.md'), 'rewritten\n')
      return Promise.resolve(0)
    },
  })

  assert.match(r.out, /^changing a task changes that one file, and these changed as well — look at them:$/m)
  assert.match(r.out, / {2}acme-api's working tree changed$/m)
  assert.match(r.out, / {2}\.detent\/product\.json changed$/m)
  assert.match(r.out, / {2}tasks\/todo\/0004-a-task-nobody-asked-for\.md was written — amending 0003 changes tasks\/hold\/0003-who-may-act-on-whom\.md and writes no new task$/m)
  assert.match(r.out, / {2}tasks\/done\/0001-already-landed\.md changed — amending 0003 changes tasks\/hold\/0003-who-may-act-on-whom\.md and no other task$/m)
  assert.match(r.out, /^Then: detent run 0003 {3}\(it offers to resume it; nothing has started\)$/m, 'and it still says what to type next')
  assert.deepEqual(r.started, [], 'reported, and still not chained into a run')
  assert.equal(r.code, 1)
})

test('an amending conversation that moved the task file out of hold/ is reported as the move nobody recorded', async () => {
  const s = setup()
  const file = task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')

  const r = await detent(s, [], {
    script: ['plan'],
    spawnAgent: (command, args, cwd) => (renameSync(file, join(cwd, 'tasks', 'todo', '0003-who-may-act-on-whom.md')), Promise.resolve(0)),
  })

  assert.match(
    r.out,
    /^ {2}tasks\/hold\/0003-who-may-act-on-whom\.md is gone — the task stays in tasks\/hold\/ while it is edited, and moving it is detent's to do$/m,
  )
  assert.match(r.out, /^0003 is not in tasks\/hold\/0003-who-may-act-on-whom\.md any more — put its file back there before anything can run it\.$/m)
  assert.doesNotMatch(r.out, /^unchanged/m, 'a file that is gone is not a file that was left alone')
  assert.equal(r.code, 1)
})

test('an amending conversation that changed nothing says so, and is not a breach', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')

  const r = await detent(s, [], { script: ['plan'], spawnAgent: () => Promise.resolve(0) })
  assert.match(r.out, /^unchanged {2}tasks\/hold\/0003-who-may-act-on-whom\.md — the conversation left the task file as it was\.$/m)
  assert.doesNotMatch(r.out, /changed as well/)
  assert.equal(r.code, 0, 'a conversation that decided to change nothing is a conversation, not a breach')
})

test('a resume answered before a plan is still carried out: the move is committed, and the run says nothing started', async () => {
  const s = setup({ queue: 'agent-loop/tasks', shared: true })
  const { repository } = s
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'hold', '0006', 'admin-journal')
  journal(s, '0006')
  sh(repository.dir, 'add', '--all', '--', 'tasks')
  sh(repository.dir, 'commit', '--quiet', '-m', 'session: two paused')
  sh(repository.dir, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main')

  const opened = []
  const r = await detent(s, [], {
    script: ['resume', 'plan'],
    spawnAgent: (command, args, cwd) => (opened.push({ command, args, cwd }), Promise.resolve(0)),
  })

  assert.equal(opened.length, 1, 'the conversation is about 0006')
  assert.match(opened[0].args.at(-1), /Task 0006 of the product "acme" is paused/)

  // The screen said "resuming", so the file moved — through moveAndRecord,
  // with the commit and the push every other move gets.
  assert.match(r.out, /^0003 {2}resuming$/m)
  assert.match(r.out, /^0003 {2}resumed: agent-loop\/tasks\/todo\/ \(from hold\/\) — queue [0-9a-f]{7}, pushed to origin main$/m)
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'todo', '0003-who-may-act-on-whom.md')))
  assert.equal(repository.subjects().split('\n')[0], 'queue: task 0003 who-may-act-on-whom → todo')
  assert.ok(repository.pushed().includes('queue: task 0003 who-may-act-on-whom → todo'))

  // And the conversation ended the run, so it is queued rather than running.
  assert.deepEqual(r.started, [], 'plan does not chain into a run')
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'hold', '0006-admin-journal.md')), '0006 stays in hold/ while it is edited')
  assert.match(r.out, /^0003 is back in agent-loop\/tasks\/todo\/ and was not started: this run ended with the conversation\.$/m)
  assert.match(r.out, /^0006 is still paused, in agent-loop\/tasks\/hold\/0006-admin-journal\.md/m)
  assert.equal(r.code, 0)
})

// --- a name that is not in todo/ --------------------------------------------------

test('a name outside todo/ is reported by where it actually is, one sentence per folder', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')
  task(s, 'failed', '0005', 'abandoned')

  const held = await detent(s, ['0003'])
  assert.match(held.usage, /^0003 is paused in tasks\/hold\/0003-who-may-act-on-whom\.md \(rejected\): the acceptance pass raised a doubt: the endpoint is not authorised — detent run 0003 on a terminal offers to resume it or to change it in plan$/)

  const abandoned = await detent(s, ['0005'])
  assert.match(abandoned.usage, /^0005 is in tasks\/failed\/0005-abandoned\.md, which is yours — detent never moves a task there, and never takes one out$/)

  const nobody = await detent(s, ['0009'])
  assert.equal(nobody.usage, 'not in tasks/todo/: 0009')
})

test('detent run <id> on a paused task offers it, and resuming it runs that task and nothing else', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'admin-journal')
  journal(s, '0003')
  task(s, 'todo', '0004', 'wallet-endpoint')

  const left = await detent(s, ['0003'], { script: ['leave'] })
  assert.equal(left.prompts.length, 1)
  assert.match(left.usage, /^0003 is still paused, and nothing behind it started either$/)
  assert.deepEqual(left.started, [])

  const r = await detent(s, ['0003'], { script: ['2'] })
  assert.deepEqual(r.started, ['0003'], 'the resumed task, and not the rest of the queue')
  assert.ok(existsSync(join(s.dir, 'tasks', 'done', '0003-admin-journal.md')) === false)
  assert.ok(!existsSync(join(s.dir, 'tasks', 'hold', '0003-admin-journal.md')), 'it left hold/')
  assert.equal(r.code, 0)
})

test('nothing to run says what is paused, rather than that the queue is empty', async () => {
  const s = setup()
  task(s, 'hold', '0003', 'who-may-act-on-whom', { barrier: true })
  journal(s, '0003')

  const r = await detent(s)
  assert.match(r.out, /^one task is paused in tasks\/hold\/ \(0003\), and nothing is queued in tasks\/todo\/ — detent run 0003 offers to resume it$/m)
  assert.doesNotMatch(r.out, /nothing to run/, 'there is work; it is paused; that is a different sentence')
  assert.equal(r.code, 0)

  task(s, 'hold', '0004', 'admin-journal')
  const two = await detent(s)
  assert.match(two.out, /^2 tasks are paused in tasks\/hold\/ \(0003, 0004\), and nothing is queued in tasks\/todo\/ — detent run <id> offers to resume one$/m)
})

test('an empty queue with nothing paused keeps today\'s sentence', async () => {
  const s = setup()
  const r = await detent(s)
  assert.equal(r.out, 'nothing to run: tasks/todo/ is empty\n')
  assert.equal(r.code, 0)
})
