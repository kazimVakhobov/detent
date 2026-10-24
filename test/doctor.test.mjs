import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FAIL, INFO, LOOK, OK, diagnose, failed, failures } from '../core/doctor.mjs'
import { PRODUCT_FILE } from '../core/product.mjs'
import { scanProduct } from '../core/scan.mjs'
import { FOLDERS } from '../core/task.mjs'

const cli = join(import.meta.dirname, '..', 'cli.mjs')
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function repo(dir, name, { branches = ['agent/dev'], files = { 'a.txt': 'a\n' } } = {}) {
  const path = join(dir, name)
  mkdirSync(path)
  sh(path, 'init', '--quiet', '--initial-branch=dev')
  sh(path, 'config', 'user.name', 'P')
  sh(path, 'config', 'user.email', 'p@x')
  for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text)
  sh(path, 'add', '-A')
  sh(path, 'commit', '--quiet', '-m', 'init')
  for (const b of branches) sh(path, 'branch', b)
  return path
}

function product(raw, build, { queue = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'detent-doctor-'))
  build?.(dir)
  if (queue) for (const folder of FOLDERS) mkdirSync(join(dir, 'tasks', folder), { recursive: true })
  if (raw) {
    mkdirSync(join(dir, '.detent'))
    writeFileSync(join(dir, '.detent', 'product.json'), typeof raw === 'string' ? raw : JSON.stringify(raw))
  }
  return dir
}

// A scan as if the given agents were installed, on this machine.
function scan(dir, agents = ['claude']) {
  return { ...scanProduct(dir), agents }
}

const healthy = {
  version: 1,
  product: { name: 'acme' },
  models: { implement: { agent: 'claude', model: 'claude-sonnet-5' }, accept: { agent: 'claude', model: 'claude-opus-5' } },
  repos: [{ name: 'api', compare: 'dev', gauge: { exit: [{ stage: 'test', command: 'true' }] } }],
}

function find(checks, pattern) {
  return checks.find((c) => pattern.test(c.text))
}

test('a product in shape: nothing fails', () => {
  const dir = product(healthy, (d) => repo(d, 'api'))
  const report = diagnose(dir, scan(dir))
  assert.equal(failed(report), 0)
  const api = report.repos.api
  for (const condition of [1, 3, 4, 5, 7]) assert.equal(api.find((c) => c.condition === condition)?.status, OK, `condition ${condition}`)
  assert.equal(report.product.find((c) => c.condition === 9).status, OK)
  assert.equal(report.product.find((c) => c.condition === 8).status, INFO, 'one person per workspace cannot be checked, and says so')
  assert.equal(report.product.filter((c) => c.condition === 6).every((c) => c.status === OK), true)
  assert.equal(find(api, /submodule/), undefined, 'a repository that mounts nothing is told nothing about submodules')
})

test('the queue is a check of its own: there is a pass, missing is a failure naming the command', () => {
  const whole = product(healthy, (d) => repo(d, 'api'))
  assert.equal(find(diagnose(whole, scan(whole)).product, /the queue is there/).status, OK)

  const dir = product(healthy, (d) => repo(d, 'api'), { queue: false })
  const report = diagnose(dir, scan(dir))
  const check = find(report.product, /tasks\/todo/)
  assert.equal(check.status, FAIL)
  assert.equal(check.fix, `detent init --product ${dir}`)
  assert.equal(failed(report), 1, 'a product with nowhere to put a task is not ready')
  assert.equal(existsSync(join(dir, 'tasks')), false, 'doctor created nothing')

  mkdirSync(join(dir, 'tasks', 'todo'), { recursive: true })
  const half = find(diagnose(dir, scan(dir)).product, /do not exist/)
  assert.match(half.text, /^tasks\/hold, tasks\/done, tasks\/failed do not exist/, 'only the folders that are missing are named')
})

test('no agent/dev: the command to create it, from the compare branch, and nothing more', () => {
  const dir = product(healthy, (d) => repo(d, 'api', { branches: [] }))
  const check = find(diagnose(dir, scan(dir)).repos.api, /agent\/dev does not exist/)
  assert.equal(check.status, FAIL)
  assert.equal(check.fix, `git -C ${join(dir, 'api')} branch agent/dev dev`)
  assert.deepEqual(sh(join(dir, 'api'), 'branch', '--list', 'agent/*'), '', 'doctor created nothing')
})

