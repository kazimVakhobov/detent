// The two questions `init` asks (ADR 0014, parts 1 and 2): which repository
// holds the queue, and which holds the documents. Neither is something the
// scan can work out — a repository meant to hold tasks looks like any other
// until there are tasks in it, and at `init` there are none; the documents are
// whichever repository a person decided would hold decisions.
//
// This is the first place detent reads from stdin. `plan` is interactive by
// handing the terminal to the agent (`stdio: 'inherit'`), which is somebody
// else's question; these are ours. So the rule that arrives with the first one
// is the only thing this file is strict about: **a question nobody is there to
// answer is not asked.** The asker returns `null` for that — no terminal, or a
// terminal that went away — and every caller reads `null` as "take the
// default, and say that you did". A command that waits for an answer in a
// pipeline is a worse failure than the assumption the question replaced.
//
// The asker is injectable the way `invoke` is, so the tests drive both
// questions with no terminal anywhere near them.

import { createInterface } from 'node:readline'
import process from 'node:process'
import { productPath } from './product.mjs'
import { QUEUE } from './task.mjs'

// `--docs none`, and the first row of the second question: no documents
// repository, said rather than left empty.
export const NONE = 'none'

// An answer that means nothing is asked for again — a typo is not a decision —
// but not forever: a person who does not know the answer has to be able to get
// out of the question, and the way out is the default.
const TRIES = 3

// The asker: one question on a terminal, one line back. `null` means there is
// nobody to answer. Ctrl-D is an answer too, and what it says is "stop asking".
//
// A terminal that has already ended is nobody as surely as a pipe is. Asking
// an input past its end is the one way this could still hang — readline has no
// close left to emit, so the question would be neither answered nor refused.
export function ask(text, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || input.readableEnded || input.destroyed) return Promise.resolve(null)
  return new Promise((resolve) => {
    let answered = false
    const rl = createInterface({ input, output })
    rl.once('close', () => {
      if (!answered) resolve(null)
    })
    rl.question(text, (line) => {
      answered = true
      rl.close()
      input.pause()
      resolve(line.trim())
    })
  })
}

// Where the queue goes: `{ value, note }`, the value a path relative to the
// product folder and the note one line saying what was taken and why.
export async function askQueue({ ask: asker = ask, repos = [], flag } = {}) {
  if (flag !== undefined) {
    return { value: flag, note: said('the queue', flag, placement(flag, repos), '--queue said so, and a flag is an answer') }
  }
  const choices = [
    { label: QUEUE, value: QUEUE, hint: 'beside the repositories, in the product folder', default: true },
    ...repos.map((name) => ({ name, label: `${name}/${QUEUE}`, value: `${name}/${QUEUE}`, hint: `in ${name}, which stops being a repository of the product` })),
  ]
  const picked = await choose({
    asker,
    choices,
    question: 'Which repository holds the task queue? detent moves task files through it, and plan writes into it.',
    closing: [
      'A repository that holds the queue is the queue: a session can commit and push it,',
      `and detent leaves it out of the product. Enter takes ${QUEUE}; a number, a repository`,
      'name or a path answers.',
    ].join('\n'),
    // Anything that stays inside the product folder is a usable queue path,
    // and a person who knows where they want it should not have to pick a row.
    typed: (answer) => {
      const { path } = productPath(answer)
      return path ? { label: path, value: path, hint: placement(path, repos) } : null
    },
  })
  return { value: picked.value, note: said('the queue', picked.label, picked.hint, picked.why) }
}

// Which repository holds the documents: `{ value, note }`, the value a
// repository name or `null` for none — which is the default, and an answer.
export async function askDocs({ ask: asker = ask, repos = [], flag } = {}) {
  if (flag !== undefined) {
    const value = flag === NONE ? null : flag
    return { value, note: said('the documents', value ?? NONE, value ? null : nothingToCheck, `--docs ${flag} said so, and a flag is an answer`) }
  }
  const choices = [
    { name: NONE, label: NONE, value: null, hint: nothingToCheck, default: true },
    ...repos.map((name) => ({ name, label: name, value: name })),
  ]
  const picked = await choose({
    asker,
    choices,
    question: "Which repository holds the documents a task's links point into?",
    closing: [
      'A task body links to a decision or a spec — this says which repository those',
      `links are in. Enter takes ${NONE}; a number or a repository name answers.`,
    ].join('\n'),
  })
  return { value: picked.value, note: said('the documents', picked.label, picked.hint, picked.why) }
}

const nothingToCheck = 'no documents repository'

// --- asking ------------------------------------------------------------------

// One question until it has an answer: a number, a name, a row's label, or
// whatever `typed` makes of the line. The default on an empty line, on no
// terminal, and in the end on an answer that keeps meaning nothing — every one
// of those carries a `why`, because a default that is not announced is the
// assumption this question was added to replace.
async function choose({ asker, question, choices, closing, typed = () => null }) {
  const fallback = choices.find((choice) => choice.default) ?? choices[0]
  let complaint = null
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const answer = await asker(render({ question, choices, closing, complaint }))
    // Nobody there: a pipeline, a cron entry, or a terminal that has gone.
    if (answer === null) return { ...fallback, why: 'the default: nobody is on stdin to answer' }
    const line = answer.trim()
    if (line === '') return { ...fallback, why: 'the default: enter was pressed' }
    const picked = byNumber(line, choices) ?? byName(line, choices) ?? typed(line)
    if (picked) return picked
    complaint = `"${line}" is not one of these.`
  }
  return { ...fallback, why: `the default: ${TRIES} answers I could not read` }
}

function render({ question, choices, closing, complaint }) {
  const width = Math.max(...choices.map((choice) => choice.label.length))
  return [
    '',
    ...(complaint ? [complaint, ''] : []),
    question,
    '',
    ...choices.map((choice, index) => `  ${index + 1}  ${choice.hint ? `${choice.label.padEnd(width)}  ${choice.hint}` : choice.label}`),
    '',
    closing,
    '> ',
  ].join('\n')
}

function byNumber(line, choices) {
  if (!/^\d+$/.test(line)) return null
  const index = Number(line)
  return index >= 1 && index <= choices.length ? choices[index - 1] : null
}

function byName(line, choices) {
  return choices.find((choice) => choice.label === line || choice.name === line) ?? null
}

// The announcement, in one line: what the answer was, what it means, and —
// when nobody chose it — why it is what it is.
function said(subject, label, hint, why) {
  return `${subject}: ${label}${hint ? ` — ${hint}` : ''}${why ? ` (${why})` : ''}`
}

// What a queue path means for the folder it starts in, so a flag and a typed
// path are announced as plainly as a chosen row.
function placement(path, repos) {
  const first = path.split('/')[0]
  if (repos.includes(first)) return `in ${first}, which stops being a repository of the product`
  return 'beside the repositories, in the product folder'
}
