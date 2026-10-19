import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '../core/commands/dashboard.mjs'
import { EDITABLE, NOT_EDITABLE, readConfiguration } from '../core/configure.mjs'
import { PAGE, POLL, SCRIPT } from '../core/dashboard-page.mjs'
import { LIMITS } from '../core/dashboard/configuration.mjs'
import { SECTIONS, SECTION_IDS, sectionFor } from '../core/dashboard/sections.mjs'
import { warnings } from '../core/dashboard/warnings.mjs'
import { appendJournal } from '../core/journal.mjs'
import { snapshotRefs } from '../core/git.mjs'
import { PRODUCT_FILE, loadProduct } from '../core/product.mjs'
import { snapshot } from '../core/snapshot.mjs'
import { FOLDERS } from '../core/task.mjs'
import { claim } from '../core/state.mjs'
import { gitProduct, sh } from './support/product.mjs'

function setup() {
  const s = gitProduct({ gauge: { exit: [{ stage: 'test', command: 'true' }] }, models: { implement: { agent: 'claude' }, accept: { agent: 'claude', model: 'claude-sonnet-5' } } })
  for (const folder of ['todo', 'hold']) mkdirSync(join(s.dir, 'tasks', folder), { recursive: true })
  writeFileSync(join(s.dir, 'tasks', 'todo', '0003-next.md'), '---\nid: 0003\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n')
  writeFileSync(join(s.dir, 'tasks', 'hold', '0002-float.md'), '---\nid: 0002\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n')
  const line = (o) => ({ kind: 'task', repo: 'acme-api', attempts: 1, lock: 'enforced', models: { implement: { agent: 'claude', requested: null, actual: 'claude-opus-5' } }, cost: { usd: 0.1, tokens: null }, acceptance: { verdict: 'accepted', doubts: [] }, ...o })
  appendJournal(s.dir, line({ task: '0001', slug: 'first', outcome: 'passed', finished: '2026-10-06T10:00:00Z' }))
  appendJournal(s.dir, line({ task: '0002', slug: 'float', outcome: 'rejected', reason: 'the acceptance pass raised a doubt: add rounds', branch: 'agent/task-0002-float', acceptance: { verdict: 'rejected', doubts: ['add rounds'] }, finished: '2026-10-06T11:00:00Z' }))
  return s
}

test('the snapshot: numbers from the journal, the queue, and why a paused task is paused', () => {
  const s = setup()
  const snap = snapshot(s.product)
  assert.equal(snap.running, false)
  assert.equal(snap.numbers.all.runs, 2)
  assert.equal(snap.numbers.all.passed, 1)
  assert.deepEqual(snap.numbers.blindSpot, { read: 2, rejected: 1 })
  assert.deepEqual(snap.queue.todo.map((t) => t.id), ['0003'])
  const [held] = snap.queue.hold
  assert.equal(held.outcome, 'rejected')
  assert.deepEqual(held.doubts, ['add rounds'])
  assert.equal(held.branch, 'agent/task-0002-float')
  assert.equal(held.repo, 'acme-api')
  assert.deepEqual(snap.recent.map((r) => r.task), ['0002', '0001'], 'newest first')
})

test('agent/dev against compare: identical, behind, tasks ahead — reported, never acted on', () => {
  const s = setup()
  assert.deepEqual(snapshot(s.product).repos[0].divergence, { ahead: 0, behind: 0, tasksAhead: 0 })

  // A person's work on dev that agent/dev does not have yet.
  sh(s.repoDir, 'switch', '--quiet', 'dev')
  writeFileSync(join(s.repoDir, 'human.txt'), 'x\n')
  sh(s.repoDir, 'add', '.')
  sh(s.repoDir, 'commit', '--quiet', '-m', 'human')
  // And a task that landed on agent/dev.
  sh(s.repoDir, 'switch', '--quiet', '-c', 'agent/task-0001-first', 'agent/dev')
  writeFileSync(join(s.repoDir, 'agent.txt'), 'y\n')
  sh(s.repoDir, 'add', '.')
  sh(s.repoDir, 'commit', '--quiet', '-m', 'work')
  sh(s.repoDir, 'switch', '--quiet', 'agent/dev')
  sh(s.repoDir, 'merge', '--quiet', '--no-ff', '-m', 'merge: task 0001\n\nTask: 0001', 'agent/task-0001-first')

  const before = snapshotRefs(s.repoDir)
  const repo = snapshot(s.product).repos[0]
  assert.deepEqual(repo.divergence, { ahead: 2, behind: 1, tasksAhead: 1 })
  assert.equal(repo.lock, 'enforced')
  assert.deepEqual(snapshotRefs(s.repoDir), before, 'reading moved nothing')
})

