// What `hold/` means to a run that has not started yet (ADR 0024).
//
// The scheduler's second rule — a barrier runs alone, and nothing starts past
// it (§8) — is true of the list it is handed, and `run` handed it `todo/`
// alone. A barrier that does not pass moves to `hold/`, so the next
// invocation saw no barrier and started exactly the work the first one had
// refused to start, against exactly the contract it had refused to start it
// against. The rule belongs to the queue rather than to one run, so this is
// where `hold/` is read before anything begins. **The barring is not part of
// any question**: it holds with a terminal and without one.
//
// And a paused task is a question as well as an obstacle. Resuming it is a
// person's decision (ADR 0009) — their acknowledgement that they read why it
// stopped — but the `mv` was never the decision, and detent can carry the
// file once the decision is made. The third answer matters as much as the
// other two: a task that was rejected is very often a task whose criteria
// were wrong, and what it needs is an edit rather than another run.
//
// The question is `core/ask.mjs`'s, and inherits its rule whole: a question
// nobody is there to answer is not asked, the default is taken, and the
// default is announced. Here the default is to leave the task paused — a bare
// Enter must never start a run that costs money.

import { basename } from 'node:path'
import { choose } from './ask.mjs'
import { readJournal } from './journal.mjs'
import { declares } from './task.mjs'

// The three answers.
export const LEAVE = 'leave'
export const RESUME = 'resume'
export const PLAN = 'plan'

// The last run of each task, by number — the line that says why a paused task
// is paused and which commit a finished one landed as. Read once: the journal
// is one file and every sentence below asks it something.
export function lastRuns(productDir) {
  const last = new Map()
  for (const line of readJournal(productDir).lines) {
    if (line.kind === 'task' && line.outcome !== 'skipped') last.set(Number(line.task), line)
  }
  return last
}

// Every task in `hold/`, in id order, with the two facts its own file states
// and the journal line its last run left. `readQueue` gives the other folders
// a name and a path and nothing else, so the file is read here for the one
// field a run branches on.
export function paused(product, tasks, last = lastRuns(product.dir)) {
  return tasks
    .filter((task) => task.folder === 'hold')
    .map((task) => ({
      ...task,
      ...declares(task.file),
      where: at(product, task),
      last: last.get(Number(task.id)) ?? null,
    }))
    .sort(byId)
}

// The scheduler's second rule, asked of `hold/`: a paused task that changes a
// contract bars every queued task with a higher number, **in any repository**,
// because the contract it was about to replace is still the one they would run
// against. Ids are the only ordering detent knows (§8), and a barrier a person
// named on the command line is not one of these — they said it landed another
// way, and a flag is an answer.
//
// A task behind two barriers is reported against the first: that is the one
// whose contract it was written for, and the one to resume.
export function barring(held, tasks, past = new Set()) {
  const barriers = held.filter((task) => task.touchesContract && !past.has(Number(task.id))).sort(byId)
  const blocked = new Map()
  const starting = []
  for (const task of tasks) {
    const barrier = barriers.find((b) => Number(b.id) < Number(task.id))
    if (!barrier) {
      starting.push(task)
      continue
    }
    if (!blocked.has(barrier.id)) blocked.set(barrier.id, { barrier, tasks: [] })
    blocked.get(barrier.id).tasks.push(task)
  }
  return { starting, blocked: [...blocked.values()] }
}

// One paused task, in one line, the way the run's own task lines read.
export function pausedLine(task) {
  return `${task.id}  ${task.repo ?? '?'}  ${task.slug}  paused${outcome(task)}${task.touchesContract ? '  (barrier — nothing queued after it starts)' : ''}`
}

// Why a name that is not in `todo/` is not in `todo/` — one sentence per
// folder, because what a person does next differs in every one of them. A
// number in none of the four keeps today's sentence: it is the only one of
// the four that means "you typed a number that does not exist".
export function elsewhere(product, id, tasks, last = lastRuns(product.dir)) {
  const task = tasks.find((t) => Number(t.id) === Number(id))
  if (!task) return `not in ${product.queue}/todo/: ${id}`
  const line = last.get(Number(id)) ?? null
  if (task.folder === 'hold') {
    return `${task.id} is paused in ${at(product, task)}${outcome({ last: line })} — detent run ${task.id} on a terminal offers to resume it or to change it in plan`
  }
  if (task.folder === 'done') {
    const landed = line?.commit ? ` — merged into ${product.branches.integration} (${line.commit.slice(0, 7)})` : ''
    return `${task.id} has already passed${landed}, and its file is in ${at(product, task)}`
  }
  return `${task.id} is in ${at(product, task)}, which is yours — detent never moves a task there, and never takes one out`
}

// The question, one paused task at a time, in id order. Returns what was
// answered about each, and stops at `plan`: the run is over after that one.
//
// Nobody is nobody for every task, exactly as `init` treats its two questions
// — an asker that says there is no one there is not called again, so a
// pipeline is never asked a second question it cannot answer. What is printed
// when nobody answered is the one line the task would have been named in
// anyway; what is printed when somebody did is what they chose.
export async function offer(tasks, { ask, blocked = [], announce = true, out } = {}) {
  const answers = []
  let nobody = false
  for (const task of tasks) {
    let heard = false
    const asker = async (text) => {
      if (nobody) return null
      const answer = await ask(text)
      if (answer === null) nobody = true
      else heard = true
      return answer
    }
    const behind = blocked.find((b) => Number(b.barrier.id) === Number(task.id))
    const picked = await choose({
      asker,
      question: [
        `Task ${task.id} (${task.repo ?? '?'}, ${task.slug}) is paused in ${task.where}.`,
        `  ${task.last ? `${task.last.outcome}: ${task.last.reason}` : 'no run of it is in the journal'}`,
        ...(task.last?.acceptance?.doubts ?? []).map((doubt) => `  doubt: ${doubt}`),
        ...(behind ? [`Nothing queued after it starts while it is paused: ${behind.tasks.map((t) => t.id).join(', ')}.`] : []),
      ].join('\n'),
      choices: [
        { name: LEAVE, label: LEAVE, value: LEAVE, hint: 'it stays paused, and so does everything behind it', default: true },
        { name: RESUME, label: RESUME, value: RESUME, hint: 'back to todo/ and run now, on its branch, with a fresh budget' },
        { name: PLAN, label: PLAN, value: PLAN, hint: 'open plan to change this task file first; nothing runs' },
      ],
      closing: 'Enter leaves it paused: a run costs money, and what stopped this one may be the task itself.',
    })
    // `heard` is the difference between a person leaving a task paused and
    // nobody having been there: the first was answered and the second is the
    // default, and only one of them has been told anything yet.
    answers.push({ task, answer: picked.value, heard })
    if (heard) out.write(`${task.id}  ${said(picked)}\n`)
    else if (announce) out.write(`${pausedLine(task)}\n`)
    if (picked.value === PLAN) break
  }
  return answers
}

function said(picked) {
  const why = picked.why ? ` (${picked.why})` : ''
  if (picked.value === RESUME) return `resuming${why}`
  if (picked.value === PLAN) return `opening plan to change it${why}`
  return `left paused${why}`
}

function outcome(task) {
  return task.last ? ` (${task.last.outcome}): ${task.last.reason}` : ' — no run of it is in the journal'
}

function at(product, task) {
  return `${product.queue}/${task.folder}/${basename(task.file)}`
}

const byId = (a, b) => Number(a.id) - Number(b.id)
