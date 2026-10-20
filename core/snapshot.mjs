// Everything the dashboard shows, read in one pass from what already exists:
// product.json, state.json, the queue, the journal and git. Nothing here
// writes; a dashboard that changed the product would be a second writer, and
// two writers shuffling the same files is a bug that arrives later (§12).

import { readFileSync } from 'node:fs'
import { branchExists, currentBranch, git, isClean } from './git.mjs'
import { batches, blindSpot, byModel, byRepo, readJournal, summarise } from './journal.mjs'
import { isAlive, readState } from './state.mjs'
import { FOLDERS, readQueue } from './task.mjs'

export function snapshot(product, { now = new Date() } = {}) {
  const { lines, unreadable } = readJournal(product.dir)
  const tasks = lines.filter((l) => l.kind === 'task')
  const last = new Map()
  for (const line of tasks) if (line.outcome !== 'skipped') last.set(Number(line.task), line)

  const state = readState(product.dir)
  const active = Object.entries(state.repos).map(([repo, entry]) => ({ repo, ...entry, alive: isAlive(entry.pid) }))

  let queue
  let queueProblems = []
  try {
    queue = readQueue(product.dir, product)
  } catch (error) {
    queue = []
    queueProblems = error.problems ?? [error.message]
  }

  const folders = Object.fromEntries(FOLDERS.map((f) => [f, []]))
  for (const task of queue) {
    const previous = last.get(Number(task.id))
    folders[task.folder].push({
      id: task.id,
      slug: task.slug,
      repo: task.repo ?? previous?.repo ?? repoFromFile(task.file),
      // Why it stopped, for a paused task: the question a person opens hold/ with.
      outcome: previous?.outcome ?? null,
      reason: previous?.reason ?? null,
      doubts: previous?.acceptance?.doubts ?? [],
      branch: previous?.branch ?? null,
      // Whether it runs alone. `readQueue` has already parsed this for every
      // task in todo/ — it is the one field the scheduler branches on (§8) —
      // and it was dropped here, which left the page listing a barrier as one
      // more row. The other three folders are never opened, so it is false
      // there for the same reason their criteria are absent.
      touchesContract: task.touchesContract === true,
    })
  }

  const all = summarise(tasks, () => 'all')[0] ?? null

  return {
    // The queue's location travels with the snapshot: the page says where an
    // empty queue is, and that is wherever this product's queue is (ADR 0012).
    product: { name: product.name, summary: product.summary, dir: product.dir, queue: product.queue },
    generated: now.toISOString(),
    running: active.some((a) => a.alive),
    active,
    repos: product.repos.map((repo) => standing(product, repo, active.find((a) => a.repo === repo.name))),
    queue: folders,
    queueProblems,
    numbers: {
      all,
      byRepo: summarise(tasks, byRepo),
      byModel: summarise(tasks, byModel),
      blindSpot: blindSpot(tasks),
      batches: batches(lines),
      skipped: tasks.filter((l) => l.outcome === 'skipped').length,
      unreadable,
    },
    recent: tasks.slice(-15).reverse(),
  }
}

// Where a repository's agent/dev stands against its human branch — reported,
// never acted on (§2). Reading a ref is not touching a branch.
//
// Which models it uses are not here: they are read from the configuration,
// which is the one place they are written, and a second copy of that fact was
// free to disagree with the first (ADR 0020 part 2).
function standing(product, repo, active) {
  const integration = product.branches.integration
  const base = {
    name: repo.name,
    compare: repo.compare,
    lock: repo.gauge.exit.length ? 'enforced' : 'absent',
    gauge: repo.gauge.exit.map((s) => s.stage),
    active: active ? { task: active.task, attempt: active.attempt, started: active.started, alive: active.alive } : null,
  }
  let head
  try {
    head = { branch: currentBranch(repo.dir), clean: isClean(repo.dir) }
  } catch {
    return { ...base, missing: true }
  }
  if (!branchExists(repo.dir, integration)) return { ...base, ...head, integration: null }
  if (!branchExists(repo.dir, repo.compare)) return { ...base, ...head, integration, divergence: null }

  const [ahead, behind] = git(repo.dir, ['rev-list', '--left-right', '--count', `refs/heads/${integration}...refs/heads/${repo.compare}`])
    .split(/\s+/)
    .map(Number)
  // "3 tasks ahead" reads better than "17 commits ahead": count what landed.
  const tasksAhead = git(repo.dir, ['log', '--format=%(trailers:key=Task,valueonly)', '--merges', `refs/heads/${repo.compare}..refs/heads/${integration}`])
    .split('\n')
    .filter(Boolean).length
  return { ...base, ...head, integration, divergence: { ahead, behind, tasksAhead } }
}

function repoFromFile(file) {
  try {
    return /^repo:\s*(.+?)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1] ?? null
  } catch {
    return null
  }
}