test('a branch named exactly agent fails', () => {
  const dir = product(healthy, (d) => {
    const path = repo(d, 'api', { branches: [] })
    sh(path, 'branch', 'agent')
  })
  assert.equal(find(diagnose(dir, scan(dir)).repos.api, /named exactly "agent"/).status, FAIL)
})

test('a shallow clone, a dirty tree and a merge in progress fail', () => {
  const dir = product(
    { ...healthy, repos: [...healthy.repos, { name: 'web', compare: 'dev' }, { name: 'mid', compare: 'dev' }] },
    (d) => {
      const origin = repo(d, 'origin', { files: { 'a.txt': '1\n' } })
      writeFileSync(join(origin, 'a.txt'), '2\n')
      sh(origin, 'commit', '--quiet', '-am', 'two')
      execFileSync('git', ['clone', '--quiet', '--depth=1', `file://${origin}`, join(d, 'api')])
      execFileSync('git', ['-C', join(d, 'api'), 'branch', 'agent/dev'])
      const web = repo(d, 'web')
      writeFileSync(join(web, 'scratch.txt'), 'mine')
      const mid = repo(d, 'mid', { files: { 'f.txt': 'base\n' } })
      sh(mid, 'switch', '--quiet', '-c', 'other')
      writeFileSync(join(mid, 'f.txt'), 'other\n')
      sh(mid, 'commit', '--quiet', '-am', 'other')
      sh(mid, 'switch', '--quiet', 'dev')
      writeFileSync(join(mid, 'f.txt'), 'dev\n')
      sh(mid, 'commit', '--quiet', '-am', 'dev')
      assert.throws(() => sh(mid, 'merge', 'other'))
    },
  )
  const report = diagnose(dir, scan(dir))
  assert.equal(report.repos.api.find((c) => c.condition === 1).status, FAIL)
  assert.match(report.repos.api.find((c) => c.condition === 1).fix, /fetch --unshallow/)
  assert.equal(report.repos.web.find((c) => c.condition === 5).status, FAIL)
  assert.match(report.repos.mid.find((c) => c.condition === 5).text, /a merge is in progress/)
  assert.ok(find(report.product, /origin is a repository in this folder and not in/), 'an undeclared repository is worth a look')
})

test('worth a look: no gauge, no reviewer, agent/dev tracking a remote', () => {
  const dir = product(
    { ...healthy, models: { implement: { agent: 'claude' } }, repos: [{ name: 'api', compare: 'dev' }] },
    (d) => {
      const api = repo(d, 'api')
      sh(api, 'remote', 'add', 'origin', 'https://example.com/api.git')
      sh(api, 'config', 'branch.agent/dev.remote', 'origin')
    },
  )
  const report = diagnose(dir, scan(dir))
  const api = report.repos.api
  assert.equal(api.find((c) => c.condition === 4).status, LOOK)
  assert.equal(api.find((c) => c.condition === 7).status, LOOK)
  assert.equal(find(report.product, /api has no acceptance pass/).status, LOOK)
  assert.equal(failed(report), 0, 'none of these stops a run')
})

