// The one credential detent handles, and the two places it may be (ADR 0025).
//
// `product.json` names a secret and never holds one: a channel says which
// environment variable its token is in, and this module answers what is in it
// at send time. The file is read by the dashboard and served to a browser, and
// nothing gitignores it — so a token in it would be a token in a page and,
// sooner or later, in a commit.
//
// Two places, in this order:
//
//   1. **the environment.** The documented way, and the one that works on a
//      machine detent does not own: a CI runner exports it, a shell profile
//      exports it, `systemd` exports it.
//   2. **`.detent/secrets.json`**, created `0600`, under the same name. For
//      somebody who has no profile to edit and a dashboard open — the secret is
//      typed into the page and lands here (`writeSecret`), and `init` writes the
//      `.gitignore` that keeps it out of a commit.
//
// The environment wins, because it is the one a person can change for one run
// without editing anything.
//
// **`readSecret` is the only function that returns a value, and only the
// channel that sends calls it.** Everything else — the dashboard, a report, a
// journal line — asks `secretState`, which answers *whether* it is set and
// where, and never what it found. That asymmetry is the whole of the design:
// there is exactly one path a secret travels, and it ends in an HTTPS request.

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

export const SECRETS_FILE = join('.detent', 'secrets.json')

// Inside `.detent/`, not at the product root. A `.gitignore` there is the
// person's — they may keep the queue and the journal in a repository of their
// own and have rules about both — and detent appending to a file it did not
// write is a change to somebody else's file. Inside the folder detent owns, the
// rule covers exactly what detent put there, and `git check-ignore` answers the
// same either way.
export const SECRETS_GITIGNORE = join('.detent', '.gitignore')

// Where it was found, said in words, because "true" does not tell somebody
// which of the two to go and change.
export const ENVIRONMENT = 'the environment'

// The name of an environment variable: what the configuration holds instead of
// a secret, and the key in the file. Held to what a shell can export, so a
// token pasted where the name goes is refused rather than stored under itself.
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function secretNameProblem(name) {
  if (typeof name !== 'string' || !VARIABLE.test(name)) {
    return 'must be the name of an environment variable — letters, digits and "_", not starting with a digit'
  }
  return null
}

// The value, for the one caller that sends with it. `null` for a name that is
// set nowhere; never an exception, because a missing secret is a channel that
// cannot send and not a run that cannot finish.
export function readSecret(productDir, name) {
  if (secretNameProblem(name)) return null
  const fromEnvironment = process.env[name]
  if (typeof fromEnvironment === 'string' && fromEnvironment !== '') return fromEnvironment
  const { secrets } = readSecrets(productDir)
  const value = secrets[name]
  return typeof value === 'string' && value !== '' ? value : null
}

// Whether it is set, and where — and never what it is. This is what the
// dashboard is served and what a failed send reports.
//
// **`shadowed` is the one thing beyond "set, and where" worth answering**, and
// it is still not a value: the environment wins, so somebody who typed a token
// into the page while a variable was exported is having a different one sent
// than the one they typed. That is a mystery a failed send explains badly and
// a panel can explain exactly, so the state says the file has one too and that
// the variable beats it. Both halves are booleans; neither is a secret.
export function secretState(productDir, name) {
  const problem = secretNameProblem(name)
  if (problem) return { name: String(name), set: false, where: null, shadowed: false, problem }
  const { secrets, error } = readSecrets(productDir)
  const stored = secrets[name]
  const inFile = typeof stored === 'string' && stored !== ''
  const fromEnvironment = process.env[name]
  if (typeof fromEnvironment === 'string' && fromEnvironment !== '') {
    return { name, set: true, where: ENVIRONMENT, shadowed: inFile, problem: null }
  }
  if (inFile) return { name, set: true, where: SECRETS_FILE, shadowed: false, problem: null }
  return { name, set: false, where: null, shadowed: false, problem: error }
}

// Typed on the dashboard, written to a file of its own. `null` or an empty
// string removes it, so the page that set one can unset it.
//
// Whole and renamed into place at `0600`, like `product.json` is written whole:
// a crash mid-write leaves the old file rather than half of a new one, and the
// mode is set on the temporary file *and* again before the rename, because the
// `mode` argument is masked by the umask and 0600 is the point.
export function writeSecret(productDir, name, value) {
  const problem = secretNameProblem(name)
  if (problem) throw new Error(`${name} ${problem}`)
  const { secrets } = readSecrets(productDir)
  const next = { ...secrets }
  if (value === null || value === undefined || value === '') delete next[name]
  else if (typeof value !== 'string') throw new Error(`the value for ${name} must be a string`)
  else next[name] = value

  const file = join(productDir, SECRETS_FILE)
  if (Object.keys(next).length === 0) {
    try {
      unlinkSync(file)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return secretState(productDir, name)
  }

  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
  chmodSync(file, 0o600)
  return secretState(productDir, name)
}

// What `init` writes, and the reason it writes it, in the file: whoever finds
// this line is being told why it is there rather than left to guess.
export const GITIGNORE = `# Written by detent init (docs/adr/0025-a-channel-is-a-kind-and-the-secret-is-not-in-the-configuration.md).
#
# A notification channel's token is never in product.json — that file is served
# to the dashboard — and never in a commit. It is in the environment, or typed
# on the page into the file below, which is created 0600 and ignored here.
secrets.json
`

// Written if it is not there, and left alone if it is: a person who edited it
// has said something, and `init` re-runs.
export function writeSecretsGitignore(productDir) {
  const file = join(productDir, SECRETS_GITIGNORE)
  let text = null
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (text !== null) {
    if (ignoresSecrets(text)) return { file: SECRETS_GITIGNORE, written: false }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${text.endsWith('\n') || text === '' ? text : `${text}\n`}${GITIGNORE}`)
    return { file: SECRETS_GITIGNORE, written: true }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, GITIGNORE)
  return { file: SECRETS_GITIGNORE, written: true }
}

function ignoresSecrets(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === 'secrets.json' || line === '/secrets.json' || line === '*.json' || line === '*')
}

function readSecrets(productDir) {
  const file = join(productDir, SECRETS_FILE)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { secrets: {}, error: null }
    return { secrets: {}, error: `${SECRETS_FILE} cannot be read: ${error.code}` }
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { secrets: {}, error: `${SECRETS_FILE} is not an object of name to value` }
    }
    return { secrets: parsed, error: null }
  } catch (error) {
    // The message, never the text: a JSON error quotes what it choked on.
    return { secrets: {}, error: `${SECRETS_FILE} is not valid JSON (${error.name})` }
  }
}
