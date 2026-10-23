// The one credential detent handles (ADR 0025): where it may be, who may read
// it, and the asymmetry the whole design rests on — `readSecret` answers with a
// value and `secretState` never does.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { ENVIRONMENT, GITIGNORE, SECRETS_FILE, SECRETS_GITIGNORE, readSecret, secretNameProblem, secretState, writeSecret, writeSecretsGitignore } from '../core/secret.mjs'

const NAME = 'DETENT_TEST_SECRET'

function product() {
  const dir = mkdtempSync(join(tmpdir(), 'detent-secret-'))
  mkdirSync(join(dir, '.detent'))
  return dir
}

test('the environment is the first place, and the file is the second', () => {
  const dir = product()
  delete process.env[NAME]

  assert.equal(readSecret(dir, NAME), null, 'set nowhere')
  assert.deepEqual(secretState(dir, NAME), { name: NAME, set: false, where: null, shadowed: false, problem: null })

  writeSecret(dir, NAME, 'from-the-file')
  assert.equal(readSecret(dir, NAME), 'from-the-file')
  assert.deepEqual(secretState(dir, NAME), { name: NAME, set: true, where: SECRETS_FILE, shadowed: false, problem: null })

  // The environment wins, because it is the one a person can change for one
  // run without editing anything.
  //
  // **And the state says the file has one too**, which is the one fact beyond
  // "set, and where" worth answering: somebody who typed a token into the
  // dashboard while a variable was exported is having a different one sent than
  // the one they typed, and that is a mystery a failed send explains badly.
  // `shadowed` is a boolean about where, not a value.
  process.env[NAME] = 'from-the-environment'
  try {
    assert.equal(readSecret(dir, NAME), 'from-the-environment')
    assert.deepEqual(secretState(dir, NAME), { name: NAME, set: true, where: ENVIRONMENT, shadowed: true, problem: null })

    writeSecret(dir, NAME, null)
    assert.deepEqual(secretState(dir, NAME), { name: NAME, set: true, where: ENVIRONMENT, shadowed: false, problem: null },
      'nothing of the file is left to be shadowed')
  } finally {
    delete process.env[NAME]
  }
})

test('the file is created 0600, and what it holds is never in what reports it', () => {
  const dir = product()
  delete process.env[NAME]
  const written = writeSecret(dir, NAME, 'a-token-nobody-should-see')

  const file = join(dir, SECRETS_FILE)
  assert.equal(statSync(file).mode & 0o777, 0o600, 'readable by nobody else')
  assert.match(readFileSync(file, 'utf8'), /a-token-nobody-should-see/, 'the value is in the file, which is the point of the mode')

  // And in nothing that reports it. This is the asymmetry: one function returns
  // a value, and the one the dashboard and a failed send use does not.
  for (const reported of [written, secretState(dir, NAME)]) {
    assert.equal(reported.set, true)
    assert.ok(!JSON.stringify(reported).includes('a-token-nobody-should-see'), 'a state carries the value')
  }
})

test('a secret can be unset, and the file goes with the last of them', () => {
  const dir = product()
  delete process.env[NAME]
  writeSecret(dir, NAME, 'one')
  writeSecret(dir, 'DETENT_TEST_OTHER', 'two')
  writeSecret(dir, NAME, null)

  assert.equal(readSecret(dir, NAME), null)
  assert.equal(readSecret(dir, 'DETENT_TEST_OTHER'), 'two', 'the other one is untouched')
  writeSecret(dir, 'DETENT_TEST_OTHER', null)
  assert.throws(() => statSync(join(dir, SECRETS_FILE)), /ENOENT/, 'the empty file is removed rather than left as {}')
})

test('a name is the name of a variable, and a token pasted into it is refused rather than stored', () => {
  const dir = product()
  assert.equal(secretNameProblem('TELEGRAM_BOT_TOKEN'), null)
  assert.equal(secretNameProblem('_x1'), null)
  for (const bad of ['1ABC', 'a-b', '123456:AAHfake-token', '', 'a b', null, 42]) {
    assert.match(secretNameProblem(bad) ?? '', /name of an environment variable/, JSON.stringify(bad))
  }
  assert.throws(() => writeSecret(dir, '123456:AAHfake', 'x'), /name of an environment variable/)
  assert.throws(() => statSync(join(dir, SECRETS_FILE)), /ENOENT/)
})

test('an unreadable secrets file is reported as a condition, never by quoting it', () => {
  const dir = product()
  delete process.env[NAME]
  writeFileSync(join(dir, SECRETS_FILE), '{ "DETENT_TEST_SECRET": "a-token-in-broken-json"')
  const state = secretState(dir, NAME)
  assert.equal(state.set, false)
  assert.match(state.problem, /is not valid JSON/)
  assert.ok(!state.problem.includes('a-token-in-broken-json'), 'a JSON error quotes what it choked on')
  assert.equal(readSecret(dir, NAME), null)
})

test('init writes the .gitignore that keeps it out of a commit, and leaves a written one alone', () => {
  const dir = product()
  assert.deepEqual(writeSecretsGitignore(dir), { file: SECRETS_GITIGNORE, written: true })
  const text = readFileSync(join(dir, SECRETS_GITIGNORE), 'utf8')
  assert.equal(text, GITIGNORE)
  assert.match(text, /^secrets\.json$/m)
  // It says why it is there: whoever finds the line is being told rather than
  // left to guess.
  assert.match(text, /never in product\.json/)

  // Written once. A person who edited it has said something, and `init`
  // re-runs — so a second run neither duplicates the rule nor undoes an edit.
  assert.deepEqual(writeSecretsGitignore(dir), { file: SECRETS_GITIGNORE, written: false })
  assert.equal(readFileSync(join(dir, SECRETS_GITIGNORE), 'utf8'), GITIGNORE)

  // And a `.gitignore` that was already there and says something else gains
  // the rule rather than being replaced by it.
  const other = product()
  writeFileSync(join(other, SECRETS_GITIGNORE), '*.tmp\n')
  assert.equal(writeSecretsGitignore(other).written, true)
  assert.match(readFileSync(join(other, SECRETS_GITIGNORE), 'utf8'), /^\*\.tmp$/m)
  assert.match(readFileSync(join(other, SECRETS_GITIGNORE), 'utf8'), /^secrets\.json$/m)
})

test('a secrets file that git can actually see is ignored by it', () => {
  const dir = product()
  writeSecretsGitignore(dir)
  writeSecret(dir, NAME, 'x')
  spawnSync('git', ['-C', dir, 'init', '--quiet'])
  const ignored = spawnSync('git', ['-C', dir, 'check-ignore', '-v', SECRETS_FILE], { encoding: 'utf8' })
  assert.equal(ignored.status, 0, `git does not ignore ${SECRETS_FILE}:\n${ignored.stdout}${ignored.stderr}`)
  assert.match(ignored.stdout, /secrets\.json/)
})