// A gauge is written once and a repository that gains a check afterwards gains
// it silently: the whole of the answer is a line in doctor that a person may
// ignore.
test('a declared check no stage runs is worth a look, names the script and what to do, and blocks nothing', () => {
  const scripts = { lint: 'eslint .', test: 'vitest run' }
  const gauge = { exit: [{ stage: 'lint', command: 'npm run lint' }] }
  const dir = product({ ...healthy, repos: [{ name: 'api', compare: 'dev', gauge }] }, (d) => repo(d, 'api', { files: { 'package.json': JSON.stringify({ scripts }) } }))
  const report = diagnose(dir, scan(dir))
  const check = find(report.repos.api, /declares test/)
  assert.equal(check.status, LOOK)
  assert.equal(check.text, 'package.json declares test and no gauge stage runs it — a green gauge here says nothing about it')
  assert.equal(check.fix, `add a stage running npm test to gauge.exit in ${PRODUCT_FILE}, or leave it out deliberately`)
  assert.equal(find(report.repos.api, /declares lint/), undefined, 'the one the gauge runs says nothing')

  // A person who left a check out on purpose must not have to argue with the
  // tool about it: it fails nothing, refuses no run, and the report is ready.
  assert.equal(failed(report), 0)
  assert.deepEqual(failures(dir, scan(dir), ['api']), [])
  const bin = mkdtempSync(join(tmpdir(), 'detent-agents-'))
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n')
  chmodSync(join(bin, 'claude'), 0o755)
  const out = execFileSync(process.execPath, [cli, 'doctor', '--product', dir], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  assert.match(out, /^ {2}! {4}package\.json declares test and no gauge stage runs it/m)
  assert.match(out, /^ready, 1 worth a look, 1 not checkable$/m)
})

// What is read is the commands, never a stage's name: the story this exists for
// is a gauge of lint and typecheck beside a test script nothing ran.
test('a stage that runs the script runs it however it is spelled, and a stage named for it does not', () => {
  const quiet = (scripts, gauge) => {
    const dir = product({ ...healthy, repos: [{ name: 'api', compare: 'dev', gauge }] }, (d) => repo(d, 'api', { files: { 'package.json': JSON.stringify({ scripts }) } }))
    return diagnose(dir, scan(dir)).repos.api.filter((c) => /no gauge stage runs it/.test(c.text)).map((c) => c.text)
  }

  // Named by a stage called something else, run with the arguments of the day,
  // reached through another script, or run as the command the script itself is.
  assert.deepEqual(quiet({ test: 'vitest run' }, { exit: [{ stage: 'checks', command: 'npm test' }] }), [])
  assert.deepEqual(quiet({ test: 'vitest run' }, { exit: [{ stage: 'checks', command: 'CI=1 npm run test -- --reporter=dot' }] }), [])
  assert.deepEqual(quiet({ test: 'vitest run', ci: 'npm run lint && npm test', lint: 'eslint .' }, { exit: [{ stage: 'all', command: 'npm run ci' }] }), [])
  assert.deepEqual(quiet({ test: 'node --test' }, { exit: [{ stage: 'unit', command: 'node --test' }] }), [])
  assert.deepEqual(quiet({ test: 'tsc --noEmit && node --test' }, { exit: [{ stage: 'types', command: 'tsc --noEmit' }, { stage: 'unit', command: 'node --test' }] }), [])
  // A check run at promotion is a check that runs.
  assert.deepEqual(quiet({ build: 'tsup' }, { exit: [{ stage: 'unit', command: 'true' }], promote: [{ stage: 'build', command: 'npm run build' }] }), [])

  // And a stage named test that runs something else runs no test.
  assert.deepEqual(quiet({ test: 'vitest run' }, { exit: [{ stage: 'test', command: 'npm run lint' }] }), [
    'package.json declares test and no gauge stage runs it — a green gauge here says nothing about it',
  ])
})

// Where it cannot be decided, nothing is said: a check reported as unrun when
// the gauge in fact runs it is an argument with a person who did nothing wrong.
test('nothing is reported where the gauge cannot be read, where it covers everything, or where nothing is declared', () => {
  const api = (scripts, gauge, files = {}) =>
    product({ ...healthy, repos: [{ name: 'api', compare: 'dev', gauge }] }, (d) => repo(d, 'api', { files: { 'a.txt': 'a\n', ...files, ...(scripts ? { 'package.json': JSON.stringify({ scripts }) } : {}) } }))
  const looks = (dir) => diagnose(dir, scan(dir)).repos.api.filter((c) => /no gauge stage runs it/.test(c.text))

  for (const command of ['make check', 'sh -c "npm test"', 'npm test | tee out.log', 'pnpm -r test', 'npm run test --workspaces']) {
    const dir = api({ lint: 'eslint .', test: 'vitest run' }, { exit: [{ stage: 'checks', command }] })
    assert.deepEqual(looks(dir), [], `a gauge detent cannot read says nothing: ${command}`)
  }

  // A gauge that covers what the repository declares, and a repository that
  // declares nothing a gauge could run: both quiet.
  assert.deepEqual(looks(api({ lint: 'eslint .', test: 'vitest run' }, { exit: [{ stage: 'lint', command: 'npm run lint' }, { stage: 'test', command: 'npm test' }] })), [])
  assert.deepEqual(looks(api({ dev: 'vite', start: 'node server.mjs' }, { exit: [{ stage: 'unit', command: 'true' }] })), [])
  assert.deepEqual(looks(api({ test: 'echo "Error: no test specified" && exit 1' }, { exit: [{ stage: 'unit', command: 'true' }] })), [], 'the script npm init writes checks nothing')

  // The same answer whether the repository is a Node package or not: one with
  // no declared scripts at all is a repository with no declared scripts.
  assert.deepEqual(looks(api(null, { exit: [{ stage: 'unit', command: 'cargo test' }] }, { 'Cargo.toml': '[package]\nname = "api"\n' })), [])
  assert.deepEqual(looks(api(null, { exit: [{ stage: 'unit', command: 'true' }] })), [])

  // And a repository with no gauge at all is told it has no lock, once:
  // condition 4 is the whole of that, and a list of what the nothing does not
  // run would be the same sentence four times.
  const none = api({ lint: 'eslint .', test: 'vitest run' }, undefined)
  assert.deepEqual(looks(none), [])
  assert.equal(diagnose(none, scan(none)).repos.api.find((c) => c.condition === 4).status, LOOK)
})

// ADR 0012: one list, read two ways. Outside neverCommit is the deliberate
// configuration, and the only thing wrong with it is a commit nobody else has.
test('a submodule outside neverCommit is tracked, not a problem; one with unpushed commits fails and is named', () => {
  const build = (d) => {
    repo(d, 'docs')
    const api = repo(d, 'api')
    execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '../docs', 'docs'], { cwd: api, stdio: 'ignore' })
    sh(api, 'commit', '--quiet', '-m', 'docs')
    return api
  }

  const dir = product({ ...healthy, repos: [{ name: 'api', compare: 'dev', gauge: healthy.repos[0].gauge }] }, build)
  const tracked = find(diagnose(dir, scan(dir)).repos.api, /submodule docs/)
  assert.equal(tracked.status, OK)
  assert.match(tracked.text, /is tracked — .*its pointer is committed with the task once that commit is verified to be on a remote branch/)
  assert.equal(failed(diagnose(dir, scan(dir))), 0)

  // The submodule in neverCommit is the one detent never touches: as before,
  // doctor has nothing to say about it.
  const guarded = product({ ...healthy, repos: [{ name: 'api', compare: 'dev', neverCommit: ['docs'] }] }, build)
  assert.equal(find(diagnose(guarded, scan(guarded)).repos.api, /submodule docs/), undefined)

  // A commit made in the submodule and not pushed is the pointer to nowhere
  // the run refuses before the commit (§13) — here before the run.
  const unpushed = product({ ...healthy, repos: [{ name: 'api', compare: 'dev' }] }, (d) => {
    const sub = join(build(d), 'docs')
    sh(sub, 'config', 'user.name', 'P')
    sh(sub, 'config', 'user.email', 'p@x')
    writeFileSync(join(sub, 'a.txt'), 'mine, and only mine\n')
    sh(sub, 'commit', '--quiet', '-am', 'a decision nobody else has')
  })
  const report = diagnose(unpushed, scan(unpushed))
  const check = find(report.repos.api, /submodule docs/)
  assert.equal(check.status, FAIL)
  assert.match(check.text, /^submodule docs is at [0-9a-f]{7}, which is in none of its remote branches — it has unpushed commits, and a run would pause on it/)
  assert.equal(check.fix, `git -C ${join(unpushed, 'api', 'docs')} push`)
  assert.ok(failed(report) > 0, 'a run would pause on it, so it is a failure')
})

