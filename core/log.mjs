// runs/logs/NNNN-attempt-N.jsonl — what the agent printed, while it printed it
// (ADR 0021).
//
// A run showed a line when a task started and a line when it ended, and
// nothing in between: everything the agent said accumulated in a string in
// `agents.mjs`, was read for its last object, and was dropped. The agent is
// now asked for its output as a stream, and the stream is written here as it
// arrives, so a person can watch a task that is already running.
//
// **It is not a record.** Nothing reads a log to decide an outcome, a cost or a
// verdict — those come from the result object the journal has always parsed. So
// a log that cannot be opened or written says so once and then does nothing: a
// log is not the work, and losing it must never cost the task.
//
// The name is the index. There is no second file saying where a log is, and
// nothing in the journal points at one: a task id and an attempt number are
// enough to write the path by hand, which is what makes `tail -f` possible
// without copying anything out of a terminal a run has occupied.

import { closeSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'
import process from 'node:process'

export const LOGS_DIR = join('runs', 'logs')

// The whole of the convention, in one place and one pattern: a task's digits,
// the word, the attempt. Anything else in the folder is somebody else's.
const NAME = /^(\d+)-attempt-(\d+)\.jsonl$/

export function attemptLogName(task, attempt) {
  return `${task}-attempt-${attempt}.jsonl`
}

export function attemptLogPath(productDir, task, attempt) {
  return join(productDir, LOGS_DIR, attemptLogName(task, attempt))
}

// Where the agent's output goes for one attempt. `write` takes what the agent
// printed and returns nothing; neither it nor `close` ever throws, and the
// first failure is the only one that is reported — a thousand lines into a
// stream that cannot be written, the second sentence says nothing new.
export function openAttemptLog(productDir, task, attempt, { warn = complain } = {}) {
  const path = attemptLogPath(productDir, task, attempt)
  let fd = null
  let said = false

  const giveUp = (error) => {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {}
      fd = null
    }
    if (said) return
    said = true
    warn(`detent: nothing is being written to ${path} — ${error.message}; the task is unaffected\n`)
  }

  try {
    mkdirSync(dirname(path), { recursive: true })
    // Truncating: a resumed task runs attempt 1 again, and half of the last
    // run followed by half of this one is a transcript of neither.
    fd = openSync(path, 'w')
  } catch (error) {
    giveUp(error)
  }

  return {
    path,
    write(chunk) {
      if (fd === null) return
      try {
        writeSync(fd, chunk)
      } catch (error) {
        giveUp(error)
      }
    },
    close() {
      if (fd === null) return
      try {
        closeSync(fd)
      } catch {}
      fd = null
    },
  }
}

function complain(text) {
  process.stderr.write(text)
}

// Every attempt log in the folder, whatever task it belongs to. Used by
// `prune`, which is the one thing that deletes one.
export function attemptLogs(productDir) {
  const found = []
  for (const name of names(productDir)) {
    const match = NAME.exec(name)
    if (!match) continue
    found.push({ name, file: join(productDir, LOGS_DIR, name), task: Number(match[1]), attempt: Number(match[2]) })
  }
  return found.sort((a, b) => a.task - b.task || a.attempt - b.attempt)
}

// The newest attempt this task has a log for, or null. A task is asked about by
// its number, so `44` and `0044` find the same file.
export function latestAttempt(productDir, task) {
  let best = null
  for (const entry of attemptLogs(productDir)) {
    if (entry.task !== Number(task)) continue
    if (best === null || entry.attempt > best.attempt) best = entry
  }
  return best
}

// How much of a log is served at once when nobody says where to carry on from.
// The end of the output is the part somebody watching wants; the whole of it is
// a file they already have the path to.
export const WINDOW = 64 * 1024

// The end of a task's newest attempt log: from `from` if that is still inside
// the file, and from the last `window` bytes otherwise.
//
// **Never a partial line.** The read stops at the last newline, and the offset
// it reports is that newline's — so a line the agent is still printing is
// served whole on the next read instead of in two halves that each mean
// nothing. `from` and `to` are bytes in this file and nothing else: a caller
// that asks again with the `to` it was given gets only what has arrived since,
// and one whose `from` no longer makes sense (a new attempt, a truncated file)
// is given the tail and told by a `from` that is not the one it asked for.
export function tailLog(productDir, task, { from = null, window = WINDOW } = {}) {
  const found = latestAttempt(productDir, task)
  if (!found) return { attempt: null, file: null, from: 0, to: 0, text: '' }

  let size
  try {
    size = statSync(found.file).size
  } catch {
    return { attempt: found.attempt, file: found.file, from: 0, to: 0, text: '' }
  }

  const continued = typeof from === 'number' && Number.isInteger(from) && from >= 0 && from <= size
  const start = continued ? from : Math.max(0, size - window)
  const buffer = read(found.file, start, size - start)
  const answer = { attempt: found.attempt, file: found.file }

  // Line boundaries are found in the bytes, not in the text: a window that
  // begins in the middle of a multi-byte character would otherwise be decoded
  // before it was trimmed, and the first line would arrive broken.
  let begin = 0
  if (!continued && start > 0) {
    const newline = buffer.indexOf(10)
    begin = newline === -1 ? buffer.length : newline + 1
  }
  const last = buffer.lastIndexOf(10)
  const end = last === -1 || last + 1 <= begin ? begin : last + 1
  if (end === begin) return { ...answer, from: start + begin, to: start + begin, text: '' }
  return { ...answer, from: start + begin, to: start + end, text: buffer.subarray(begin, end).toString('utf8') }
}

function read(file, start, length) {
  if (length <= 0) return Buffer.alloc(0)
  const buffer = Buffer.alloc(length)
  const fd = openSync(file, 'r')
  try {
    const got = readSync(fd, buffer, 0, length, start)
    return got === length ? buffer : buffer.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

function names(productDir) {
  try {
    return readdirSync(join(productDir, LOGS_DIR))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
