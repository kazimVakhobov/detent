// .detent/product.json — the shape in DESIGN.md §11, loaded strictly.
//
// Every problem is collected rather than the first one thrown, because the
// person fixing the file wants the whole list, and each one names its path.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { isAgentBranch, refNameProblem } from './refs.mjs'
import { QUEUE } from './task.mjs'

export const PRODUCT_FILE = join('.detent', 'product.json')

export const DEFAULTS = Object.freeze({
  integration: 'agent/dev',
  task: 'agent/task-{id}-{slug}',
  queue: QUEUE,
  concurrency: 1,
  attempts: 3,
  timeout: 30,
})


const ROLES = ['implement', 'accept']
const AGENT_NAMES = ['claude', 'codex', 'gemini']
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SOURCES = new Set(['scan', 'model'])

// `problems` are one line each, because the person fixing the file wants a
// list. `hint` is prose, printed after them, and exists for the one problem
// that cannot be fixed by reading a list: the file is not there at all, and
// whoever is reading has not met this tool before.
export class ConfigError extends Error {
  constructor(file, problems, hint = null) {
    super(`${file} is not usable:\n${problems.map((p) => `  ${p}`).join('\n')}${hint ? `\n\n${hint}\n` : ''}`)
    this.name = 'ConfigError'
    this.file = file
    this.problems = problems
    this.hint = hint
  }
}

// The first thing a newcomer gets wrong is where they are standing: detent
// works from the folder the repositories sit in, and `cd my-project` lands you
// one level inside it.
//
// What settles it is what is *inside*, not whether this is a repository: a
// product folder may be versioned itself — the queue and the journal are text
// worth keeping — and saying "you are in a clone" to someone standing in their
// own product folder is confidently wrong. A `.git` here with no repository
// under it is the mistake; a `.git` here with repositories under it is a
// product folder that has not been initialised yet.
//
// Neither branch names the parent as the answer. The folder above a clone is
// usually a projects directory full of unrelated ones, and detent would take
// every repository in it for part of the same product — the mistake this
// message exists to prevent, arrived at by following the message.
// The file being absent is the one problem a list cannot fix: whoever reads it
// has usually not met the tool, and the question behind the message is not
// "which key is wrong" but "what is this file and where am I". So it answers
// that, with what it can see from where it was pointed.
function missingProductFile(dir) {
  const inside = repositoriesIn(dir)
  const here = basename(dir) || dir

  if (inside.length > 0) {
    const shown = inside.slice(0, 8).join(', ') + (inside.length > 8 ? `, and ${inside.length - 8} more` : '')
    const counted = `${inside.length} ${inside.length === 1 ? 'repository is' : 'repositories are'} here: ${shown}`
    return {
      problem: 'does not exist',
      hint: [
        'detent reads one file to know what a product is: which repositories it',
        'has, the human branch each is compared against, the gauge that decides',
        'when an agent may stop, and which agent fills which role. It sits beside',
        'the repositories, never inside one, with the queue:',
        '',
        `  ${here}/`,
        '    .detent/product.json',
        '    tasks/{todo,hold,done,failed}/',
        `    ${inside.slice(0, 2).map((n) => `${n}/`).join('  ')}${inside.length > 2 ? '  …' : ''}`,
        '',
        ...wrap(counted),
        '',
        '  detent init             scan them, write the file, then ask an agent',
        '                          read-only what the scan cannot see',
        '  detent init --no-agent  the scan only',
      ].join('\n'),
    }
  }

  if (existsSync(join(dir, '.git'))) {
    return {
      problem: `does not exist, and ${here} is a repository`,
      hint: [
        'detent does not work from inside a repository. It works from the folder',
        'your repositories sit in, side by side, because a task names which',
        'repository it belongs to and the gauge is declared per repository.',
        '',
        'Not the folder above this one, unless that folder holds this product and',
        'nothing else: every repository directly inside becomes part of the same',
        'product, so a projects directory would make one product out of all of',
        'them.',
        '',
        '  mkdir ~/work/<product> && cd ~/work/<product>',
        '  git clone <each repository of the product>',
        '  detent init',
      ].join('\n'),
    }
  }

  return {
    problem: 'does not exist, and no repositories are here',
    hint: [
      'detent works from a product folder: the repositories of one product',
      'sitting side by side, with .detent/product.json and the queue beside them.',
      '',
      '  mkdir ~/work/<product> && cd ~/work/<product>',
      '  git clone <each repository of the product>',
      '  detent init',
    ].join('\n'),
  }
}