test('a missing agent/dev is shown as missing', () => {
  const s = setup()
  sh(s.repoDir, 'branch', '-D', 'agent/dev')
  assert.equal(snapshot(s.product).repos[0].integration, null)
})

test('the page loads nothing from outside and sets every value as text', () => {
  assert.doesNotMatch(PAGE, /(src|href)=["']?https?:/i)
  assert.doesNotMatch(PAGE, /@import|url\(/)
  assert.doesNotMatch(PAGE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  // Several modules compose it, and what they compose is still one document:
  // one stylesheet and one script, both inline, and nothing to fetch after it
  // (ADR 0020 part 4). Splitting the source is not splitting the artifact.
  assert.deepEqual([...PAGE.matchAll(/<(html|style|script|main|footer)\b/g)].map((m) => m[1]).sort(),
    ['footer', 'html', 'main', 'script', 'style'])
  assert.doesNotMatch(PAGE, /<script[^>]+src/)
  assert.doesNotMatch(PAGE, /<link\b/)
})

// Which block lives in which section: the id the page renders each one into,
// and the section it has to be inside. Every block the page draws is here, and
// the test below is that each is in exactly one section and that nothing the
// page draws is missing from the list.
const BLOCKS = {
  overview: ['figures'],
  repositories: ['repos', 'by-repo'],
  queue: ['todo', 'hold', 'done', 'failed'],
  agents: ['by-model'],
  runs: ['recent'],
  configuration: ['config', 'fixed'],
}

// What the served document says is in each section: everything between its
// opening tag and the next closing one.
function sectionOf(id) {
  const open = PAGE.indexOf(`<section id="${id}"`)
  assert.notEqual(open, -1, `${id} is not a section of the page`)
  const close = PAGE.indexOf('</section>', open)
  return PAGE.slice(open, close)
}

test('the page is sections: the nav, one block in exactly one of them, and nothing drawn that is nowhere', () => {
  assert.deepEqual(Object.keys(BLOCKS), SECTION_IDS, 'every section has its blocks listed')
  for (const section of SECTIONS) {
    assert.ok(PAGE.includes(`<a href="#${section.id}">${section.nav}</a>`), `${section.id} has no link in the nav`)
  }

  for (const [id, blocks] of Object.entries(BLOCKS)) {
    for (const block of blocks) {
      const inside = SECTION_IDS.filter((s) => sectionOf(s).includes(`id="${block}"`))
      assert.deepEqual(inside, [id], `${block} should be in ${id} and in nothing else`)
    }
  }

  // Nothing the page renders into is outside the sections, and no two things
  // share an id — a mistake the split invites and a single literal could not
  // make, because every module now writes markup of its own.
  const drawn = Object.values(BLOCKS).flat()
  for (const [, id] of PAGE.matchAll(/<table id="([\w-]+)"/g)) {
    assert.ok(drawn.includes(id), `the page draws a table into ${id}, which no section claims`)
  }
  const ids = [...PAGE.matchAll(/id="([\w-]+)"/g)].map((m) => m[1])
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'two elements with one id')
  for (const [, id] of SCRIPT.matchAll(/getElementById\('([\w-]+)'\)/g)) {
    assert.ok(ids.includes(id), `the script reads #${id}, which the document has not got`)
  }
})

test('the fragment names the section, an unknown one still lands somewhere, and neither is rewritten', () => {
  // The function the page runs, called here: it is serialised into the script.
  assert.ok(SCRIPT.includes(String(sectionFor)), 'the page runs some other copy of it')

  for (const id of SECTION_IDS) assert.equal(sectionFor(`#${id}`, SECTION_IDS), id)
  // Absent, empty, or a name this page has not got: the first section, which is
  // a section rather than nothing.
  for (const hash of [undefined, '', '#', '#nope', '#configuration/0003']) {
    assert.equal(sectionFor(hash, SECTION_IDS), 'overview', JSON.stringify(hash))
  }
  // And what somebody typed stays as they typed it: a page that corrects the
  // address bar loses the one thing the fragment was for.
  assert.doesNotMatch(SCRIPT, /location\.hash\s*=|location\.replace|(?:replace|push)State/)
  // Changing section is an attribute on markup already served.
  assert.doesNotMatch(SCRIPT, /addEventListener\('hashchange', (?!showSection)/)
  assert.deepEqual([...SCRIPT.matchAll(/fetch\('([\w.]+)'/g)].map((m) => m[1]).sort(),
    ['configuration.json', 'configuration.json', 'state.json'], 'nothing is fetched to change section')
})

test('the server: 127.0.0.1 only, GET only, the page and its state', async () => {
  const s = setup()
  const server = await serve(s.product, { port: 0 })
  try {
    const { address, port } = server.address()
    assert.equal(address, '127.0.0.1')
    const base = `http://127.0.0.1:${port}`

    // One document, with every section in it — the modules are the source and
    // not the artifact, so the policy is the one 0015 wrote (ADR 0020 part 4).
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('content-security-policy'),
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'")
    const served = await page.text()
    assert.match(served, /<title>detent<\/title>/)
    assert.equal(served, PAGE, 'what is composed is what is served, in one request')
    for (const [id, blocks] of Object.entries(BLOCKS)) {
      assert.ok(served.includes(`<section id="${id}"`), id)
      for (const block of blocks) assert.ok(served.includes(`id="${block}"`), `${id}: ${block}`)
    }

    const state = await fetch(`${base}/state.json`)
    assert.equal(state.status, 200)
    assert.equal((await state.json()).product.name, 'acme')

    const head = await fetch(`${base}/`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')

    const configuration = await fetch(`${base}/configuration.json`)
    assert.equal(configuration.status, 200)
    assert.equal((await configuration.json()).file, PRODUCT_FILE)

    // Anything that is neither GET, HEAD nor the one write.
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await fetch(`${base}/state.json`, { method })
      assert.equal(response.status, 405, method)
      assert.equal(response.headers.get('allow'), 'GET, HEAD')
    }
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const response = await fetch(`${base}/configuration.json`, { method })
      assert.equal(response.status, 405, method)
      assert.equal(response.headers.get('allow'), 'GET, HEAD, POST')
    }
    assert.equal((await fetch(`${base}/nope`)).status, 404)
  } finally {
    server.close()
  }
})

test('the snapshot carries the queue, so the page never names a folder this product has not got', () => {
  const s = gitProduct({}, { queue: 'agent-loop/tasks' })
  mkdirSync(join(s.dir, 'agent-loop', 'tasks', 'todo'), { recursive: true })
  writeFileSync(join(s.dir, 'agent-loop', 'tasks', 'todo', '0003-next.md'), '---\nid: 0003\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n')
  const snap = snapshot(s.product)
  assert.equal(snap.product.queue, 'agent-loop/tasks')
  assert.deepEqual(snap.queue.todo.map((t) => t.id), ['0003'])
  assert.doesNotMatch(PAGE, /['"]tasks\//, 'never from a literal')
  // Wherever the page writes a folder, it writes the queue the snapshot
  // carries first: there is no other way for a folder name to reach the screen.
  for (const folder of FOLDERS) {
    for (const [, before] of PAGE.matchAll(new RegExp(String.raw`(.{0,24})'/${folder}/`, 'g'))) {
      assert.match(before, /s\.product\.queue \+ $/, folder)
    }
  }
})

test('all four folders are shown, and the per-repository numbers that were computed and drawn nowhere', () => {
  const s = setup()
  for (const folder of ['done', 'failed']) mkdirSync(join(s.dir, 'tasks', folder), { recursive: true })
  writeFileSync(join(s.dir, 'tasks', 'done', '0001-first.md'), '---\nid: 0001\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n')
  writeFileSync(join(s.dir, 'tasks', 'failed', '0004-gone.md'), '---\nid: 0004\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n')

  const snap = snapshot(s.product)
  assert.deepEqual(Object.keys(snap.queue), [...FOLDERS], 'the snapshot reads all four')
  assert.deepEqual(snap.queue.done.map((t) => t.id), ['0001'])
  assert.equal(snap.queue.done[0].outcome, 'passed', 'and what the journal says became of it')
  assert.deepEqual(snap.queue.failed.map((t) => t.id), ['0004'])
  assert.deepEqual(snap.numbers.byRepo.map((r) => [r.name, r.runs]), [['acme-api', 2]])

  // Each of the four has a table of its own in the queue section, and the
  // numbers by repository have one beside the repositories.
  for (const folder of FOLDERS) {
    assert.ok(sectionOf('queue').includes(`<table id="${folder}">`), folder)
  }
  assert.ok(sectionOf('repositories').includes('<table id="by-repo">'))
  assert.match(SCRIPT, /numbersFor\('by-repo', 'Repository', n\.byRepo\)/)
  for (const folder of FOLDERS) assert.match(SCRIPT, new RegExp(String.raw`s\.queue\.${folder}\.map`), folder)
})

test('what is wrong is reachable from every section: a gone run, a paused task, a queue that will not parse', () => {
  const s = setup()
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  const state = JSON.parse(readFileSync(join(s.dir, '.detent', 'state.json'), 'utf8'))
  state.repos['acme-api'].pid = 2 ** 22 + 12345 // no such process
  writeFileSync(join(s.dir, '.detent', 'state.json'), JSON.stringify(state))

  // The warnings the page draws, from the snapshot it already reads — the same
  // function the page runs, which is serialised into its script.
  assert.ok(SCRIPT.includes(String(warnings)), 'the page runs some other copy of it')
  const shown = warnings(snapshot(s.product))
  assert.match(shown[0].text, /the run on acme-api is gone — task 0003, attempt 0\. .*detent recover/)
  assert.equal(shown[0].section, 'repositories')
  assert.match(shown[1].text, /one task is paused, waiting for you/)
  assert.equal(shown[1].section, 'queue')
  for (const warning of shown) assert.ok(warning.icon && warning.level, 'an icon and a word, never a colour alone')

  // A queue that will not parse is shown as that, and not as an empty queue.
  writeFileSync(join(s.dir, 'tasks', 'todo', 'nope.md'), 'not a task file name\n')
  const broken = snapshot(s.product)
  assert.deepEqual(broken.queue.todo, [], 'nothing could be read')
  const parse = warnings(broken).filter((w) => w.text.startsWith('the queue will not parse'))
  assert.equal(parse.length, 1)
  assert.match(parse[0].text, /not a task file name/)

  // And none of it is inside a section, so no section can hide it: it is drawn
  // once, above all of them, on every read (ADR 0020's first consequence).
  const outside = SECTION_IDS.reduce((text, id) => text.replace(sectionOf(id), ''), PAGE)
  assert.ok(outside.includes('<div class="alerts" id="alerts">'), 'the strip is inside a section')
  assert.match(SCRIPT, /renderWarnings\(s\)/)
})

// ——— The one write: the configuration, between runs (ADR 0015).

// A product whose file already says more than the page may change, so what
// survives a write is visible: `docs`, a gauge, a repository's `compare`.
function configured() {
  return gitProduct(
    { gauge: { exit: [{ stage: 'test', command: 'true' }] }, models: { implement: { agent: 'claude' } } },
    { docs: 'acme-api', attempts: 5, models: { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'claude', model: 'claude-sonnet-5' } } },
  )
}

const file = (s) => join(s.dir, PRODUCT_FILE)

// The page's own write, as the browser sends it: `origin` naming this server
// and a JSON content-type, which is exactly what a cross-site form cannot do.
async function write(base, patch, headers = {}) {
  const response = await fetch(`${base}/configuration.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify(patch),
  })
  return { response, result: await response.json() }
}

async function dashboard(s, body) {
  const server = await serve(s.product, { port: 0 })
  try {
    return await body(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.close()
  }
}

test('a write is applied, and what comes back is read off the file rather than assumed', async () => {
  const s = configured()
  await dashboard(s, async (base) => {
    const { response, result } = await write(base, {
      models: { implement: { agent: 'claude', model: 'claude-sonnet-5' }, accept: { agent: 'claude' } },
      attempts: 2,
      timeout: 45,
      concurrency: 1,
      notify: 'say done',
      repos: [{ name: 'acme-api', models: { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: null } }],
    })
    assert.equal(response.status, 200)
    assert.equal(result.written, true)

    const { configuration } = result
    assert.deepEqual(configuration.models.implement, { agent: 'claude', model: 'claude-sonnet-5' })
    assert.deepEqual(configuration.attempts, { value: 2, effective: 2 })
    assert.deepEqual(configuration.timeout, { value: 45, effective: 45 })
    assert.deepEqual(configuration.notify, { value: 'say done', effective: 'say done' })
    // A cleared role is the key gone, and the page is told whose it is now.
    assert.equal(configuration.repos[0].models.accept, null)
    assert.deepEqual(configuration.repos[0].inherited.accept, { agent: 'claude' })
    assert.deepEqual(readConfiguration(s.dir), configuration, 'the same as reading the file again')

    const text = readFileSync(file(s), 'utf8')
    const raw = JSON.parse(text)
    assert.deepEqual(raw.models.implement, { agent: 'claude', model: 'claude-sonnet-5' })
    assert.equal(raw.repos[0].models.accept, undefined)
    assert.equal(raw.timeout, 45)
    assert.equal(text, `${JSON.stringify(raw, null, 2)}\n`, 'the shape init writes it in')

    // The validator is the same code, so a written file is one a run can load.
    const product = loadProduct(s.dir)
    assert.equal(product.attempts, 2)
    assert.deepEqual(product.repos[0].models, { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'claude' } })
  })
})

test('a write is refused while a run is active, by the server and not only by the disabled inputs', async () => {
  const s = configured()
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  const before = readFileSync(file(s), 'utf8')
  await dashboard(s, async (base) => {
    const { response, result } = await write(base, { attempts: 9 })
    assert.equal(response.status, 409)
    assert.equal(result.refused, 'running')
    assert.match(result.message, /a run is active/)
    // And what it is working on, from the same state.json recover reads.
    assert.match(result.message, /acme-api on task 0003, attempt 0/)
    assert.deepEqual(result.active.map((a) => [a.repo, a.task, a.attempt]), [['acme-api', '0003', 0]])
    assert.equal(readFileSync(file(s), 'utf8'), before, 'nothing was written')
  })
})

test('a write goes through validateProduct whole: every problem at once, each naming its path', async () => {
  const s = configured()
  const before = readFileSync(file(s), 'utf8')
  await dashboard(s, async (base) => {
    const { response, result } = await write(base, {
      attempts: 0,
      timeout: 'soon',
      concurrency: 7,
      models: { implement: { agent: 'nobody' } },
    })
    assert.equal(response.status, 422)
    assert.equal(result.refused, 'validation')
    const paths = result.problems.map((p) => p.split(':')[0]).sort()
    assert.deepEqual(paths, ['attempts', 'concurrency', 'models.implement.agent', 'timeout'])
    assert.equal(readFileSync(file(s), 'utf8'), before, 'nothing written if any of them fails')
  })
})

test('what a page cannot create, it cannot write: repos, queue, docs and branches are refused by path', async () => {
  const s = configured()
  await dashboard(s, async (base) => {
    const { response, result } = await write(base, {
      queue: 'elsewhere',
      docs: 'acme-api',
      branches: { integration: 'agent/other' },
      repos: [{ name: 'acme-api', compare: 'main' }, { name: 'invented', models: {} }],
    })
    assert.equal(response.status, 422)
    for (const problem of ['queue:', 'docs:', 'branches:', 'repos[0].compare:', 'repos[1].name:']) {
      assert.ok(result.problems.some((p) => p.startsWith(problem)), `${problem} ${JSON.stringify(result.problems)}`)
    }
    assert.match(result.problems.find((p) => p.startsWith('queue:')), /not editable here/)
    assert.match(result.problems.find((p) => p.startsWith('repos[1].name:')), /a page cannot add one/)
  })
})

test('a request from any origin but the page own is refused, whatever it asks for', async () => {
  const s = configured()
  const before = readFileSync(file(s), 'utf8')
  await dashboard(s, async (base) => {
    const refusals = [
      // A form on another site: the browser announces where it came from.
      ['another site', { origin: 'https://example.com' }],
      // And a form is the only cross-site request that needs no preflight,
      // which it cannot make while a JSON content-type is required.
      ['a form content-type', { 'content-type': 'text/plain' }],
    ]
    for (const [what, headers] of refusals) {
      const { response, result } = await write(base, { attempts: 2 }, headers)
      assert.equal(response.status, 403, what)
      assert.equal(result.refused, 'origin', what)
    }
    // No origin at all is not a pass: it is the one thing a page always sends.
    const bare = await fetch(`${base}/configuration.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"attempts":2}',
    })
    assert.equal(bare.status, 403)
    assert.equal(readFileSync(file(s), 'utf8'), before, 'nothing was written')
  })
})

