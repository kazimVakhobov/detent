// git, as detent is allowed to use it.
//
// Every function here that moves a ref or HEAD takes the branch it writes and
// passes it through assertAgentRef first — the one predicate of DESIGN.md §13,
// checked on every write path rather than remembered at each call site. Two
// things are outside that predicate and say so where they are defined: the
// submodules detent keeps current, which are commits rather than refs, and the
// queue's own repository, which is the one thing detent pushes (ADR 0012).

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isAgentBranch } from './refs.mjs'

export class GitError extends Error {
  constructor(args, cwd, stderr) {
    super(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim()}`)
    this.name = 'GitError'
    this.stderr = stderr
  }

  // What git said, without the screens of hint that can follow it — for the
  // places where a person reads the reason rather than the command.
  get said() {
    const lines = this.stderr.split('\n').map((line) => line.trim()).filter(Boolean)
    return lines.filter((line) => /^(fatal:|error:|warning:|! \[)/.test(line)).join('; ') || lines[0] || this.message
  }
}

export class BoundaryError extends Error {
  constructor(branch) {
    super(`refusing to write "${branch}": detent writes only under refs/heads/agent/`)
    this.name = 'BoundaryError'
  }
}

export function assertAgentRef(branch) {
  if (!isAgentBranch(branch)) throw new BoundaryError(branch)
  return branch
}

export function git(cwd, args, { env, input } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).replace(/\n$/, '')
  } catch (error) {
    throw new GitError(args, cwd, `${error.stderr ?? ''}${error.message && !error.stderr ? error.message : ''}`)
  }
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

// --- reading: never restricted -------------------------------------------------

export function isRepository(cwd) {
  return existsSync(cwd) && tryGit(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true'
}

export function currentBranch(cwd) {
  return tryGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
}

export function branchExists(cwd, branch) {
  return tryGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]) !== null
}

export function tip(cwd, branch) {
  return git(cwd, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`])
}

// Untracked files count: a file the person created and has not added yet is
// work, and stepping over it is how it gets lost. Ignored files do not.
export function isClean(cwd) {
  return git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']) === ''
}

const OPERATIONS = [
  ['MERGE_HEAD', 'merge'],
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
]

// The operation git is in the middle of, or null.
export function operationInProgress(cwd) {
  for (const [marker, operation] of OPERATIONS) {
    let path = git(cwd, ['rev-parse', '--git-path', marker])
    if (!isAbsolute(path)) path = join(cwd, path)
    if (existsSync(path)) return operation
  }
  return null
}

// Every ref, with what it points at. The invariant is asserted on this.
export function snapshotRefs(cwd) {
  const refs = new Map()
  const out = git(cwd, ['for-each-ref', '--format=%(refname) %(objectname)'])
  for (const line of out.split('\n').filter(Boolean)) {
    const [name, object] = line.split(' ')
    refs.set(name, object)
  }
  return refs
}

// --- writing: agent/ only -------------------------------------------------------

export function createBranch(cwd, branch, start) {
  assertAgentRef(branch)
  assertAgentRef(start)
  git(cwd, ['checkout', '--quiet', '-b', branch, `refs/heads/${start}`])
}

// Continue on a task branch that already exists — a paused task resumed.
export function checkoutBranch(cwd, branch) {
  assertAgentRef(branch)
  git(cwd, ['checkout', '--quiet', branch])
}

// Point an agent branch at a commit — to put agent/dev back where a run found
// it, or to keep commits that landed where they should not have.
export function setRef(cwd, branch, commit, reason) {
  assertAgentRef(branch)
  git(cwd, ['update-ref', '-m', `detent: ${reason}`, `refs/heads/${branch}`, commit])
}

// Stage the merge of `branch` into `into` on a detached HEAD, without
// committing it and without moving `into`, so the merged tree can be checked
// first. Returns { conflicts } — aborted here, never resolved — or { ready }.
export function beginMerge(cwd, into, branch) {
  assertAgentRef(into)
  assertAgentRef(branch)
  git(cwd, ['checkout', '--quiet', '--detach', `refs/heads/${into}`])
  try {
    git(cwd, ['merge', '--no-ff', '--no-commit', '--quiet', `refs/heads/${branch}`], { env: identity(cwd) })
    return { ready: true }
  } catch (error) {
    if (operationInProgress(cwd) !== 'merge') throw error
    const conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)
    git(cwd, ['merge', '--abort'])
    return { conflicts }
  }
}