// A list of names is the one part of the hint whose length is not ours to
// choose, so it is the one part that wraps.
function wrap(text, width = 76) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

function repositoriesIn(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '.git' && existsSync(join(dir, entry.name, '.git')))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

// The parsed product.json and nothing judged yet: `{ raw, error, found }`.
// `found` is whether the file is there at all, and `error` is why it could not
// be read or parsed. Two readers need the file before `loadProduct` can hand
// them a product — `doctor`, which reports the file's problems rather than
// throwing them, and `init`, which may be about to write it — and both need
// one key out of it first: `queue` says where the queue is (ADR 0012).
export function readConfig(productDir) {
  const file = join(resolve(productDir), PRODUCT_FILE)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return { raw: null, error: error.code === 'ENOENT' ? null : error, found: false }
  }
  try {
    return { raw: JSON.parse(text), error: null, found: true }
  } catch (error) {
    return { raw: null, error, found: true }
  }
}

// `queue` on its own, from a parsed product.json or from nothing: a path
// relative to the product folder, `tasks` when the file says nothing (ADR
// 0012). `null` when the value is there and unusable — the product has no
// queue location, and looking for four folders somewhere else would name the
// wrong problem; the value itself is reported by whoever validates the file.
export function queueOf(raw) {
  if (!isObject(raw) || raw.queue === undefined) return DEFAULTS.queue
  return relativePath(raw.queue, 'queue', () => {})
}

export function loadProduct(productDir) {
  const dir = resolve(productDir)
  const file = join(dir, PRODUCT_FILE)

  const { raw, error, found } = readConfig(dir)
  if (!found) {
    if (error) throw error
    const { problem, hint } = missingProductFile(dir)
    throw new ConfigError(file, [problem], hint)
  }
  if (error) throw new ConfigError(file, [`is not valid JSON: ${error.message}`])

  const { product, problems } = validateProduct(raw, dir)
  if (problems.length > 0) throw new ConfigError(file, problems)
  return product
}

