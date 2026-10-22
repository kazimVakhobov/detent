import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MODEL_SUGGESTIONS, validateProduct } from '../core/product.mjs'
import { diffLines, mergeProposal, proposeProduct } from '../core/propose.mjs'
import { scanProduct } from '../core/scan.mjs'

const cli = join(import.meta.dirname, '..', 'cli.mjs')

function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function repo(product, name, { branch = 'main', files = {}, branches = [] } = {}) {
  const dir = join(product, name)
  mkdirSync(dir)
  sh(dir, 'init', '--quiet', `--initial-branch=${branch}`)
  sh(dir, 'config', 'user.name', 'P')
  sh(dir, 'config', 'user.email', 'p@x')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '--quiet', '--allow-empty', '-m', 'init')
  for (const b of branches) sh(dir, 'branch', b)
  return dir
}

// PATH with only the agents named, plus the system tools.
function withAgents(agents, fn) {
  const bin = mkdtempSync(join(tmpdir(), 'detent-agents-'))
  for (const agent of agents) {
    writeFileSync(join(bin, agent), '#!/bin/sh\n')
    chmodSync(join(bin, agent), 0o755)
  }
  const saved = process.env.PATH
  process.env.PATH = `${bin}:/usr/local/bin:/usr/bin:/bin`
  try {
    return fn(process.env.PATH)
  } finally {
    process.env.PATH = saved
  }
}

