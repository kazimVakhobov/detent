// One task, opened by its number: what the page has never shown (ADR 0020
// part 3). Its frontmatter, its goal, its criteria, its out-of-scope, and what
// its attempts did.
//
// Nothing here writes, and nothing here is computed. The sections are the ones
// `parseTask` already finds because `run` needs them; the history is the
// journal's own lines; whether the task's links resolved is what the run
// recorded, and never a second answer to a question ADR 0014 decided is asked
// before a task starts. `openLog` is the same task's live end: what the agent
// is printing, read from the file it prints into and never from the journal
// (ADR 0021).
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
import { tailLog } from './log.mjs'
import { isAlive, readState } from './state.mjs'
import { findTask, parseTask, readQueue, section } from './task.mjs'

// What the page asked for, which is digits or a refusal. A number is never a
// path: anything that is not digits is refused before a file is opened, so
// asking for a traversal gets a sentence rather than a file.
export function openTask(product, asked) {
  const number = digits(asked)
  if (number === null) return notANumber(asked)

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

// What the agent is saying about this task, from the file it is saying it into
// (ADR 0021). The same digits-or-a-refusal as above, then the end of the newest
// attempt's log and whether anything is still writing to it.
//
// **Nothing here is parsed.** The bytes go to the page as bytes and what they
// mean is between the agent and the person reading: a number taken out of a
// transcript is a number nobody can check, so the journal's numbers come from
// the result object and this is for a person to read. A task with no log is not
// a refusal — nothing has run it, or `prune` has been through.
//
// Three facts leave here, and the page makes its sentence out of them: which
// run holds the task and which attempt it is on, which attempt the log belongs
// to, and how long that file has been quiet. Between them they tell a task
// whose agent is printing from one whose agent has stopped — the gauge, the
// acceptance pass, the link check or the merge, none of which write a log.
// **No phase is read or recorded.** A claim says a repository, a task, an
// attempt and a pid (ADR 0017); whether the log is growing is answered by the
// log, and a phase field would be a fifth thing to keep true through every
// branch of a run, including the ones that end badly.
export function openLog(product, asked, from = null) {
  const number = digits(asked)
  if (number === null) return notANumber(asked)

  // Which run is writing this log, if one is. A claim whose process is gone is
  // not a running task (ADR 0017), and what the page shows then is what the
  // last attempt said rather than something happening now.
  const claimed = Object.entries(readState(product.dir).repos).find(([, entry]) => Number(entry.task) === Number(number) && isAlive(entry.pid))
  const running = claimed ? { repo: claimed[0], attempt: claimed[1].attempt } : null

  return { task: number, running, ...tailLog(product.dir, number, { from: offset(from) }) }
}

// Digits and nothing else, as text — a task number stays a number here, and
// `../x` names no task and opens no file.
function digits(asked) {
  const number = String(asked ?? '').trim()
  return /^\d+$/.test(number) ? number : null
}

function notANumber(asked) {
  return { refused: 'number', message: `"${String(asked ?? '').trim()}" is not a task number — a task is opened by the digits in its name` }
}

// Where to carry on from, when the page says. Anything else is nowhere, and is
// answered with the end of the file rather than with a complaint.
function offset(from) {
  const text = String(from ?? '').trim()
  return /^\d+$/.test(text) ? Number(text) : null
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
