// runs/logs/NNNN-attempt-N.jsonl: the file layer under what the agent is
// saying (ADR 0021). Two halves — writing it as the agent prints, and reading
// the end of it for somebody watching — and one promise that holds across both:
// a log that cannot be written is a log that is lost, never a task that failed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attemptLogPath, attemptLogs, latestAttempt, openAttemptLog, tailLog } from '../core/log.mjs'

const productDir = () => mkdtempSync(join(tmpdir(), 'detent-logs-'))

// A log for a task and an attempt, written by hand the way an agent would.
function existing(dir, task, attempt, text) {
  const path = attemptLogPath(dir, task, attempt)
  mkdirSync(join(dir, 'runs', 'logs'), { recursive: true })
  writeFileSync(path, text)
  return path
}

test('the name is the index: a task id and an attempt are enough to write the path', () => {
  const dir = productDir()
  assert.equal(attemptLogPath(dir, '0042', 3), join(dir, 'runs', 'logs', '0042-attempt-3.jsonl'))
  // Which is the whole point — nothing has to be looked up, and a second
  // terminal needs nothing copied out of the first.
  const log = openAttemptLog(dir, '0042', 3)
  log.write('{"type":"system"}\n')
  log.close()
  assert.equal(readFileSync(join(dir, 'runs', 'logs', '0042-attempt-3.jsonl'), 'utf8'), '{"type":"system"}\n')
})

test('a log is written as it arrives, and a resumed attempt starts again rather than appending', () => {
  const dir = productDir()
  const first = openAttemptLog(dir, '7', 1)
  first.write('one\n')
  // In the file now, not at the end of the attempt: this is the whole claim.
  assert.equal(readFileSync(first.path, 'utf8'), 'one\n')
  first.write('two\n')
  assert.equal(readFileSync(first.path, 'utf8'), 'one\ntwo\n')
  first.close()

  // The same attempt, run again after the task was resumed. Half of the last
  // run followed by half of this one is a transcript of neither.
  const again = openAttemptLog(dir, '7', 1)
  again.write('fresh\n')
  again.close()
  assert.equal(readFileSync(first.path, 'utf8'), 'fresh\n')
})

test('a log that cannot be opened says so once and then does nothing', () => {
  // A product folder that is a file: nothing can be created under it.
  const wall = join(productDir(), 'wall')
  writeFileSync(wall, 'not a folder\n')
  const said = []
  const log = openAttemptLog(wall, '0042', 1, { warn: (text) => said.push(text) })

  for (let i = 0; i < 50; i += 1) log.write('a line nobody will read\n')
  log.close()
  log.write('after close, too')

  assert.equal(said.length, 1, 'once, not once per line')
  assert.match(said[0], /nothing is being written to .*0042-attempt-1\.jsonl/)
  assert.match(said[0], /the task is unaffected/)
})

test('what is in the folder, and which attempt is the newest', () => {
  const dir = productDir()
  existing(dir, '0001', 1, 'a\n')
  existing(dir, '0001', 2, 'b\n')
  existing(dir, '0010', 1, 'c\n')
  // Not an attempt log: the folder is not this convention's to own alone.
  writeFileSync(join(dir, 'runs', 'logs', 'notes.txt'), 'mine\n')

  assert.deepEqual(attemptLogs(dir).map((l) => l.name), ['0001-attempt-1.jsonl', '0001-attempt-2.jsonl', '0010-attempt-1.jsonl'])
  assert.equal(latestAttempt(dir, '0001').attempt, 2)
  // Asked about by number, so the zeros in the name are not a second question.
  assert.equal(latestAttempt(dir, '1').attempt, 2)
  assert.equal(latestAttempt(dir, 10).attempt, 1)
  assert.equal(latestAttempt(dir, '0002'), null)
  assert.deepEqual(attemptLogs(productDir()), [], 'a product that has never run has no folder, and that is not an error')
})

test('the tail: the end of the newest attempt, and never half a line', () => {
  const dir = productDir()
  assert.deepEqual(tailLog(dir, '0042'), { attempt: null, file: null, from: 0, to: 0, text: '' })

  existing(dir, '0042', 1, 'ignored\n')
  const path = existing(dir, '0042', 2, '{"a":1}\n{"b":2}\n')
  const whole = tailLog(dir, '0042')
  assert.equal(whole.attempt, 2, 'the newest attempt, not the first')
  assert.equal(whole.file, path)
  assert.deepEqual([whole.from, whole.to], [0, 16])
  assert.equal(whole.text, '{"a":1}\n{"b":2}\n')

  // Carried on from where the last answer ended: only what has arrived since.
  assert.deepEqual(tailLog(dir, '0042', { from: whole.to }), { attempt: 2, file: path, from: 16, to: 16, text: '' })
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n')
  const more = tailLog(dir, '0042', { from: whole.to })
  assert.equal(more.text, '{"c":3}\n')
  assert.deepEqual([more.from, more.to], [16, 24])

  // A line the agent is still printing is served whole next time, not in two
  // halves that each mean nothing on their own.
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n{"d":')
  const partial = tailLog(dir, '0042', { from: more.to })
  assert.equal(partial.text, '')
  assert.equal(partial.to, 24, 'it waits for the newline')
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n{"d":4}\n')
  assert.equal(tailLog(dir, '0042', { from: partial.to }).text, '{"d":4}\n')
})

test('the tail is bounded, and begins on a line of its own', () => {
  const dir = productDir()
  const lines = Array.from({ length: 200 }, (_, i) => `{"n":${i}}`)
  existing(dir, '0042', 1, `${lines.join('\n')}\n`)

  const end = tailLog(dir, '0042', { window: 100 })
  assert.ok(end.text.length <= 100, 'the end of the output, not the whole of it')
  assert.ok(end.text.startsWith('{"n":'), 'and from a line boundary, not from the middle of one')
  assert.ok(end.text.endsWith('{"n":199}\n'))
  assert.equal(end.to, `${lines.join('\n')}\n`.length)
  // The offset it reports is a byte in this file, so asking again with it
  // returns nothing rather than repeating the window.
  assert.equal(tailLog(dir, '0042', { from: end.to, window: 100 }).text, '')
})

test('an offset that no longer makes sense is answered with the tail, and said to be', () => {
  const dir = productDir()
  const path = existing(dir, '0042', 1, 'one\ntwo\nthree\n')
  // The file was truncated under the reader — a resumed attempt, or a log that
  // prune cleared and a new run recreated.
  writeFileSync(path, 'fresh\n')
  const answer = tailLog(dir, '0042', { from: 14 })
  assert.equal(answer.text, 'fresh\n')
  assert.notEqual(answer.from, 14, 'the answer says it did not carry on from what was asked')
  assert.equal(answer.from, 0)
  // And nonsense is nowhere rather than a complaint: the end of the file.
  assert.equal(tailLog(dir, '0042', { from: -1 }).text, 'fresh\n')
  assert.equal(tailLog(dir, '0042', { from: 1.5 }).text, 'fresh\n')
})