// Pure: the parsed JSON in, a normalised product and a list of problems out.
export function validateProduct(raw, dir = '.') {
  const problems = []
  const fail = (path, message) => problems.push(`${path}: ${message}`)

  if (!isObject(raw)) {
    fail('(root)', 'must be an object')
    return { product: null, problems }
  }

  strict(raw, '(root)', ['version', 'product', 'branches', 'queue', 'concurrency', 'attempts', 'timeout', 'notify', 'models', 'repos', 'edges'], fail)

  if (raw.version !== 1) fail('version', `must be 1, got ${JSON.stringify(raw.version)}`)

  // product
  let name = null
  let summary = null
  if (!isObject(raw.product)) {
    fail('product', 'must be an object with a name')
  } else {
    strict(raw.product, 'product', ['name', 'summary'], fail)
    name = nonEmptyString(raw.product.name, 'product.name', fail)
    if (raw.product.summary !== undefined) summary = nonEmptyString(raw.product.summary, 'product.summary', fail)
  }

  // branches — no field can name a human branch
  const branches = { integration: DEFAULTS.integration, task: DEFAULTS.task, staging: null }
  if (raw.branches !== undefined) {
    if (!isObject(raw.branches)) {
      fail('branches', 'must be an object')
    } else {
      strict(raw.branches, 'branches', ['integration', 'task', 'staging'], fail)
      if (raw.branches.integration !== undefined) {
        branches.integration = agentBranch(raw.branches.integration, 'branches.integration', fail)
      }
      if (raw.branches.task !== undefined) {
        branches.task = taskTemplate(raw.branches.task, 'branches.task', fail)
      }
      // Optional, and the second stop in the namespace (§7, ADR 0008).
      if (raw.branches.staging !== undefined) {
        branches.staging = agentBranch(raw.branches.staging, 'branches.staging', fail)
        if (branches.staging !== null && branches.staging === branches.integration) {
          fail('branches.staging', `"${branches.staging}" is the integration branch — staging is a second stop after it`)
        }
      }
    }
  }

  // queue — where the four folders are, relative to the product folder, and
  // `tasks` for a product that says nothing (ADR 0012). Validated like a
  // repository's path: it must stay inside the product folder.
  const queue = raw.queue === undefined ? DEFAULTS.queue : relativePath(raw.queue, 'queue', fail)

  // repos
  const repos = []
  if (!Array.isArray(raw.repos) || raw.repos.length === 0) {
    fail('repos', 'must be a non-empty array — a product has at least one repository')
  } else {
    const names = new Set()
    const paths = new Set()
    raw.repos.forEach((entry, index) => {
      const repo = validateRepo(entry, `repos[${index}]`, fail)
      if (!repo) return
      if (repo.name !== null) {
        if (names.has(repo.name)) fail(`repos[${index}].name`, `"${repo.name}" is declared twice`)
        names.add(repo.name)
      }
      if (repo.path !== null) {
        if (paths.has(repo.path)) fail(`repos[${index}].path`, `"${repo.path}" is declared twice`)
        paths.add(repo.path)
      }
      repos.push(repo)
    })
  }

  // The queue is detent's bookkeeping and not part of any repository: a task
  // file moving between folders inside one would dirty its tree, which §11
  // refuses and condition 5 would skip the repository for. It is also the
  // folder the scan leaves alone, and leaving a declared repository alone
  // would lose it.
  const held = queue === null ? null : repos.find((repo) => repo.path !== null && (queue === repo.path || queue.startsWith(`${repo.path}/`)))
  if (held) fail('queue', `"${queue}" is inside ${held.name ?? held.path} — the queue sits beside the repositories, never in one`)

  const concurrency = positiveInteger(raw.concurrency, 'concurrency', DEFAULTS.concurrency, fail)
  // One active task per repository (§8): more slots than repositories is a
  // number that can never be reached, which is a misunderstanding worth naming.
  if (concurrency !== null && repos.length > 0 && concurrency > repos.length) {
    fail('concurrency', `is ${concurrency}, but there are only ${repos.length} repositories and one task runs per repository`)
  }

  const attempts = positiveInteger(raw.attempts, 'attempts', DEFAULTS.attempts, fail)
  const timeout = minutesField(raw.timeout, 'timeout', DEFAULTS.timeout, fail)
  const notify = raw.notify === undefined ? null : nonEmptyString(raw.notify, 'notify', fail)
  const models = validateModels(raw.models, 'models', fail) ?? {}

  // edges
  const edges = []
  if (raw.edges !== undefined) {
    if (!Array.isArray(raw.edges)) {
      fail('edges', 'must be an array')
    } else {
      const known = new Set(repos.map((repo) => repo.name))
      raw.edges.forEach((edge, index) => {
        const path = `edges[${index}]`
        if (!isObject(edge)) return fail(path, 'must be an object')
        strict(edge, path, ['from', 'to', 'kind', 'source'], fail)
        const from = nonEmptyString(edge.from, `${path}.from`, fail)
        const to = nonEmptyString(edge.to, `${path}.to`, fail)
        const kind = nonEmptyString(edge.kind, `${path}.kind`, fail)
        for (const [key, value] of [['from', from], ['to', to]]) {
          if (value !== null && !known.has(value)) fail(`${path}.${key}`, `"${value}" is not a repository in repos`)
        }
        if (from !== null && from === to) fail(path, 'an edge cannot point from a repository to itself')
        if (!SOURCES.has(edge.source)) {
          fail(`${path}.source`, `must be "scan" or "model" — a guess must never look like a fact`)
        }
        edges.push({ from, to, kind, source: edge.source })
      })
    }
  }

  const root = resolve(dir)
  const resolved = repos.map((repo, index) => {
    // A repository overrides a role, never "the model" (§11).
    const roles = { ...models, ...repo.models }
    const { implement, accept } = roles
    if (implement && accept && implement.agent === accept.agent && (implement.model ?? null) === (accept.model ?? null)) {
      // A model tends to approve its own reasoning, and its blind spots are
      // exactly its own (ADR 0004).
      fail(`repos[${index}].models`, `implement and accept are both ${implement.agent}${implement.model ? ` (${implement.model})` : ''} — the acceptance pass runs on a different model`)
    }
    return { ...repo, dir: join(root, repo.path ?? ''), models: roles, timeout: repo.timeout ?? timeout }
  })

  if (problems.length > 0) return { product: null, problems }

  return {
    product: {
      dir: root,
      version: 1,
      name,
      summary,
      branches,
      queue,
      concurrency,
      attempts,
      timeout,
      notify,
      models,
      repos: resolved,
      edges,
    },
    problems,
  }
}