test('an agent that is not installed fails condition 6', () => {
  const dir = product(healthy, (d) => repo(d, 'api'))
  const report = diagnose(dir, scan(dir, []))
  const found = report.product.find((c) => c.condition === 6 && /claude/.test(c.text))
  assert.equal(found.status, FAIL)
  assert.match(found.text, /claude is not on PATH/)
  assert.equal(found.fix, 'install claude and sign in')
})

test('no product.json, or a broken one, is reported with the way out', () => {
  const none = product(null, (d) => repo(d, 'api'))
  const missing = diagnose(none, scan(none))
  assert.equal(missing.loaded, false)
  assert.equal(find(missing.product, /no \.detent\/product\.json/).fix, `detent init --product ${none}`)

  const broken = product({ ...healthy, branches: { integration: 'dev' } }, (d) => repo(d, 'api'))
  assert.match(find(diagnose(broken, scan(broken)).product, /branches\.integration/).text, /outside agent\//)
})

test('detent doctor exits 1 on a failure, 0 when ready, and writes nothing', () => {
  const dir = product(healthy, (d) => repo(d, 'api', { branches: [] }))
  const bin = mkdtempSync(join(tmpdir(), 'detent-agents-'))
  for (const agent of ['claude']) {
    writeFileSync(join(bin, agent), '#!/bin/sh\n')
    chmodSync(join(bin, agent), 0o755)
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
  const before = readdirSync(dir).map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`)
  let error
  try {
    execFileSync(process.execPath, [cli, 'doctor', '--product', dir], { encoding: 'utf8', stdio: 'pipe', env })
  } catch (e) {
    error = e
  }
  assert.equal(error.status, 1)
  assert.match(error.stdout, /^ {2}✗ +agent\/dev does not exist/m)
  assert.match(error.stdout, /^ +→ git -C .* branch agent\/dev dev$/m)
  assert.match(error.stdout, /1 to change/)
  assert.deepEqual(readdirSync(dir).map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`), before)

  sh(join(dir, 'api'), 'branch', 'agent/dev')
  const out = execFileSync(process.execPath, [cli, 'doctor', '--product', dir], { encoding: 'utf8', env })
  assert.match(out, /^ready/m)

  // A product whose queue is gone is not ready, and does not exit 0.
  rmSync(join(dir, 'tasks'), { recursive: true })
  let gone
  try {
    execFileSync(process.execPath, [cli, 'doctor', '--product', dir], { encoding: 'utf8', stdio: 'pipe', env })
  } catch (e) {
    gone = e
  }
  assert.equal(gone.status, 1)
  assert.doesNotMatch(gone.stdout, /^ready/m)
  assert.match(gone.stdout, /^ +→ detent init --product /m)
})

