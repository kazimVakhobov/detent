// The queue as a repository (ADR 0012, part 3): a task's move is a commit
// there and a push, so the next machine reads a queue that is current — and a
// queue that is not in a repository is still a file move and nothing else.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRepository, snapshotRefs } from '../core/git.mjs'
import { readJournal } from '../core/journal.mjs'
import { moveAndRecord, QueueRepositoryError } from '../core/queue.mjs'
import { readQueue } from '../core/task.mjs'
import { runTask } from '../core/run.mjs'
import { assertInvariant, gitProduct, queueRepository, sh } from './support/product.mjs'

const GAUGE = { exit: [{ stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok' }] }

// A product whose queue sits inside a repository of its own, cloned from a
// remote: `agent-loop/` is the clone, `agent-loop/tasks/` the four folders.
function setup({ queue = 'agent-loop/tasks', ids = ['0042'], committed = true } = {}) {
  const context = gitProduct({ gauge: GAUGE, models: { implement: { agent: 'claude', model: 'claude-opus-5' } } }, { queue })
  const repository = queue.includes('/') ? queueRepository(context.dir, queue) : null
  const todo = join(context.dir, queue, 'todo')
  mkdirSync(todo, { recursive: true })
  for (const id of ids) {
    writeFileSync(
      join(todo, `${id}-wallet-endpoint.md`),
      `---\nid: ${id}\nrepo: acme-api\n---\n\n# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n`,
    )
  }
  // What the session did on the other machine: wrote the tasks, committed
  // them, pushed.
  if (repository && committed) {
    sh(repository.dir, 'add', '--all', '--', 'tasks')
    sh(repository.dir, 'commit', '--quiet', '-m', `session: ${ids.join(', ')}`)
    sh(repository.dir, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main')
  }
  return { ...context, queue, repository, tasks: readQueue(context.dir, context.product), before: snapshotRefs(context.repoDir) }
}

const answer = (extra = {}) => ({ agent: 'claude', ok: true, message: 'Commit: feat(wallet): balance endpoint', model: { requested: 'claude-opus-5', actual: 'claude-opus-5' }, cost: { usd: 0.25, tokens: null }, session: 's', error: null, ms: 10, ...extra })
const green = async (role, { cwd }) => (writeFileSync(join(cwd, 'value.txt'), 'ok\n'), answer())
const red = async (role, { cwd }) => (writeFileSync(join(cwd, 'value.txt'), 'no\n'), answer())
const notify = () => ({ sent: true, via: 'test' })

test('a task reaching done/ is a commit in the queue\'s repository, naming it, and a push', async () => {
  const s = setup()
  // A repository of the product with a remote of its own: nothing detent does
  // may reach it.
  sh(s.dir, 'clone', '--quiet', '--bare', s.repoDir, join(s.dir, '.remotes', 'api.git'))
  sh(s.repoDir, 'remote', 'add', 'origin', join(s.dir, '.remotes', 'api.git'))
  const apiRefs = sh(join(s.dir, '.remotes', 'api.git'), 'for-each-ref', '--format=%(refname) %(objectname)')
  // Work of the person's own, in the queue's repository and not part of a move.
  writeFileSync(join(s.repository.dir, 'notes.md'), 'mine\n')

  const result = await runTask(s.product, s.repo, s.tasks[0], { invoke: green, notify })

  assert.equal(result.outcome, 'passed', result.reason)
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'done', '0042-wallet-endpoint.md')))
  assert.equal(s.repository.subjects().split('\n')[0], 'queue: task 0042 wallet-endpoint → done')
  assert.deepEqual(
    sh(s.repository.dir, 'show', '--no-renames', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort(),
    ['tasks/done/0042-wallet-endpoint.md', 'tasks/todo/0042-wallet-endpoint.md'],
    'the commit is the move and nothing else',
  )
  assert.equal(s.repository.pushed().split('\n')[0], 'queue: task 0042 wallet-endpoint → done', 'and the next machine can read it')
  assert.equal(sh(s.repository.dir, 'status', '--porcelain=v1'), '?? notes.md', "the person's own work is untouched")
  assert.equal(sh(join(s.dir, '.remotes', 'api.git'), 'for-each-ref', '--format=%(refname) %(objectname)'), apiRefs, 'nothing was pushed to a repository of the product')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a paused task is the same: a commit naming it in hold/, pushed', async () => {
  const s = setup()
  const result = await runTask(s.product, s.repo, s.tasks[0], { invoke: red, notify })
  assert.equal(result.outcome, 'escalated')
  assert.equal(s.repository.subjects().split('\n')[0], 'queue: task 0042 wallet-endpoint → hold')
  assert.equal(s.repository.pushed().split('\n')[0], 'queue: task 0042 wallet-endpoint → hold')
})

test('a queue that is not in a repository moves the file and commits nothing', async () => {
  const s = setup({ queue: 'tasks' })
  assert.equal(isRepository(join(s.dir, 'tasks')), false)
  const moved = moveAndRecord(s.product, s.tasks[0], 'done')
  assert.equal(moved.folder, 'done')
  assert.equal(moved.commit, null)
  assert.equal(moved.pushed, null)
  assert.ok(existsSync(join(s.dir, 'tasks', 'done', '0042-wallet-endpoint.md')))
  assert.ok(!existsSync(join(s.dir, 'tasks', 'todo', '0042-wallet-endpoint.md')))
})

test('a queue repository with no remote is committed and not pushed', async () => {
  const s = setup()
  sh(s.repository.dir, 'remote', 'remove', 'origin')
  const moved = moveAndRecord(s.product, s.tasks[0], 'done')
  assert.ok(moved.commit)
  assert.equal(moved.pushed, null, 'there is no next machine to be stale for')
  assert.equal(s.repository.subjects().split('\n')[0], 'queue: task 0042 wallet-endpoint → done')
})

test('a task file the session never committed is moved and committed all the same', async () => {
  const s = setup({ committed: false })
  // Nothing in the queue's repository knows about the task yet: its old path
  // is a pathspec that matches nothing, and naming it would be fatal.
  assert.equal(sh(s.repository.dir, 'ls-files', '--', 'tasks'), '')
  const moved = moveAndRecord(s.product, s.tasks[0], 'done')
  assert.ok(moved.commit)
  assert.deepEqual(sh(s.repository.dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean), ['tasks/done/0042-wallet-endpoint.md'])
})

test('a push that fails ends the run, and what was queued behind it is not started', () => {
  const s = setup({ ids: ['0042', '0043'] })
  sh(s.repository.dir, 'remote', 'set-url', 'origin', join(s.dir, '.remotes', 'gone.git'))

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

  let failed
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, '..', 'cli.mjs'), 'run', '--product', s.dir], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
  } catch (error) {
    failed = error
  }

  assert.ok(failed, 'a run that could not publish the queue is not a successful run')
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /^stopped: the queue could not be pushed to origin main: fatal:.* — 0043 not started$/m)
  assert.match(failed.stdout, /^0042 {2}passed — merged into agent\/dev/m, 'what the task itself did stands')
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'todo', '0043-wallet-endpoint.md')), '0043 was never started')
  assert.deepEqual(readJournal(s.dir).lines.map((l) => [l.task, l.outcome]), [['0042', 'passed']], 'one task ran, and it is in the journal')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a queue repository that will not take the commit ends the run too', async () => {
  const s = setup()
  // A person resolving a conflict in the queue's repository: git refuses a
  // partial commit during a merge, and detent does not resolve one.
  sh(s.repository.dir, 'switch', '--quiet', '-c', 'theirs')
  writeFileSync(join(s.repository.dir, 'README.md'), 'theirs\n')
  sh(s.repository.dir, 'commit', '--quiet', '-am', 'theirs')
  sh(s.repository.dir, 'switch', '--quiet', 'main')
  writeFileSync(join(s.repository.dir, 'README.md'), 'ours\n')
  sh(s.repository.dir, 'commit', '--quiet', '-am', 'ours')
  assert.throws(() => sh(s.repository.dir, 'merge', '--quiet', 'theirs'))

  assert.throws(() => moveAndRecord(s.product, s.tasks[0], 'done'), (error) => {
    assert.equal(error.endsRun, true)
    assert.match(error.message, /^the move of task 0042 to done\/ could not be committed in the queue's repository: fatal: cannot do a partial commit during a merge\.$/)
    return true
  })
})

test('a failed push is the queue\'s own error, with where it was going', async () => {
  const s = setup()
  sh(s.repository.dir, 'remote', 'set-url', 'origin', join(s.dir, '.remotes', 'gone.git'))
  assert.throws(() => moveAndRecord(s.product, s.tasks[0], 'done'), (error) => {
    assert.ok(error instanceof QueueRepositoryError)
    assert.equal(error.endsRun, true)
    assert.match(error.message, /^the queue could not be pushed to origin main: fatal:/)
    return true
  })
  assert.ok(existsSync(join(s.dir, 'agent-loop', 'tasks', 'done', '0042-wallet-endpoint.md')), 'the move and the commit happened; the publishing did not')
  assert.equal(s.repository.subjects().split('\n')[0], 'queue: task 0042 wallet-endpoint → done')
})
