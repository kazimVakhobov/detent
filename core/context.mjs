// The shared context: the submodules a product mounts so that a dispatched
// agent reads the documents, the kit and the decisions without leaving the
// working copy it was given (ADR 0012, parts 1 and 2).
//
// Two moments, and nothing between them:
//
//   before the first turn  → every tracked submodule is fetched and moved to
//                            its remote's tip. The agent reads the context as
//                            of the moment its task started; what somebody
//                            pushes afterwards is not its business.
//   before the commit      → every tracked submodule's commit is tested
//                            against its own remote. A commit no remote branch
//                            contains is a pointer to nowhere, which §13
//                            refuses — so the task pauses and says which
//                            submodule, rather than dropping the pointer and
//                            recording that the agent read something it did not.
//
// "Tracked" is one question with one answer: a submodule is tracked when it is
// not in `neverCommit`. One that is in `neverCommit` is not fetched, not moved
// and not committed, and the sentence the prompt gives the agent about it is
// the one it always gave — a product that mounts nothing notices none of this.

import { GitError, movedSubmodules, refreshSubmodule, remoteBranchesContaining, resetSubmodule, submoduleCommit, submodulePaths } from './git.mjs'

// What .gitmodules declares, less what the repository said never to commit.
export function trackedSubmodules(repo) {
  return submodulePaths(repo.dir).filter((path) => !repo.neverCommit.includes(path))
}

// Bring each one to its remote's tip, and say which commit that turned out to
// be: the journal's record of what the agent actually read. A submodule that
// cannot be reached is not quietly worked around — the task would then be done
// against a context nobody chose, and the record would say otherwise.
export function refreshContext(cwd, paths) {
  const commits = {}
  for (const path of paths) {
    try {
      refreshSubmodule(cwd, path)
    } catch (error) {
      if (!(error instanceof GitError)) throw error
      return { commits, problem: `the shared context could not be brought up to date: ${path} — ${error.said}` }
    }
    commits[path] = submoduleCommit(cwd, path)
  }
  return { commits, problem: null }
}

// The check that replaced the prohibition (ADR 0012): the first submodule whose
// commit no remote branch of its own contains, named, or null.
export function unpushedContext(cwd, paths) {
  for (const path of paths) {
    if (remoteBranchesContaining(cwd, path).length > 0) continue
    const commit = submoduleCommit(cwd, path)
    return `the submodule ${path} is at ${commit.slice(0, 7)}, which is in none of its remote branches — it has unpushed commits, so this task cannot record which revision it read; push ${path} first`
  }
  return null
}

// Put back every tracked submodule the tree still reports as moved. A run that
// did not commit a pointer it moved would otherwise leave the superproject
// dirty with nobody's work in it, and the next run would find the tree unclean
// and skip the repository — the collision ADR 0012 measured.
export function restoreContext(cwd, paths) {
  for (const path of movedSubmodules(cwd, paths)) resetSubmodule(cwd, path)
}