test('staging: a promote gauge with no staging fails, a declared staging must exist', () => {
  const promote = { exit: [{ stage: 'test', command: 'true' }], promote: [{ stage: 'e2e', command: 'true' }] }
  const orphan = product({ ...healthy, repos: [{ name: 'api', compare: 'dev', gauge: promote }] }, (d) => repo(d, 'api'))
  assert.equal(find(diagnose(orphan, scan(orphan)).repos.api, /gauge\.promote is declared but there is no branches\.staging/).status, FAIL)

  const missing = product({ ...healthy, branches: { staging: 'agent/staging' }, repos: [{ name: 'api', compare: 'dev', gauge: promote }] }, (d) => repo(d, 'api'))
  const check = find(diagnose(missing, scan(missing)).repos.api, /agent\/staging does not exist/)
  assert.equal(check.status, FAIL)
  assert.equal(check.fix, `git -C ${join(missing, 'api')} branch agent/staging agent/dev`)

  const ready = product({ ...healthy, branches: { staging: 'agent/staging' }, repos: [{ name: 'api', compare: 'dev', gauge: promote }] }, (d) => repo(d, 'api', { branches: ['agent/dev', 'agent/staging'] }))
  const report = diagnose(ready, scan(ready))
  assert.equal(failed(report), 0)
  assert.match(find(report.repos.api, /agent\/staging exists/).text, /promote: e2e/)
})

test('the queue is looked for where product.json says, and a queue that escapes is that problem', () => {
  const dir = product({ ...healthy, queue: 'agent-loop/tasks' }, (d) => repo(d, 'api'), { queue: false })
  const missing = find(diagnose(dir, scan(dir)).product, /do not exist/)
  assert.equal(missing.status, FAIL)
  assert.match(missing.text, /^agent-loop\/tasks\/todo, agent-loop\/tasks\/hold, agent-loop\/tasks\/done, agent-loop\/tasks\/failed do not exist/)
  assert.equal(existsSync(join(dir, 'tasks')), false, 'and the default is not where it looked')

  for (const folder of FOLDERS) mkdirSync(join(dir, 'agent-loop', 'tasks', folder), { recursive: true })
  assert.equal(find(diagnose(dir, scan(dir)).product, /the queue is there/).text, `the queue is there: agent-loop/tasks/{${FOLDERS.join(',')}}`)

  // A queue outside the product folder has no folders to look for: the value
  // is the problem, and four missing folders would name the wrong one.
  const escaping = product({ ...healthy, queue: '../elsewhere' }, (d) => repo(d, 'api'), { queue: false })
  const report = diagnose(escaping, scan(escaping))
  assert.equal(find(report.product, /queue: "\.\.\/elsewhere" must stay inside the product folder/).status, FAIL)
  assert.equal(find(report.product, /do not exist|the queue is there/), undefined)
})