test('the keys the page does not touch keep their values and their order', async () => {
  const s = configured()
  const before = JSON.parse(readFileSync(file(s), 'utf8'))
  await dashboard(s, async (base) => {
    const { response } = await write(base, { attempts: 2, timeout: 10 })
    assert.equal(response.status, 200)
  })
  const after = JSON.parse(readFileSync(file(s), 'utf8'))
  assert.equal(after.docs, 'acme-api', 'an untouched key survives')
  assert.equal(after.version, 1)
  assert.deepEqual(after.product, before.product)
  assert.deepEqual(after.models, before.models, 'models was not in the patch')
  assert.deepEqual(after.repos[0].gauge, before.repos[0].gauge)
  assert.equal(after.repos[0].compare, 'dev')
  assert.deepEqual(
    Object.keys(after).slice(0, Object.keys(before).length),
    Object.keys(before),
    'the keys that were there are still in the order they were in',
  )
  assert.deepEqual(Object.keys(after.repos[0]), Object.keys(before.repos[0]))
  assert.deepEqual(Object.keys(after).slice(Object.keys(before).length), ['timeout'], 'a new key is appended')
})

test('the page offers what ADR 0015 allows, and says why the rest is not editable there', () => {
  assert.deepEqual([...EDITABLE], ['models', 'attempts', 'timeout', 'concurrency', 'notify'])
  assert.deepEqual(Object.keys(NOT_EDITABLE), ['repos', 'queue', 'docs', 'branches'])

  const configuration = readConfiguration(configured().dir)
  assert.deepEqual(configuration.notEditable.map((k) => k.key), ['repos', 'queue', 'docs', 'branches'])
  for (const { key, shown, why } of configuration.notEditable) {
    assert.ok(shown.length > 0, key)
    assert.ok(why.length > 20, `${key} is disabled without saying why`)
  }
  // The page renders the reason beside the value, rather than only greying it.
  assert.match(PAGE, /Not editable here, because/)
  assert.match(PAGE, /k\.why/)
  // And the inputs it builds are the allowed ones and no others. The keys are
  // the module's own data rather than lines of its source: `models` is the
  // fields above them, and these are the rest of EDITABLE in the order drawn.
  assert.deepEqual(LIMITS.map(([key]) => key), [...EDITABLE].filter((key) => key !== 'models'))
  assert.deepEqual(LIMITS.map(([key]) => key), ['attempts', 'timeout', 'concurrency', 'notify'])
  for (const [key, label, attrs] of LIMITS) {
    assert.match(label, new RegExp(`^${key} — `), `${key} is offered without saying what it is`)
    assert.ok(attrs.type === 'number' || attrs.type === 'text', key)
  }
  // And every one of them reaches the document, which is the half the data
  // cannot promise on its own.
  for (const [, label] of LIMITS) assert.ok(PAGE.includes(label), label)
})

test('the page disables its inputs while a run is active, and has one timer, which reads the state', () => {
  assert.match(PAGE, /node\.disabled = active/)
  assert.match(PAGE, /A run is active — /)
  // The configuration is fetched once and again after a write, never polled: a
  // form whose values moved under the person filling it in would be a third
  // state between what the file says and what the page shows (ADR 0015). So
  // the page has one timer, and what it calls is the snapshot's own refresh.
  assert.deepEqual(POLL, { call: 'refresh', every: 3000 })
  assert.equal([...PAGE.matchAll(/setInterval|setTimeout|requestAnimationFrame/g)].length, 1, 'one timer')
  assert.ok(PAGE.includes(`setInterval(${POLL.call}, ${POLL.every})`))
  assert.match(SCRIPT, new RegExp(String.raw`async function ${POLL.call}\(\) \{[^}]*fetch\('state\.json'`))
})