// Commit the staged merge — no hooks — and move `into` to it, refusing if
// `into` moved meanwhile. Then stand on `into`.
export function concludeMerge(cwd, into, expected, message) {
  assertAgentRef(into)
  git(cwd, ['commit', '--quiet', '--no-verify', '-F', '-'], { env: identity(cwd), input: message })
  const commit = git(cwd, ['rev-parse', 'HEAD'])
  git(cwd, ['update-ref', '-m', 'detent: land a task', `refs/heads/${into}`, commit, expected])
  git(cwd, ['checkout', '--quiet', into])
  return commit
}

export function abortMerge(cwd) {
  if (operationInProgress(cwd) === 'merge') git(cwd, ['merge', '--abort'])
}

export function deleteBranch(cwd, branch) {
  assertAgentRef(branch)
  git(cwd, ['branch', '--quiet', '-D', branch])
}

// A branch without checking it out — for parking work when the task branch was
// never created because the run died first.
export function createRef(cwd, branch, start) {
  assertAgentRef(branch)
  assertAgentRef(start)
  git(cwd, ['branch', '--quiet', '--no-track', branch, `refs/heads/${start}`])
}

// Discards the working tree. Only called once whatever was in it has been
// committed somewhere it can be recovered from.
export function forceCheckout(cwd, branch) {
  assertAgentRef(branch)
  git(cwd, ['checkout', '--quiet', '--force', branch])
  git(cwd, ['clean', '--quiet', '--force', '-d'])
}

export function abortOperation(cwd, operation) {
  git(cwd, [operation, '--abort'])
}