function validateRepo(entry, path, fail) {
  if (!isObject(entry)) {
    fail(path, 'must be an object')
    return null
  }
  strict(entry, path, ['name', 'path', 'role', 'stack', 'compare', 'gauge', 'models', 'timeout', 'neverCommit'], fail)

  let name = nonEmptyString(entry.name, `${path}.name`, fail)
  if (name !== null && !NAME.test(name)) {
    fail(`${path}.name`, `"${name}" must be letters, digits, ".", "_" or "-"`)
    name = null
  }

  const dirPath = entry.path === undefined ? name : relativePath(entry.path, `${path}.path`, fail)

  let role = null
  if (entry.role !== undefined) role = nonEmptyString(entry.role, `${path}.role`, fail)

  let stack = []
  if (entry.stack !== undefined) stack = stringArray(entry.stack, `${path}.stack`, fail) ?? []

  // compare is the one branch value that names a human branch, and it is only
  // ever read: it says what agent/dev is reported against (§2).
  let compare = null
  if (entry.compare === undefined) {
    fail(`${path}.compare`, 'is required — name the human branch agent/dev is reported against')
  } else if (typeof entry.compare !== 'string') {
    fail(`${path}.compare`, 'must be a branch name')
  } else {
    const problem = refNameProblem(entry.compare)
    if (problem) fail(`${path}.compare`, `"${entry.compare}" ${problem}`)
    else if (isAgentBranch(entry.compare) || entry.compare === 'agent') {
      fail(`${path}.compare`, `"${entry.compare}" is in the agent namespace — compare names a human branch`)
    } else compare = entry.compare
  }

  const gauge = validateGauge(entry.gauge, `${path}.gauge`, fail)
  const models = validateModels(entry.models, `${path}.models`, fail) ?? {}

  let neverCommit = []
  if (entry.neverCommit !== undefined) {
    if (!Array.isArray(entry.neverCommit)) fail(`${path}.neverCommit`, 'must be an array of paths')
    else neverCommit = entry.neverCommit.map((p, i) => relativePath(p, `${path}.neverCommit[${i}]`, fail))
  }

  const timeout = entry.timeout === undefined ? undefined : minutesField(entry.timeout, `${path}.timeout`, undefined, fail) ?? undefined
  return { name, path: dirPath, role, stack, compare, gauge, models, timeout, neverCommit }
}

// A repository that declares no gauge gets no lock (§6). It is not refused —
// the absence is carried forward so the journal can say so.
function validateGauge(gauge, path, fail) {
  const result = { exit: [], merge: [], promote: [] }
  if (gauge === undefined) return result
  if (!isObject(gauge)) {
    fail(path, 'must be an object of profiles')
    return result
  }
  strict(gauge, path, ['exit', 'merge', 'promote'], fail)
  for (const profile of ['exit', 'merge', 'promote']) {
    const stages = gauge[profile]
    if (stages === undefined) continue
    if (!Array.isArray(stages)) {
      fail(`${path}.${profile}`, 'must be an array of { stage, command }')
      continue
    }
    const seen = new Set()
    stages.forEach((entry, index) => {
      const at = `${path}.${profile}[${index}]`
      if (!isObject(entry)) return fail(at, 'must be { stage, command }')
      strict(entry, at, ['stage', 'command'], fail)
      const stage = nonEmptyString(entry.stage, `${at}.stage`, fail)
      const command = nonEmptyString(entry.command, `${at}.command`, fail)
      if (stage !== null && !NAME.test(stage)) {
        // The stage name goes into commit trailers and the journal verbatim.
        return fail(`${at}.stage`, `"${stage}" must be letters, digits, ".", "_" or "-"`)
      }
      if (stage !== null && seen.has(stage)) return fail(`${at}.stage`, `"${stage}" appears twice in ${profile}`)
      if (stage !== null) seen.add(stage)
      if (stage !== null && command !== null) result[profile].push({ stage, command })
    })
  }
  return result
}

