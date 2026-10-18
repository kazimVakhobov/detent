// A task's move between folders, recorded where the queue lives (ADR 0012,
// part 3).
//
// A queue that is not in a repository is a file move and nothing else, which is
// what every product that says nothing about `queue` has, and what ADR 0005
// chose. A queue that *is* a repository is a queue two machines share: a
// session writes tasks on one and a run works them on another, so a task
// reaching done/ or hold/ is a commit there and a push, and the next machine
// reads a queue that is current.
//
// detent pushes this and nothing else — not a product repository, not
// `agent/dev`, not a tag — and commits nothing here but the task files the
// move names.

import { join, relative } from 'node:path'
import { commitPaths, GitError, isRepository, push, upstreamOf } from './git.mjs'
import { moveTask } from './task.mjs'

// The queue's repository would not take the move — it could not be committed,
// or it could not be pushed. Either way the run stops here rather than working
// on: every task after this one would be work the next machine cannot see, and
// a queue two machines disagree about is the one thing a shared queue exists to
// prevent. `endsRun` is what the scheduler reads.
export class QueueRepositoryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'QueueRepositoryError'
    this.endsRun = true
  }
}

// Move `task` to `folder` and record the move where the queue is. Returns the
// moved task with `{ commit, pushed }`: the commit in the queue's repository
// and where it went, each null when there was nothing of the kind to do.
export function moveAndRecord(product, task, folder) {
  const moved = moveTask(product.dir, task, folder, product.queue)
  const dir = join(product.dir, product.queue)
  if (!isRepository(dir)) return { ...moved, commit: null, pushed: null }

  // Pathspecs relative to the queue folder, so that a queue inside a larger
  // repository reaches only its own two files either way.
  const paths = [...new Set([task.file, moved.file].map((file) => relative(dir, file)))]
  const commit = refuse(
    () => commitPaths(dir, paths, `queue: task ${task.id} ${task.slug} → ${folder}\n`),
    (said) => `the move of task ${task.id} to ${folder}/ could not be committed in the queue's repository: ${said}`,
  )

  // Nothing committed is nothing to publish: a queue whose folders the
  // repository ignores is still only a file move, and not a reason to go out
  // to the network once a task.
  const upstream = commit ? upstreamOf(dir) : null
  if (!upstream) return { ...moved, commit, pushed: null }
  const where = `${upstream.remote} ${upstream.ref.replace(/^refs\/heads\//, '')}`
  refuse(() => push(dir, upstream), (said) => `the queue could not be pushed to ${where}: ${said}`)
  return { ...moved, commit, pushed: where }
}

// git saying no here is the end of the run, said in detent's words rather than
// as a failed command: what a person has to fix is in the queue's repository.
function refuse(write, explain) {
  try {
    return write()
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    throw new QueueRepositoryError(explain(error.said))
  }
}