function shop() {
  const dir = join(mkdtempSync(join(tmpdir(), 'detent-init-')), 'shop')
  mkdirSync(dir)
  repo(dir, 'shop-api', {
    files: { 'package.json': JSON.stringify({ scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run', build: 'tsc' } }), 'pnpm-lock.yaml': '', 'test/a.test.ts': '' },
    branches: ['dev', 'agent/dev'],
  })
  repo(dir, 'shop-docs', { files: { 'README.md': '# docs' } })
  const web = repo(dir, 'shop-web', { branch: 'master', files: { 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) } })
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', '../shop-docs', 'docs'], { cwd: web, stdio: 'ignore' })
  sh(web, 'commit', '--quiet', '-am', 'docs')
  repo(dir, 'shop-svc', { files: { 'go.mod': 'module svc\n' } })
  mkdirSync(join(dir, 'notes'))
  return dir
}

test('the scan reads what is there, and asks no model', () => {
  const dir = shop()
  const scan = withAgents(['claude'], () => scanProduct(dir))
  assert.deepEqual(scan.repos.map((r) => r.name), ['shop-api', 'shop-docs', 'shop-svc', 'shop-web'])
  assert.deepEqual(scan.other, ['notes'], 'a folder that is not a repository is noted, not adopted')
  assert.deepEqual(scan.agents, ['claude'])
  const api = scan.repos[0]
  assert.equal(api.packageManager, 'pnpm')
  assert.equal(api.shallow, false)
  assert.equal(api.clean, true)
  assert.equal(api.tests, true)
  assert.ok(api.branches.includes('agent/dev'))
  const web = scan.repos.find((r) => r.name === 'shop-web')
  assert.deepEqual(web.submodules.map((s) => s.path), ['docs'])
})

test('the proposal: compare from real branches, gauge from declared scripts, submodules as neverCommit and edges', () => {
  const dir = shop()
  const raw = withAgents(['claude'], () => proposeProduct(scanProduct(dir)))
  const byName = Object.fromEntries(raw.repos.map((r) => [r.name, r]))

  assert.equal(byName['shop-api'].compare, 'dev', 'dev before main')
  assert.equal(byName['shop-web'].compare, 'master')
  assert.deepEqual(byName['shop-api'].gauge, {
    exit: [
      { stage: 'lint', command: 'pnpm run lint' },
      { stage: 'typecheck', command: 'pnpm run typecheck' },
      { stage: 'test', command: 'pnpm run test' },
    ],
    merge: [{ stage: 'build', command: 'pnpm run build' }],
  })
  assert.equal(byName['shop-web'].gauge, undefined, "npm init's placeholder test checks nothing and is not proposed")
  assert.equal(byName['shop-docs'].gauge, undefined, 'nothing is guessed for a repository with no scripts')
  assert.deepEqual(byName['shop-svc'].gauge, { exit: [{ stage: 'vet', command: 'go vet ./...' }, { stage: 'test', command: 'go test ./...' }] })
  assert.deepEqual(byName['shop-svc'].stack, ['go'])
  assert.deepEqual(byName['shop-web'].neverCommit, ['docs'])
  assert.deepEqual(raw.edges, [{ from: 'shop-web', to: 'shop-docs', kind: 'submodule', source: 'scan' }])
  assert.deepEqual(raw.models, { implement: { agent: 'claude' } }, 'the installed agent implements, and no reviewer is invented for it')
  assert.deepEqual(validateProduct(raw, dir).problems, [])
})

// One agent is offered (ADR 0018), so a reviewer would be the same agent on
// another model — and which models an account has is not something a scan can
// see. ADR 0004 is why the key is left out rather than filled: a pass by the
// model that implemented agrees with itself.
test('no reviewer is invented, whatever is installed; none installed: no models', () => {
  const dir = shop()
  assert.deepEqual(withAgents(['claude'], () => proposeProduct(scanProduct(dir))).models, { implement: { agent: 'claude' } })
  assert.equal(withAgents([], () => proposeProduct(scanProduct(dir))).models, undefined)
})

test('what a person wrote wins; the scan only adds', () => {
  const existing = {
    version: 1,
    product: { name: 'shop', summary: 'mine' },
    models: { implement: { agent: 'claude', model: 'x' } },
    repos: [{ name: 'shop-api', compare: 'main', role: 'the API', gauge: { exit: [{ stage: 'test', command: 'make check' }] } }, { name: 'gone', compare: 'main' }],
    edges: [],
  }
  const proposed = {
    version: 1,
    product: { name: 'shop' },
    models: { implement: { agent: 'claude' } },
    repos: [{ name: 'shop-api', compare: 'dev', stack: ['node'] }, { name: 'shop-web', compare: 'main' }],
    edges: [{ from: 'shop-web', to: 'shop-api', kind: 'submodule', source: 'scan' }],
  }
  const merged = mergeProposal(existing, proposed)
  assert.deepEqual(merged.product, { name: 'shop', summary: 'mine' })
  assert.deepEqual(merged.models, existing.models)
  assert.deepEqual(merged.repos[0], { name: 'shop-api', compare: 'main', stack: ['node'], role: 'the API', gauge: existing.repos[0].gauge })
  assert.deepEqual(merged.repos.map((r) => r.name), ['shop-api', 'gone', 'shop-web'], 'a repository the person declared is not dropped by the scan')
  assert.equal(merged.edges.length, 1)
})

test('diffLines marks what was added and removed', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nc\nd'), ['  a', '- b', '  c', '+ d'])
})

test('detent init writes product.json, then proposes rather than overwrites', () => {
  const dir = shop()
  const env = withAgents(['claude'], (path) => ({ ...process.env, PATH: `${path}:${process.execPath.replace(/\/node$/, '')}` }))
  const init = () => execFileSync(process.execPath, [cli, 'init', '--product', dir], { encoding: 'utf8', env })

  const first = init()
  assert.match(first, /^wrote \.detent\/product\.json — 4 repositories: shop-api, shop-docs, shop-svc, shop-web$/m)
  assert.match(first, /shop-web: no gauge stages — /)
  const written = JSON.parse(readFileSync(join(dir, '.detent', 'product.json'), 'utf8'))
  assert.equal(written.repos.length, 4)
  // No reviewer is written, and the note says why rather than leaving the key
  // to be found missing (ADR 0018, ADR 0004).
  assert.equal(written.models.accept, undefined)
  assert.match(first, /models\.accept is not set — no acceptance pass\. This version offers one agent, so set it to claude with a different model; the scan cannot see which models you have/)

  // The names a person is offered where a model is typed, written into the file
  // rather than left only in detent, with the sentence that says what they are:
  // a suggestion, confirmed by running them, and the person's to extend
  // (ADR 0019). This is the line the key exists for — there was nowhere to
  // learn what a model name looks like.
  assert.deepEqual(written.modelSuggestions, [...MODEL_SUGGESTIONS])
  assert.deepEqual(Object.keys(written), ['version', 'product', 'queue', 'docs', 'models', 'modelSuggestions', 'repos', 'edges'])
  assert.match(first, /modelSuggestions: 8 model names detent has watched run \(opus, sonnet, haiku, …\), offered wherever a model is typed — yours to extend in \.detent\/product\.json, and any name may be used: nothing checks a model against the list/)

  const again = init()
  assert.match(again, /already says everything the scan found/)
  assert.match(again, /yours to extend in \.detent\/product\.json/, 'said whether the file was written or already said it')

  // A file carrying its own list keeps it, and the note counts that one: the
  // list is the product's, and a name removed from it stays removed.
  writeFileSync(join(dir, '.detent', 'product.json'), JSON.stringify({ ...written, modelSuggestions: ['opus', 'mine-5'] }, null, 2))
  const mine = init()
  assert.match(mine, /modelSuggestions: 2 model names detent has watched run \(opus, mine-5, …\)/)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.detent', 'product.json'), 'utf8')).modelSuggestions, ['opus', 'mine-5'])
  assert.doesNotMatch(mine, /modelSuggestions.*not usable|modelSuggestions: must be/, 'and nothing refuses a list of the product’s own')
  writeFileSync(join(dir, '.detent', 'product.json'), JSON.stringify(written, null, 2))

  written.repos[0].role = 'the API, by hand'
  writeFileSync(join(dir, '.detent', 'product.json'), JSON.stringify(written, null, 2))
  repo(dir, 'shop-admin', { files: { Makefile: 'test:\n\tgo test ./...\n' } })
  const third = init()
  assert.match(third, /exists, so nothing was overwritten/)
  assert.match(third, /^\+ +"name": "shop-admin",$/m)
  assert.doesNotMatch(third, /^- /m, 'nothing the person wrote is proposed for removal')
  assert.equal(JSON.parse(readFileSync(join(dir, '.detent', 'product.json'), 'utf8')).repos[0].role, 'the API, by hand', 'product.json untouched')
  const proposal = JSON.parse(readFileSync(join(dir, '.detent', 'product.proposed.json'), 'utf8'))
  assert.equal(proposal.repos[0].role, 'the API, by hand')
  assert.ok(proposal.repos.some((r) => r.name === 'shop-admin'))
})

test('a product.json a person broke is a message, and nothing to propose still reports', () => {
  const dir = shop()
  const env = withAgents(['claude'], (path) => ({ ...process.env, PATH: `${path}:${process.execPath.replace(/\/node$/, '')}` }))
  const init = (extra = []) => {
    try {
      return { out: execFileSync(process.execPath, [cli, 'init', '--product', dir, ...extra], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }
    } catch (error) {
      return { out: `${error.stdout ?? ''}${error.stderr ?? ''}`, code: error.status }
    }
  }

  init(['--no-agent'])

  // A comma in the wrong place is expected input from a file people edit, so
  // it is named like any other config problem — never a stack trace.
  writeFileSync(join(dir, '.detent', 'product.json'), '{ "version": 1, broken\n')
  const broken = init(['--no-agent'])
  assert.match(broken.out, /is not valid JSON/)
  assert.match(broken.out, /move it aside/)
  assert.doesNotMatch(broken.out, /SyntaxError|at Module\./, 'a stack trace is not an error message')

  // Nothing to propose is not nothing to report: the notes still print, so a
  // run that changed no file still says what is missing.
  rmSync(join(dir, '.detent', 'product.json'))
  init(['--no-agent'])
  const unchanged = init(['--no-agent'])
  assert.match(unchanged.out, /already says everything the scan found/)
  assert.match(unchanged.out, /read the gauge stages before an agent is held to them/, 'the notes survive the early exit')
})

test('detent init creates the queue, with --no-agent too, and leaves what is queued alone', () => {
  const dir = shop()
  const queued = join(dir, 'tasks', 'todo', '0001-wallet-endpoint.md')
  mkdirSync(join(dir, 'tasks', 'todo'), { recursive: true })
  writeFileSync(queued, '---\nid: 0001\nrepo: shop-api\n---\n\n# Goal\n')
  const env = withAgents(['claude'], (path) => ({ ...process.env, PATH: `${path}:${process.execPath.replace(/\/node$/, '')}` }))

  const out = execFileSync(process.execPath, [cli, 'init', '--product', dir, '--no-agent'], { encoding: 'utf8', env })
  assert.match(out, /^created tasks\/hold, tasks\/done, tasks\/failed — the queue run reads and plan writes into$/m, 'only the folders it created are named')
  for (const folder of ['todo', 'hold', 'done', 'failed']) {
    assert.equal(statSync(join(dir, 'tasks', folder)).isDirectory(), true, `tasks/${folder}`)
  }
  assert.deepEqual(readdirSync(join(dir, 'tasks', 'todo')), ['0001-wallet-endpoint.md'], 'nothing queued was moved')
  assert.equal(readFileSync(queued, 'utf8'), '---\nid: 0001\nrepo: shop-api\n---\n\n# Goal\n', 'or rewritten')

  const again = execFileSync(process.execPath, [cli, 'init', '--product', dir, '--no-agent'], { encoding: 'utf8', env })
  assert.doesNotMatch(again, /^created tasks\//m, 'a folder that is already there is left alone, and not announced')
  for (const said of [out, again]) {
    assert.doesNotMatch(said, /git repository|tracks no remote/, 'the queue at the default location is asked nothing and says nothing')
  }

  const fresh = shop()
  execFileSync(process.execPath, [cli, 'init', '--product', fresh, '--no-agent'], { encoding: 'utf8', env })
  assert.deepEqual(readdirSync(join(fresh, 'tasks')).sort(), ['done', 'failed', 'hold', 'todo'])
})

test('detent init in a folder with no repositories says what a product is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detent-empty-'))
  let error
  try {
    execFileSync(process.execPath, [cli, 'init', '--product', dir], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    error = e
  }
  assert.equal(error.status, 1)
  assert.match(error.stderr, /no git repository directly inside/)
  assert.ok(!existsSync(join(dir, '.detent')))
  assert.ok(!existsSync(join(dir, 'tasks')), 'a folder that is not a product gets no queue either')
})

test('a configured queue: init creates it there, and the folder it lives in is no repository of the product', () => {
  const dir = shop()
  // A queue of its own, in a repository a session writes and pushes (ADR 0012).
  // It sits in the product folder like any other, and is not one.
  repo(dir, 'agent-loop', { files: { 'README.md': '# the queue' } })
  mkdirSync(join(dir, '.detent'))
  writeFileSync(
    join(dir, '.detent', 'product.json'),
    JSON.stringify({
      version: 1,
      product: { name: 'shop' },
      queue: 'agent-loop/tasks',
      models: { implement: { agent: 'claude' } },
      repos: [{ name: 'shop-api', compare: 'dev' }],
    }),
  )
  const env = withAgents(['claude'], (path) => ({ ...process.env, PATH: `${path}:${process.execPath.replace(/\/node$/, '')}` }))

  const out = execFileSync(process.execPath, [cli, 'init', '--product', dir, '--no-agent'], { encoding: 'utf8', env })
  assert.match(out, /^created agent-loop\/tasks\/todo, agent-loop\/tasks\/hold, agent-loop\/tasks\/done, agent-loop\/tasks\/failed — the queue run reads and plan writes into$/m)
  assert.deepEqual(readdirSync(join(dir, 'agent-loop', 'tasks')).sort(), ['done', 'failed', 'hold', 'todo'])
  assert.equal(existsSync(join(dir, 'tasks')), false, 'and nothing where the default would be')

  // The scan proposes the repositories of the product; the queue's folder is
  // not one of them, whatever it is called.
  const proposed = JSON.parse(readFileSync(join(dir, '.detent', 'product.proposed.json'), 'utf8'))
  assert.deepEqual(proposed.repos.map((r) => r.name), ['shop-api', 'shop-docs', 'shop-svc', 'shop-web'])
  assert.equal(proposed.queue, 'agent-loop/tasks', 'and the key a person wrote survives the proposal')
  assert.deepEqual(scanProduct(dir, { queue: 'agent-loop/tasks' }).repos.map((r) => r.name), ['shop-api', 'shop-docs', 'shop-svc', 'shop-web'])
  assert.ok(scanProduct(dir).repos.some((r) => r.name === 'agent-loop'), 'a product that says nothing has no reason to skip it')
})

// A queue somewhere other than the default was configured so that two machines
// could share it (ADR 0012). Four folders are not that, and the command that
// creates them is where the person is told which of the two they have.
test('a queue created where nothing can commit it says so, and says a different thing when only the remote is missing', () => {
  const configured = (dir, queue) => {
    mkdirSync(join(dir, '.detent'))
    writeFileSync(
      join(dir, '.detent', 'product.json'),
      JSON.stringify({ version: 1, product: { name: 'shop' }, queue, models: { implement: { agent: 'claude' } }, repos: [{ name: 'shop-api', compare: 'dev' }] }),
    )
  }
  const init = (dir) => withAgents(['claude'], (path) => execFileSync(process.execPath, [cli, 'init', '--product', dir, '--no-agent'], { encoding: 'utf8', env: { ...process.env, PATH: path } }))

  // The queue's repository, configured and never cloned: init creates a plain
  // directory there, as it always has, and now says what it is not.
  const plain = shop()
  configured(plain, 'agent-loop/tasks')
  const out = init(plain)
  assert.match(out, /^created agent-loop\/tasks\/todo, .+ — the queue run reads and plan writes into$/m)
  assert.match(
    out,
    /^agent-loop\/tasks is not in a git repository — the queue stays on this machine: a task's move is a file move, with nothing to commit it to and nothing to push, so no other machine ever reads what this one did$/m,
  )
  assert.equal(existsSync(join(plain, 'agent-loop', '.git')), false, 'and init cloned nothing, created no repository and added no remote')

  // Said again when there are no folders left to create: it is true either way,
  // and a re-run is how a person asks.
  const again = init(plain)
  assert.doesNotMatch(again, /^created agent-loop/m)
  assert.match(again, /^agent-loop\/tasks is not in a git repository/m)

  // The queue in a repository of its own that pushes nowhere: a different
  // sentence, because nothing is wrong with it.
  const local = shop()
  repo(local, 'agent-loop', { files: { 'README.md': '# the queue' } })
  configured(local, 'agent-loop/tasks')
  const second = init(local)
  assert.match(
    second,
    /^agent-loop\/tasks is in a repository whose branch tracks no remote — a task's move is committed there and pushed nowhere: nothing is wrong, and nothing leaves this machine either$/m,
  )
  assert.doesNotMatch(second, /is not in a git repository/, 'which of the two it is, and not both')
})

// A `.gitignore` for the one file detent creates that must never be committed
// (ADR 0025). There was none at all before this, which is the whole reason a
// token in `product.json` was the wrong place for one.
test('detent init writes the .gitignore that keeps a channel\'s secret out of a commit', () => {
  const dir = shop()
  const env = withAgents(['claude'], (path) => ({ ...process.env, PATH: `${path}:${process.execPath.replace(/\/node$/, '')}` }))

  const out = execFileSync(process.execPath, [cli, 'init', '--product', dir, '--no-agent'], { encoding: 'utf8', env })
  assert.match(out, /^wrote \.detent\/\.gitignore — \.detent\/secrets\.json is where a notification channel's token goes if you type it on the dashboard, and it is never committed$/m)

  const ignore = join(dir, '.detent', '.gitignore')
  assert.match(readFileSync(ignore, 'utf8'), /^secrets\.json$/m)
  // It goes inside `.detent/`, the folder detent owns, so a `.gitignore` a
  // person wrote at the product root is left exactly as they wrote it.
  assert.equal(existsSync(join(dir, '.gitignore')), false)

  // And git agrees, which is the only opinion that matters here.
  sh(dir, 'init', '--quiet')
  writeFileSync(join(dir, '.detent', 'secrets.json'), '{}\n')
  assert.equal(execFileSync('git', ['-C', dir, 'check-ignore', '.detent/secrets.json'], { encoding: 'utf8' }).trim(), '.detent/secrets.json')

  // Written once: a re-run neither duplicates the rule nor announces it again.
  const again = execFileSync(process.execPath, [cli, 'init', '--product', dir, '--no-agent'], { encoding: 'utf8', env })
  assert.doesNotMatch(again, /\.gitignore/)
  assert.equal(readFileSync(ignore, 'utf8').match(/^secrets\.json$/gm).length, 1)
})