function validateModels(models, path, fail) {
  if (models === undefined) return null
  if (!isObject(models)) {
    fail(path, `must be an object of roles: ${ROLES.join(', ')}`)
    return null
  }
  strict(models, path, ROLES, fail)
  const result = {}
  for (const role of ROLES) {
    const value = models[role]
    if (value === undefined) continue
    const at = `${path}.${role}`
    // A role names the agent, not only the model: "claude-opus-5" says nothing
    // about which CLI to run, and guessing it from the name is a guess (ADR 0010).
    if (!isObject(value)) {
      fail(at, `must be { "agent": ${AGENT_NAMES.map((a) => `"${a}"`).join(' | ')}, "model"?: string }`)
      continue
    }
    strict(value, at, ['agent', 'model'], fail)
    if (!AGENT_NAMES.includes(value.agent)) {
      fail(`${at}.agent`, `must be one of ${AGENT_NAMES.join(', ')}, got ${JSON.stringify(value.agent)}`)
      continue
    }
    const entry = { agent: value.agent }
    if (value.model !== undefined) {
      const model = nonEmptyString(value.model, `${at}.model`, fail)
      if (model === null) continue
      entry.model = model
    }
    result[role] = entry
  }
  return result
}

function agentBranch(value, path, fail) {
  if (typeof value !== 'string') {
    fail(path, 'must be a branch name')
    return null
  }
  const problem = refNameProblem(value)
  if (problem) {
    fail(path, `"${value}" ${problem}`)
    return null
  }
  if (!isAgentBranch(value)) {
    fail(path, `"${value}" is outside agent/ — no field in branches can name a human branch`)
    return null
  }
  return value
}

function taskTemplate(value, path, fail) {
  if (typeof value !== 'string') {
    fail(path, 'must be a branch name template')
    return null
  }
  const unknown = [...value.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((key) => key !== 'id' && key !== 'slug')
  if (unknown.length > 0) {
    fail(path, `unknown placeholder ${unknown.map((k) => `{${k}}`).join(', ')} — only {id} and {slug} exist`)
    return null
  }
  if (!value.includes('{id}')) {
    // The number is the key (§4); without it two tasks with one slug collide.
    fail(path, 'must contain {id}')
    return null
  }
  // Checked as the branch it produces, since that is what git will see.
  const sample = value.replaceAll('{id}', '0001').replaceAll('{slug}', 'sample')
  const problem = refNameProblem(sample)
  if (problem) {
    fail(path, `"${value}" ${problem}`)
    return null
  }
  if (!isAgentBranch(sample)) {
    fail(path, `"${value}" is outside agent/ — no field in branches can name a human branch`)
    return null
  }
  return value
}

function relativePath(value, path, fail) {
  if (typeof value !== 'string' || value === '') {
    fail(path, 'must be a relative path')
    return null
  }
  const clean = normalize(value).split(sep).join('/').replace(/\/$/, '')
  if (isAbsolute(value) || clean === '.' || clean === '..' || clean.startsWith('../')) {
    fail(path, `"${value}" must stay inside the product folder`)
    return null
  }
  return clean
}

function strict(object, path, allowed, fail, notYet = {}) {
  for (const key of Object.keys(object)) {
    if (allowed.includes(key)) continue
    const field = `${path === '(root)' ? '' : `${path}.`}${key}`
    if (Object.hasOwn(notYet, key)) fail(field, notYet[key])
    else fail(field, `unknown key — expected one of ${allowed.join(', ')}`)
  }
}

function nonEmptyString(value, path, fail) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(path, 'must be a non-empty string')
    return null
  }
  return value
}

function stringArray(value, path, fail) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    fail(path, 'must be an array of non-empty strings')
    return null
  }
  return value
}

function positiveInteger(value, path, fallback, fail) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) {
    fail(path, `must be a positive integer, got ${JSON.stringify(value)}`)
    return null
  }
  return value
}

// A time limit in minutes: any positive number, so a long one can be 90 and a
// short one 0.5.
function minutesField(value, path, fallback, fail) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(path, `must be a positive number of minutes, got ${JSON.stringify(value)}`)
    return null
  }
  return value
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
