// The dashboard's one write: a product's configuration, between runs
// (ADR 0015).
//
// What may change is the configuration and nothing else — the models for each
// role, product-wide and per repository, `attempts`, `timeout`, `concurrency`
// and `notify`. `repos`, `queue`, `docs` and `branches` name things on disk,
// and a page cannot create what it names; they are read back so the page can
// show them, each with the reason it is not editable here.
//
// Two rules hold every write. It is refused while a run is active, by the same
// `state.json` that `recover` reads: the files that judge an agent are
// fingerprinted before each of its turns (`core/run.mjs`, `digest`), and that
// guard does not ask who changed one — a write now would pause the task and
// blame the agent for a person's edit. And nothing is written unless the whole
// file validates through `validateProduct`, which is the same code
// `loadProduct` uses, so a page cannot produce a `product.json` that
// `detent run` would refuse to load.

import { renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { AGENT_NAMES, DEFAULTS, PRODUCT_FILE, ROLES, readConfig, validateProduct } from './product.mjs'
import { isAlive, readState } from './state.mjs'

// The keys of `product.json` a page may change (ADR 0015, decision 1). Plus
// `repos`, which is in neither list whole: a repository's `models` may change,
// and nothing else about it may.
export const EDITABLE = Object.freeze(['models', 'attempts', 'timeout', 'concurrency', 'notify'])

// Shown, and not editable here, with the reason — a disabled input nobody
// explains is worse than no input.
export const NOT_EDITABLE = Object.freeze({
  repos: 'each one is a clone on disk, and a page cannot make a clone',
  queue: 'it names four folders, and a page cannot create them',
  docs: 'it names a repository of the product, and a page cannot add one',
  branches: 'they name refs, and a page cannot create a branch',
})

const REPO_EDITABLE = Object.freeze(['name', 'models'])

// Whatever `state.json` lists with a process still running — the same file and
// the same liveness test `recover` works from. A stale entry left by a killed
// run keeps the configuration shut until `detent recover` is run, which is the
// right answer and an unobvious one (ADR 0015).
export function activeRun(productDir) {
  const state = readState(resolve(productDir))
  return Object.entries(state.repos)
    .filter(([, entry]) => isAlive(entry.pid))
    .map(([repo, entry]) => ({ repo, task: entry.task, attempt: entry.attempt, started: entry.started ?? null }))
}

// The refusal names what the run is working on, because "a run is active" on
// its own leaves a person refreshing the page to find out which one.
export function runningRefusal(active) {
  const what = active.map((a) => `${a.repo} on task ${a.task}, attempt ${a.attempt}`).join('; ')
  return `a run is active — ${what}. The configuration is written between runs: the files that judge an agent are fingerprinted before each of its turns, and a change now would pause the task blaming the agent for your edit.`
}

// What the file says right now, and what it means where it says nothing: every
// field carries `value` — the file's own, or `null` when the key is absent —
// beside the `effective` value a run would use. The page shows the one and
// offers the other as a placeholder, so leaving a field empty keeps the key
// out of the file rather than writing the default into it.
//
// Nothing here validates. This reports the file, and reporting a file only
// when it is correct would leave the page silent exactly when a person needs
// to see what is in it.
export function readConfiguration(productDir) {
  const dir = resolve(productDir)
  const { raw, error, found } = readConfig(dir)
  if (!found) throw new Error(`${PRODUCT_FILE} does not exist`)
  if (error) throw new Error(`${PRODUCT_FILE} is not valid JSON: ${error.message}`)
  if (!isObject(raw)) throw new Error(`${PRODUCT_FILE} is not an object`)

  const declared = Array.isArray(raw.repos) ? raw.repos.filter(isObject) : []
  const models = isObject(raw.models) ? raw.models : {}
  const branches = isObject(raw.branches) ? raw.branches : {}
  const roles = (source) => Object.fromEntries(ROLES.map((role) => [role, source[role] ?? null]))

  return {
    file: PRODUCT_FILE,
    agents: AGENT_NAMES,
    roles: ROLES,
    models: roles(models),
    attempts: field(raw.attempts, DEFAULTS.attempts),
    timeout: field(raw.timeout, DEFAULTS.timeout),
    concurrency: field(raw.concurrency, DEFAULTS.concurrency),
    notify: field(raw.notify, null),
    repos: declared.map((repo) => ({
      name: typeof repo.name === 'string' ? repo.name : null,
      models: roles(isObject(repo.models) ? repo.models : {}),
      // A repository overrides a role, never "the model" (§11), so an empty
      // role here is the product's and the page can say whose it is.
      inherited: roles(models),
    })),
    notEditable: [
      { key: 'repos', shown: declared.map((repo) => repo.name ?? '(unnamed)').join(', ') || 'none', why: NOT_EDITABLE.repos },
      { key: 'queue', shown: String(raw.queue ?? DEFAULTS.queue), why: NOT_EDITABLE.queue },
      { key: 'docs', shown: raw.docs ? String(raw.docs) : 'none', why: NOT_EDITABLE.docs },
      {
        key: 'branches',
        shown: [branches.integration ?? DEFAULTS.integration, branches.task ?? DEFAULTS.task, branches.staging].filter(Boolean).join(' · '),
        why: NOT_EDITABLE.branches,
      },
    ],
  }
}

// The parsed file in, the file it would become out, with the problems the patch
// itself has — the ones about which keys may be touched, which `validateProduct`
// cannot have an opinion about because a file edited by hand may touch any of
// them. Judging the *values* is left entirely to the validator.
//
// A key absent from the patch is untouched; a key set to `null` is removed, so
// a cleared field leaves the file saying nothing rather than saying the
// default out loud. Keys are replaced in place, so the file keeps the order
// `init` wrote it in.
export function applyConfiguration(raw, patch) {
  const problems = []
  const fail = (path, message) => problems.push(`${path}: ${message}`)

  if (!isObject(patch)) {
    fail('(root)', 'must be an object of the configuration to change')
    return { next: null, problems }
  }

  for (const key of Object.keys(patch)) {
    if (key === 'repos' || EDITABLE.includes(key)) continue
    if (Object.hasOwn(NOT_EDITABLE, key)) fail(key, `is shown and not editable here — ${NOT_EDITABLE[key]}`)
    else fail(key, `unknown key — the dashboard writes ${[...EDITABLE, 'repos[].models'].join(', ')}`)
  }

  const next = { ...raw }
  for (const key of ['attempts', 'timeout', 'concurrency', 'notify']) {
    if (Object.hasOwn(patch, key)) set(next, key, patch[key])
  }
  if (Object.hasOwn(patch, 'models')) set(next, 'models', mergeRoles(raw.models, patch.models))

  if (Object.hasOwn(patch, 'repos')) {
    const declared = Array.isArray(raw.repos) ? raw.repos : []
    const byName = new Map(declared.flatMap((repo, index) => (isObject(repo) && typeof repo.name === 'string' ? [[repo.name, index]] : [])))
    const changes = new Map()
    if (!Array.isArray(patch.repos)) {
      fail('repos', 'must be an array of { name, models } — a page changes a repository\'s models and nothing else about it')
    } else {
      patch.repos.forEach((entry, index) => {
        const at = `repos[${index}]`
        if (!isObject(entry)) return fail(at, 'must be { name, models }')
        for (const key of Object.keys(entry)) {
          if (REPO_EDITABLE.includes(key)) continue
          fail(`${at}.${key}`, 'is shown and not editable here — only a repository\'s models are written from the page')
        }
        if (typeof entry.name !== 'string') return fail(`${at}.name`, 'must name a repository of this product')
        if (!byName.has(entry.name)) {
          return fail(`${at}.name`, `"${entry.name}" is not a repository in repos — a page cannot add one`)
        }
        if (Object.hasOwn(entry, 'models')) changes.set(byName.get(entry.name), entry.models)
      })
    }
    if (changes.size > 0) {
      next.repos = declared.map((repo, index) => {
        if (!changes.has(index)) return repo
        const copy = { ...repo }
        set(copy, 'models', mergeRoles(repo.models, changes.get(index)))
        return copy
      })
    }
  }

  return { next, problems }
}

// Reads `product.json`, applies the patch, validates the result whole, and
// writes only if there is nothing to report. The outcome is one of four words
// so the server can answer each with the status it deserves and the page can
// say which happened without reading the sentence.
export function writeConfiguration(productDir, patch) {
  const dir = resolve(productDir)

  const active = activeRun(dir)
  if (active.length > 0) return { outcome: 'running', active, message: runningRefusal(active) }

  const { raw, error, found } = readConfig(dir)
  if (!found) return { outcome: 'unreadable', message: `${PRODUCT_FILE} does not exist` }
  if (error) return { outcome: 'unreadable', message: `${PRODUCT_FILE} is not valid JSON: ${error.message}` }

  const { next, problems } = applyConfiguration(raw, patch)
  // Every problem at once, each naming its path: the person fixing it wants
  // the whole list, and the validator is the same one `detent run` loads with.
  const all = [...problems, ...(next === null ? [] : validateProduct(next, dir).problems)]
  if (all.length > 0) {
    return { outcome: 'invalid', problems: all, message: `${PRODUCT_FILE} was not written — ${all.length === 1 ? 'one problem' : `${all.length} problems`}` }
  }

  writeProductFile(dir, next)
  // Read back off disk rather than handed on from memory: the page says what
  // the file says, and what it says is the only thing a run will read.
  return { outcome: 'written', configuration: readConfiguration(dir) }
}

// Whole and renamed into place, in the shape `init` writes it in, so a crash
// mid-write leaves the old file rather than half of a new one.
function writeProductFile(dir, raw) {
  const file = join(dir, PRODUCT_FILE)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(raw, null, 2)}\n`)
  renameSync(temporary, file)
}

// Role by role, so clearing `accept` leaves `implement` alone. Anything that
// is not an object goes through untouched for the validator to name — a second
// opinion here would be one more place for the schema to live.
function mergeRoles(current, incoming) {
  if (incoming === null) return null
  if (!isObject(incoming)) return incoming
  const result = isObject(current) ? { ...current } : {}
  for (const [role, value] of Object.entries(incoming)) {
    if (value === null) delete result[role]
    else result[role] = value
  }
  return Object.keys(result).length === 0 ? null : result
}

// `null` removes the key; anything else replaces it where it already sits.
function set(object, key, value) {
  if (value === null) delete object[key]
  else object[key] = value
}

const field = (value, fallback) => ({
  value: value === undefined ? null : value,
  effective: value === undefined ? fallback : value,
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
