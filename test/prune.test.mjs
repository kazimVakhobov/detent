import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../core/commands/prune.mjs'
import { snapshotRefs } from '../core/git.mjs'
import { attemptLogPath, openAttemptLog } from '../core/log.mjs'
import { claim } from '../core/state.mjs'
import { gitProduct, sh } from './support/product.mjs'

function commitOn(repoDir, branch, file) {
  sh(repoDir, 'switch', '--quiet', '-c', branch, 'agent/dev')
  writeFileSync(join(repoDir, file), `${file}\n`)
  sh(repoDir, 'add', '.')
  sh(repoDir, 'commit', '--quiet', '-m', file)
  sh(repoDir, 'switch', '--quiet', 'agent/dev')
}

function prune(s, values = {}) {
  const out = []
  const write = process.stdout.write
  process.stdout.write = (chunk) => (out.push(String(chunk)), true)
  try {
    return { code: run(s.product, [], { 'dry-run': false, ...values }), out: out.join('') }
  } finally {
    process.stdout.write = write
  }
}

function setup() {
  const s = gitProduct()
  // Merged by hand into agent/dev: its work is all there.
  commitOn(s.repoDir, 'agent/task-0001-landed', 'one.txt')
  sh(s.repoDir, 'merge', '--quiet', '--no-ff', '-m', 'merge', 'agent/task-0001-landed')
  // Paused: work that never landed.
  commitOn(s.repoDir, 'agent/task-0002-paused', 'two.txt')
  // Stray: commits an agent put on agent/dev, kept aside — not on agent/dev now.
  commitOn(s.repoDir, 'agent/task-0003-x-stray', 'three.txt')
  // A branch outside the task prefix, merged: not prune's to touch.
  sh(s.repoDir, 'branch', 'agent/staging', 'agent/dev')
  sh(s.repoDir, 'branch', 'feature/merged-human', 'agent/dev')
  return s
}

test('only task branches whose work is all on agent/dev go', () => {
  const s = setup()
  const { code, out } = prune(s)
  assert.equal(code, 0)
  assert.match(out, /deleted +agent\/task-0001-landed/)
  assert.match(out, /kept +agent\/task-0002-paused — has work not on agent\/dev/)
  assert.match(out, /kept +agent\/task-0003-x-stray — has work not on agent\/dev/)
  const refs = [...snapshotRefs(s.repoDir).keys()]
  assert.ok(!refs.includes('refs/heads/agent/task-0001-landed'))
  for (const kept of ['agent/task-0002-paused', 'agent/task-0003-x-stray', 'agent/staging', 'feature/merged-human', 'dev', 'agent/dev']) {
    assert.ok(refs.includes(`refs/heads/${kept}`), kept)
  }
})

test('--dry-run deletes nothing', () => {
  const s = setup()
  const before = snapshotRefs(s.repoDir)
  assert.match(prune(s, { 'dry-run': true }).out, /would go agent\/task-0001-landed/)
  assert.deepEqual(snapshotRefs(s.repoDir), before)
})

// --- the attempt logs, which this is the only thing that deletes (ADR 0021) ---

// A queue with one task in each folder, and an attempt log for every one of
// them: this is the command that gives a transcript an end.
function logged(s) {
  for (const [folder, id] of [['todo', '0010'], ['hold', '0011'], ['done', '0012'], ['failed', '0013']]) {
    mkdirSync(join(s.dir, 'tasks', folder), { recursive: true })
    writeFileSync(join(s.dir, 'tasks', folder, `${id}-task.md`), `---\nid: ${id}\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n`)
  }
  for (const id of ['0010', '0011', '0012', '0013', '0014']) openAttemptLog(s.dir, id, 1).close()
  return s
}

test('a settled task\'s log goes; one a person may still open stays', () => {
  const s = logged(gitProduct())
  const { code, out } = prune(s)
  assert.equal(code, 0)

  // done/ and failed/ are finished with, and 0014 is a log whose task file
  // somebody deleted — a transcript with nothing left to attach it to.
  for (const id of ['0012', '0013', '0014']) {
    assert.match(out, new RegExp(`logs +deleted +${id}-attempt-1\\.jsonl`), id)
    assert.ok(!existsSync(attemptLogPath(s.dir, id, 1)), id)
  }
  // todo/ has not run yet and hold/ may be resumed: its last attempt is what a
  // person opens the task to read.
  for (const id of ['0010', '0011']) {
    assert.ok(existsSync(attemptLogPath(s.dir, id, 1)), id)
    assert.doesNotMatch(out, new RegExp(`${id}-attempt-1`), id)
  }
})

test('a log is kept while its task is running, and --dry-run deletes none of them', () => {
  const s = logged(gitProduct())
  // Moved to done/ by hand under a run that is still going: the file is being
  // written to right now.
  renameSync(join(s.dir, 'tasks', 'done', '0012-task.md'), join(s.dir, 'tasks', 'todo', '0012-task.md'))
  claim(s.dir, 'acme-api', { task: '0012', branch: 'agent/task-0012-task' })

  assert.match(prune(s, { 'dry-run': true }).out, /logs +would go 0013-attempt-1\.jsonl/)
  for (const id of ['0012', '0013']) assert.ok(existsSync(attemptLogPath(s.dir, id, 1)), `${id} after --dry-run`)
  prune(s)
  assert.ok(existsSync(attemptLogPath(s.dir, '0012', 1)), 'its task is running')
  assert.ok(!existsSync(attemptLogPath(s.dir, '0013', 1)))
})

test('a queue that will not read keeps every log, and says why', () => {
  const s = logged(gitProduct())
  writeFileSync(join(s.dir, 'tasks', 'todo', 'nope.md'), 'not a task file name\n')
  const { out } = prune(s)
  assert.match(out, /logs +kept +all 5 — tasks\/ cannot be read, so no task's log is settled: .*not a task file name/)
  for (const id of ['0010', '0011', '0012', '0013', '0014']) assert.ok(existsSync(attemptLogPath(s.dir, id, 1)), id)
})

test('a merged branch that is checked out, or whose task is running, is kept', () => {
  const s = gitProduct()
  sh(s.repoDir, 'branch', 'agent/task-0004-here', 'agent/dev')
  sh(s.repoDir, 'branch', 'agent/task-0005-running', 'agent/dev')
  sh(s.repoDir, 'switch', '--quiet', 'agent/task-0004-here')
  claim(s.dir, 'acme-api', { task: '0005', branch: 'agent/task-0005-running' })
  const { out } = prune(s)
  assert.match(out, /kept +agent\/task-0004-here — checked out/)
  assert.match(out, /kept +agent\/task-0005-running — its task is running/)
  assert.match(out, /nothing to prune/)
})