// Commit the whole working tree, as it is, onto `branch` — without checking it
// out, without touching the index the person sees, and without running hooks:
// a pre-commit hook that fails is exactly the situation in which the work most
// needs saving, and the gauge, not a hook, is what decides green. Paths in
// `exclude` (neverCommit) keep the branch's version. Returns the new commit,
// or null if there was nothing to save.
export function snapshotOnto(cwd, branch, message, { exclude = [], allowEmpty = false } = {}) {
  assertAgentRef(branch)
  let index = git(cwd, ['rev-parse', '--git-path', `detent-index-${process.pid}`])
  if (!isAbsolute(index)) index = join(cwd, index)
  const env = { GIT_INDEX_FILE: index, ...identity(cwd) }
  try {
    const head = tryGit(cwd, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (head) git(cwd, ['read-tree', head], { env })
    git(cwd, ['add', '--all'], { env })
    const parent = tip(cwd, branch)
    for (const path of exclude) git(cwd, ['reset', '--quiet', parent, '--', path], { env })
    const tree = git(cwd, ['write-tree'], { env })
    if (!allowEmpty && git(cwd, ['rev-parse', `${parent}^{tree}`]) === tree) return null
    const commit = git(cwd, ['commit-tree', tree, '-p', parent, '-F', '-'], { env, input: message })
    git(cwd, ['update-ref', '-m', 'detent: commit the working tree', `refs/heads/${branch}`, commit, parent])
    // Standing on that branch, the person's index now lags the commit it
    // describes; bring it level. No ref moves.
    if (currentBranch(cwd) === branch) git(cwd, ['reset', '--quiet'])
    return commit
  } finally {
    rmSync(index, { force: true })
  }
}

// --- the shared context: submodules ---------------------------------------------
//
// A submodule is a commit, not a ref, so assertAgentRef has nothing to say
// about it. detent moves one in two directions only (ADR 0012): forward to its
// remote's tip before a task starts, which is the state the agent reads, and
// back to the commit the superproject records when a task did not commit the
// pointer it moved. Nothing here is called for a submodule in neverCommit.

// Every submodule path .gitmodules declares, whether or not it is initialised:
// what the repository says it has, read without asking git to look inside.
export function submodulePaths(cwd) {
  const out = tryGit(cwd, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'])
  if (!out) return []
  return out.split('\n').filter(Boolean).map((line) => line.slice(line.indexOf(' ') + 1))
}

// Whether a declared submodule is checked out here. An uninitialised one is an
// empty folder, and a git question asked inside it is answered by the
// superproject — so it is asked of the filesystem instead. A run initialises
// one on its way to the remote's tip; until then there is no commit to judge.
export function submoduleCheckedOut(cwd, path) {
  return existsSync(join(cwd, path, '.git'))
}

// Fetch a submodule and move it to its remote's tip. Leaves it detached there,
// which is what the superproject's pointer will record.
export function refreshSubmodule(cwd, path) {
  git(cwd, ['submodule', 'update', '--init', '--remote', '--', path])
}

// Back to the commit the superproject's tree records. No network: that commit
// is one this repository already has, since it was in the tree a moment ago.
export function resetSubmodule(cwd, path) {
  git(cwd, ['submodule', 'update', '--init', '--force', '--', path])
}

export function submoduleCommit(cwd, path) {
  return git(join(cwd, path), ['rev-parse', 'HEAD'])
}

// Which of `paths` the superproject reports as moved — the ` M <path>` a
// refreshed submodule produces until its pointer is committed.
export function movedSubmodules(cwd, paths) {
  if (paths.length === 0) return []
  const out = git(cwd, ['status', '--porcelain=v1', '--ignore-submodules=none', '--', ...paths])
  return out.split('\n').filter(Boolean).map((line) => line.slice(3)).filter((path) => paths.includes(path))
}

// The submodule's own remote branches that contain its checked-out commit.
// Empty is exactly the commit that was never pushed, which is the one thing
// §13 refuses to put in a pointer. Somebody may have pushed it since the
// refresh, so an empty answer is fetched again before it is believed — and a
// fetch that fails leaves the answer as it was rather than inventing one.
export function remoteBranchesContaining(cwd, path) {
  const dir = join(cwd, path)
  const contains = () => git(dir, ['branch', '--remotes', '--contains', 'HEAD']).split('\n').map((line) => line.trim()).filter(Boolean)
  const found = contains()
  if (found.length > 0) return found
  tryGit(dir, ['fetch', '--quiet'])
  return contains()
}

// --- the queue's own repository --------------------------------------------------
//
// The queue is detent's bookkeeping rather than anybody's work, and a run that
// cannot publish it leaves the next machine a stale todo (ADR 0012). So these
// two write outside refs/heads/agent/ — in the one repository that holds no
// product code, touching nothing but the task files a move names. Every ref in
// every repository of the product still goes through assertAgentRef.

// Commit exactly `paths`, as they are on disk, without hooks and without
// disturbing what else the person has staged. Returns the commit, or null when
// those paths already say what HEAD says.
export function commitPaths(cwd, paths, message) {
  const env = identity(cwd)
  // A task file the session never committed is untracked, and after the move
  // its old path is neither on disk nor in the index: naming it would be a
  // pathspec that matches nothing, which git calls fatal.
  const known = new Set(git(cwd, ['ls-files', '--', ...paths]).split('\n').filter(Boolean))
  const real = paths.filter((path) => known.has(path) || existsSync(join(cwd, path)))
  if (real.length === 0) return null
  git(cwd, ['add', '--all', '--', ...real], { env })
  if (tryGit(cwd, ['rev-parse', '--verify', 'HEAD']) && git(cwd, ['diff', '--cached', '--name-only', '--', ...real]) === '') return null
  git(cwd, ['commit', '--quiet', '--no-verify', '--only', '-F', '-', '--', ...real], { env, input: message })
  return git(cwd, ['rev-parse', 'HEAD'])
}

// Where the checked-out branch says it is published, or null when it says
// nowhere — a queue in a repository with no remote has no next machine to be
// stale for.
export function upstreamOf(cwd) {
  const branch = currentBranch(cwd)
  if (!branch) return null
  const remote = tryGit(cwd, ['config', `branch.${branch}.remote`])
  const ref = tryGit(cwd, ['config', `branch.${branch}.merge`])
  return remote && ref ? { remote, ref } : null
}

// One refspec, the one the branch itself names: never bare `git push`, whose
// meaning depends on a push.default this repository did not choose.
export function push(cwd, { remote, ref }) {
  git(cwd, ['push', '--quiet', remote, `HEAD:${ref}`])
}

// A wip commit must not fail for want of an identity on a fresh machine.
function identity(cwd) {
  const env = {}
  if (!tryGit(cwd, ['config', 'user.name'])) {
    env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 'detent'
  }
  if (!tryGit(cwd, ['config', 'user.email'])) {
    env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 'detent@localhost'
  }
  return env
}
