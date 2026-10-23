// The queue: <queue>/{todo,hold,done,failed}/NNNN-<slug>.md (DESIGN.md §4).
//
// A queue that cannot be executed is rejected before the first agent starts —
// the difference between a typo and three wasted attempts.

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'

export const FOLDERS = ['todo', 'hold', 'done', 'failed']

// Where the queue sits when product.json says nothing: the product root, which
// is what ADR 0005 chose and what `queue` narrows rather than replaces (ADR
// 0012). Nothing here builds a path from the literal — the location arrives as
// an argument, so what is read, written and printed is the same path.
export const QUEUE = 'tasks'

const FILE = /^(\d{4,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const FRONTMATTER_KEYS = ['id', 'repo', 'touches_contract']

// The four folders, created if they are not there. A folder that exists is
// left exactly as it is — what is queued in it is someone's work, and this
// never looks inside. Returns the folders it had to create, so init can say so.
export function createQueue(productDir, queue = QUEUE) {
  const created = []
  for (const folder of FOLDERS) {
    const dir = join(productDir, queue, folder)
    if (existsSync(dir)) continue
    mkdirSync(dir, { recursive: true })
    created.push(folder)
  }
  return created
}

// Which of the four are missing: a queue `run` cannot read from and `plan`
// cannot write into. `doctor` reports this and creates nothing.
export function missingQueue(productDir, queue = QUEUE) {
  return FOLDERS.filter((folder) => !existsSync(join(productDir, queue, folder)))
}

export class QueueError extends Error {
  constructor(problems) {
    super(`the queue cannot be executed:\n${problems.map((p) => `  ${p}`).join('\n')}`)
    this.name = 'QueueError'
    this.problems = problems
  }
}

// Every task in all four folders. Only todo/ is held to the full shape: it is
// what is about to run. The other folders count for identity — the counter
// and uniqueness — and are not re-judged after the fact, so a repository
// removed from product.json does not make history unreadable.
export function readQueue(productDir, product) {
  const problems = []
  const tasks = []
  const unreadable = []
  const repos = new Set(product.repos.map((repo) => repo.name))
  // Not defaulted: a product always carries its queue's location, and falling
  // back to `tasks` would read the wrong queue quietly.
  const queue = product.queue

  for (const folder of FOLDERS) {
    const dir = join(productDir, queue, folder)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      const where = `${queue}/${folder}/${entry.name}`
      if (!entry.isFile()) {
        problems.push(`${where}: only task files belong here`)
        continue
      }
      const match = FILE.exec(entry.name)
      if (!match) {
        problems.push(`${where}: not a task file name — expected NNNN-<slug>.md, slug in lowercase-with-dashes`)
        continue
      }

      const file = join(dir, entry.name)
      const [, id, slug] = match
      if (folder !== 'todo') {
        tasks.push({ id, slug, folder, file })
        continue
      }

      const { task, problems: found } = parseTask(readFileSync(file, 'utf8'), { id, slug })
      for (const problem of found) problems.push(`${where}: ${problem}`)
      if (!task) {
        // Its number is in its file name, so it still takes part in the
        // uniqueness check: a broken task is no excuse for a second one.
        unreadable.push({ id, slug, folder, file })
        continue
      }
      if (!repos.has(task.repo)) problems.push(`${where}: repo "${task.repo}" is not in product.json`)
      tasks.push({ ...task, folder, file })
    }
  }

  // The number is the key, compared as a number: 0042 and 00042 are one task.
  const byNumber = new Map()
  for (const task of [...tasks, ...unreadable].sort((a, b) => FOLDERS.indexOf(a.folder) - FOLDERS.indexOf(b.folder) || a.file.localeCompare(b.file))) {
    const n = Number(task.id)
    const first = byNumber.get(n)
    if (first) problems.push(`${queue}/${task.folder}/${task.id}-${task.slug}.md: id ${task.id} is already taken by ${queue}/${first.folder}/${first.id}-${first.slug}.md`)
    else byNumber.set(n, task)
  }

  if (problems.length > 0) throw new QueueError(problems)
  return tasks.sort((a, b) => Number(a.id) - Number(b.id))
}

// The one file in the queue whose number this is, and the folder it is in — or
// null for a number that is in none of them.
//
// Nothing is opened and nothing is parsed: the four folders are read by name
// only, so a number resolves to a file in a queue `readQueue` would refuse
// whole, which is what lets a task that will not parse still be opened (ADR
// 0020 part 3). The number is matched as digits and compared as a number — it
// is never joined to a path, so 42, 0042 and 00042 are one task and nothing
// outside the queue is reachable by asking for one.
export function findTask(productDir, product, number) {
  if (!/^\d+$/.test(String(number))) return null
  // Not defaulted, for `readQueue`'s reason: a product carries its queue.
  const queue = product.queue

  for (const folder of FOLDERS) {
    const dir = join(productDir, queue, folder)
    let entries
    try {
      entries = readdirSync(dir)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    for (const name of entries.sort((a, b) => a.localeCompare(b))) {
      const match = FILE.exec(name)
      if (!match || Number(match[1]) !== Number(number)) continue
      return { id: match[1], slug: match[2], folder, file: join(dir, name), where: `${queue}/${folder}/${name}` }
    }
  }
  return null
}

// The counter is the highest number across all four folders: there is no
// counter file, and therefore nothing that can disagree with reality.
export function nextId(tasks) {
  const highest = tasks.reduce((max, task) => Math.max(max, Number(task.id)), 0)
  return String(highest + 1).padStart(4, '0')
}

// A task changes folder; its number and its name do not. The destination is
// never overwritten — a file already there is someone's task. A hard link and
// an unlink, rather than a rename, because rename replaces silently.
export function moveTask(productDir, task, folder, queue = QUEUE) {
  if (!FOLDERS.includes(folder)) throw new Error(`"${folder}" is not one of ${FOLDERS.join(', ')}`)
  const name = basename(task.file)
  const target = join(productDir, queue, folder, name)
  if (target === task.file) return task
  mkdirSync(join(productDir, queue, folder), { recursive: true })
  if (existsSync(target)) throw new Error(`${queue}/${folder}/${name} already exists`)
  linkSync(task.file, target)
  unlinkSync(task.file)
  return { ...task, folder, file: target }
}

export function taskBranch(product, task) {
  return product.branches.task.replaceAll('{id}', task.id).replaceAll('{slug}', task.slug)
}

// What a task file says about itself when nothing is judging it: the two
// facts in its frontmatter that decide what a run may start, and nothing else.
//
// `readQueue` holds todo/ to the full shape and reads nothing in the other
// three, which is right — history is not re-judged. But a paused task's
// number, its repository and whether it changes a contract are what the
// scheduler's second rule is about (§8), and that rule outlives the run that
// paused it (ADR 0024). A task whose criteria are being rewritten in hold/
// still bars what stands behind it, so nothing here is a problem to report: a
// file that cannot be read says nothing and bars nothing.
export function declares(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { repo: null, touchesContract: false }
  }
  const { fields } = frontmatter(text)
  return { repo: fields.repo ?? null, touchesContract: fields.touches_contract === 'true' }
}

// One task file's text, judged against the identity its file name gives it.
export function parseTask(text, { id, slug }) {
  const source = text.replaceAll('\r\n', '\n')
  const { fields, problems, body: rest, found } = frontmatter(source)
  if (!found) return { task: null, problems: ['has no frontmatter — it must open with a --- block'] }

  if (fields.id === undefined) problems.push('frontmatter has no id')
  else if (fields.id !== id) {
    // The number appears in both places so it is visible whichever was opened;
    // two numbers that disagree are two answers to "which task is this".
    problems.push(`frontmatter id ${fields.id || '(empty)'} disagrees with the file name's ${id}`)
  }

  if (!fields.repo) problems.push('frontmatter has no repo')

  let touchesContract = false
  if (fields.touches_contract !== undefined) {
    if (fields.touches_contract === 'true') touchesContract = true
    else if (fields.touches_contract !== 'false') problems.push('touches_contract must be true or false')
  }

  // Only the body reaches the agent: the spec written before the work is the prompt.
  const body = rest
  const criteria = section(body, 'acceptance criteria')
    .filter((line) => /^\s*[-*]\s+\[[ xX]\]\s+\S/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, '').trim())
  if (criteria.length === 0) {
    problems.push('has no acceptance criteria — "# Acceptance criteria" needs at least one "- [ ] …"')
  }

  if (problems.length > 0) return { task: null, problems }
  return { task: { id, slug, repo: fields.repo, touchesContract, body, criteria }, problems }
}

