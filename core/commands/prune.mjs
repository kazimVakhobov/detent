// detent prune — delete what a finished task leaves lying about: the
// agent/task-* branches whose work is already on agent/dev, and the attempt
// logs of tasks nobody is going to read again.
//
// A landed task's branch is deleted when it lands; what is left in the
// namespace is paused work a person may still need, and the occasional branch a
// person merged by hand. Only the second kind goes.
//
// An attempt log is not a record (ADR 0021) and this is the command that gives
// it an end: the journal keeps what the run cost and what became of it, and the
// transcript is kept only while somebody might still want to read it. A task in
// `todo/` or `hold/` may yet be resumed and its last attempt is what a person
// opens it to see; a task some run is holding is being written to right now.
// Everything else goes — `done/`, `failed/`, and a task whose file somebody
// deleted, which would otherwise be a transcript with nothing left to attach it
// to. Naming repositories narrows which branches are considered and not which
// logs: a log belongs to a task, and its name does not say which repository the
// task was for.

import process from 'node:process'
import { unlinkSync } from 'node:fs'
import { currentBranch, deleteBranch, git } from '../git.mjs'
import { attemptLogs } from '../log.mjs'
import { isAgentBranch } from '../refs.mjs'
import { readState } from '../state.mjs'
import { readQueue } from '../task.mjs'
import { UsageError } from './usage.mjs'

export const options = { 'dry-run': { type: 'boolean', default: false } }

export function run(product, names, values) {
  const unknown = names.filter((n) => !product.repos.some((r) => r.name === n))
  if (unknown.length) throw new UsageError(`not in product.json: ${unknown.join(', ')}`)
  const repos = names.length ? product.repos.filter((r) => names.includes(r.name)) : product.repos
  const integration = product.branches.integration
  const active = readState(product.dir).repos
  const dry = values['dry-run']

  let gone = 0
  for (const repo of repos) {
    const branches = git(repo.dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/agent/task-*']).split('\n').filter(Boolean)
    for (const branch of branches) {
      if (!isAgentBranch(branch)) continue
      // Its work is all on agent/dev: every commit on it is reachable from there.
      const merged = git(repo.dir, ['rev-list', '--count', `refs/heads/${integration}..refs/heads/${branch}`]) === '0'
      let keep = null
      if (!merged) keep = 'has work not on agent/dev'
      else if (currentBranch(repo.dir) === branch) keep = 'checked out'
      else if (active[repo.name]?.branch === branch) keep = 'its task is running'
      if (keep) {
        process.stdout.write(`${repo.name}  kept     ${branch} — ${keep}\n`)
        continue
      }
      if (!dry) deleteBranch(repo.dir, branch)
      gone += 1
      process.stdout.write(`${repo.name}  ${dry ? 'would go' : 'deleted '} ${branch}\n`)
    }
  }

  gone += pruneLogs(product, active, dry)
  if (gone === 0) process.stdout.write('nothing to prune\n')
  return 0
}

// The attempt logs of settled tasks. Which tasks those are is a question about
// the queue, so a queue that will not read keeps every log and says why: the
// one thing worse than a transcript nobody deletes is one deleted because the
// folder it belonged to could not be opened.
function pruneLogs(product, active, dry) {
  const logs = attemptLogs(product.dir)
  if (logs.length === 0) return 0

  const keep = new Set()
  try {
    for (const task of readQueue(product.dir, product)) {
      if (task.folder === 'todo' || task.folder === 'hold') keep.add(Number(task.id))
    }
  } catch (error) {
    process.stdout.write(`logs      kept     all ${logs.length} — ${product.queue}/ cannot be read, so no task's log is settled: ${(error.problems ?? [error.message])[0]}\n`)
    return 0
  }
  for (const entry of Object.values(active)) if (entry.task) keep.add(Number(entry.task))

  let gone = 0
  for (const log of logs) {
    if (keep.has(log.task)) continue
    if (!dry) {
      try {
        unlinkSync(log.file)
      } catch (error) {
        process.stdout.write(`logs      kept     ${log.name} — ${error.message}\n`)
        continue
      }
    }
    gone += 1
    process.stdout.write(`logs      ${dry ? 'would go' : 'deleted '} ${log.name}\n`)
  }
  return gone
}