test('detent doctor does not take the folder the queue lives in for a repository of the product', () => {
  const dir = product({ ...healthy, queue: 'agent-loop/tasks' }, (d) => {
    repo(d, 'api')
    repo(d, 'agent-loop')
  }, { queue: false })
  for (const folder of FOLDERS) mkdirSync(join(dir, 'agent-loop', 'tasks', folder), { recursive: true })
  const bin = mkdtempSync(join(tmpdir(), 'detent-agents-'))
  for (const agent of ['claude']) {
    writeFileSync(join(bin, agent), '#!/bin/sh\n')
    chmodSync(join(bin, agent), 0o755)
  }

  const out = execFileSync(process.execPath, [cli, 'doctor', '--product', dir], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  assert.match(out, /the queue is there: agent-loop\/tasks\//)
  assert.doesNotMatch(out, /agent-loop is a repository in this folder/)
  // That repository has no remote, which is the second of the two queue
  // findings and the reason the summary is not a bare "ready".
  assert.match(out, /^ {2}! {4}agent-loop\/tasks is in a repository whose branch tracks no remote/m)
  assert.match(out, /^ready, 1 worth a look, 1 not checkable$/m)
})

// One idea, two sentences: a configured queue says the product expects a queue
// two machines share, and there are two ways of not having one.
test('a configured queue that cannot be published is a finding of its own, and says which of the two it is', () => {
  const plain = product({ ...healthy, queue: 'agent-loop/tasks' }, (d) => repo(d, 'api'), { queue: false })
  for (const folder of FOLDERS) mkdirSync(join(plain, 'agent-loop', 'tasks', folder), { recursive: true })
  const local = diagnose(plain, scan(plain))
  const nothing = find(local.product, /is not in a git repository/)
  assert.equal(nothing.status, FAIL, 'the queue never leaves this machine, which is what configuring it was against')
  assert.match(
    nothing.text,
    /^agent-loop\/tasks is not in a git repository — the queue stays on this machine: a task's move is a file move, with nothing to commit it to and nothing to push/,
  )
  assert.ok(failed(local) > 0, 'so the report does not answer ready')
  assert.equal(existsSync(join(plain, 'agent-loop', '.git')), false, 'and doctor created nothing')

  // Nothing a run does would fix this and the run reads the queue itself, so
  // this failure is doctor's to report and never a refused run.
  assert.deepEqual(failures(plain, scan(plain), ['api']).filter((c) => /queue|git repository/.test(c.text)), [])

  // The queue in a repository: the same four folders, a different sentence,
  // and nothing wrong — a queue nobody can fetch has no next machine to be
  // stale for.
  const alone = product({ ...healthy, queue: 'agent-loop/tasks' }, (d) => {
    repo(d, 'api')
    repo(d, 'agent-loop')
  }, { queue: false })
  for (const folder of FOLDERS) mkdirSync(join(alone, 'agent-loop', 'tasks', folder), { recursive: true })
  const quiet = diagnose(alone, scan(alone))
  const unpublished = find(quiet.product, /tracks no remote/)
  assert.equal(unpublished.status, LOOK)
  assert.match(unpublished.text, /^agent-loop\/tasks is in a repository whose branch tracks no remote — a task's move is committed there and pushed nowhere/)
  assert.equal(failed(quiet), 0)

  // A queue the next machine can fetch is the configuration working, and says
  // nothing at all.
  const loop = join(alone, 'agent-loop')
  sh(loop, 'remote', 'add', 'origin', 'https://example.com/agent-loop.git')
  sh(loop, 'config', 'branch.dev.remote', 'origin')
  sh(loop, 'config', 'branch.dev.merge', 'refs/heads/dev')
  assert.equal(find(diagnose(alone, scan(alone)).product, /not in a git repository|tracks no remote/), undefined)

  // And so does the default location: this check asks nothing of a product
  // that asked nothing of its queue (ADR 0005).
  const dir = product(healthy, (d) => repo(d, 'api'))
  assert.equal(find(diagnose(dir, scan(dir)).product, /not in a git repository|tracks no remote/), undefined)
  assert.equal(failed(diagnose(dir, scan(dir))), 0)
})
