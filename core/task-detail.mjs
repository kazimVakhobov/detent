// One task, opened by its number: what the page has never shown (ADR 0020
// part 3). Its frontmatter, its goal, its criteria, its out-of-scope, and what
// its attempts did.
//
// Nothing here writes, and nothing here is computed. The sections are the ones
// `parseTask` already finds because `run` needs them; the history is the
// journal's own lines; whether the task's links resolved is what the run
// recorded, and never a second answer to a question ADR 0014 decided is asked
// before a task starts.
//
// Two facts about the queue shape this, and neither is relaxed to make one
// task easier to fetch. `readQueue` parses `todo/` only, so a task that has
// already run is a file nothing in this process has read; and it throws with
// every problem at once, so one unreadable file means there is no queue to look
// a task up in — which is what keeps a typo from costing three attempts (§4).
// So the number is resolved by file name and the one file is read directly,
// which works in a product whose queue does not.

import { readFileSync } from 'node:fs'
import { readJournal } from './journal.mjs'
import { findTask, parseTask, readQueue, section } from './task.mjs'

// What the page asked for, which is digits or a refusal. A number is never a
// path: anything that is not digits is refused before a file is opened, so
// asking for a traversal gets a sentence rather than a file.
export function openTask(product, asked) {
  const number = String(asked ?? '').trim()
  if (!/^\d+$/.test(number)) {
    return { refused: 'number', message: `"${number}" is not a task number — a task is opened by the digits in its name` }
  }

  const found = findTask(product.dir, product, number)
  if (!found) return missing(product, number)

  // Every line for this number and no others, in the order they were appended:
  // a task's attempts, what became of each, what it cost, what the reviewer
  // said and whether its links checked.
  const history = readJournal(product.dir).lines.filter((line) => line.kind === 'task' && Number(line.task) === Number(number))
  const text = readFileSync(found.file, 'utf8')
  const { task, problems } = parseTask(text, { id: found.id, slug: found.slug })
  const base = { id: found.id, slug: found.slug, folder: found.folder, where: found.where, history }

  // A file that will not parse still opens: what it says, and what is wrong
  // with it. A task nobody can open is a task nobody can fix.
  if (!task) return { ...base, frontmatter: null, goal: [], criteria: [], outOfScope: [], unreadable: { problems, text } }

  return {
    ...base,
    frontmatter: { id: task.id, repo: task.repo, touches_contract: task.touchesContract },
    goal: section(task.body, 'goal'),
    criteria: task.criteria,
    outOfScope: section(task.body, 'out of scope'),
    unreadable: null,
  }
}

// Nothing in the queue has this number — or the queue is the thing that is
// broken, which is a different sentence and the only one that says what to do
// about it. The detail does not report a task missing from a queue it could
// not read.
function missing(product, number) {
  try {
    readQueue(product.dir, product)
  } catch (error) {
    return {
      refused: 'queue',
      message: `the queue at ${product.queue}/ cannot be read, so no task can be looked up in it`,
      problems: error.problems ?? [error.message],
    }
  }
  return { refused: 'unknown', message: `there is no task ${number} in ${product.queue}/ — it is in none of its four folders` }
}