// The lines under a heading, up to the next heading of the same or a higher
// level. Exported because the page shows the same sections `run` sends to the
// agent, from the same parse (ADR 0020 part 3).
export function section(body, title) {
  const lines = body.split('\n')
  const start = lines.findIndex((line) => {
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    return heading && heading[2].toLowerCase() === title
  })
  if (start === -1) return []
  const level = /^(#+)/.exec(lines[start])[1].length
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => {
    const heading = /^(#{1,6})\s/.exec(line)
    return heading && heading[1].length <= level
  })
  return end === -1 ? rest : rest.slice(0, end)
}

// The block a task file opens with, and the body under it. Read by the whole
// parse above and by `declares` on its own, so that one file is read one way
// wherever the question comes from.
function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source)
  if (!match) return { found: false, fields: {}, problems: [], body: source }

  const problems = []
  const fields = {}
  match[1].split('\n').forEach((line, index) => {
    if (line.trim() === '' || line.trim().startsWith('#')) return
    const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/.exec(line)
    if (!pair) return problems.push(`frontmatter line ${index + 1} is not "key: value"`)
    const [, key, value] = pair
    if (!FRONTMATTER_KEYS.includes(key)) {
      return problems.push(`frontmatter key "${key}" is unknown — expected one of ${FRONTMATTER_KEYS.join(', ')}`)
    }
    if (Object.hasOwn(fields, key)) return problems.push(`frontmatter key "${key}" appears twice`)
    fields[key] = unquote(value)
  })

  return { found: true, fields, problems, body: source.slice(match[0].length).replace(/^\n+/, '') }
}

function unquote(value) {
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(value)
  return quoted ? (quoted[1] ?? quoted[2]) : value
}
