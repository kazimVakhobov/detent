import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '../core/commands/dashboard.mjs'
import { EDITABLE, NOT_EDITABLE, readConfiguration } from '../core/configure.mjs'
import { PAGE } from '../core/dashboard-page.mjs'
import { appendJournal } from '../core/journal.mjs'
import { snapshotRefs } from '../core/git.mjs'
import { PRODUCT_FILE, loadProduct } from '../core/product.mjs'
import { snapshot } from '../core/snapshot.mjs'
import { claim } from '../core/state.mjs'
import { gitProduct, sh } from './support/product.mjs'

function setup() {
  const s = gitProduct({ gauge: { exit: [{ stage: 'test', command: 'true' }] }, models: { implement: { agent: 'claude' }, accept: { agent: 'codex' } } })
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
})

test('the server: 127.0.0.1 only, GET only, the page and its state', async () => {
  const s = setup()
  const server = await serve(s.product, { port: 0 })
  try {
    const { address, port } = server.address()
    assert.equal(address, '127.0.0.1')
    const base = `http://127.0.0.1:${port}`

    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
    assert.match(await page.text(), /<title>detent<\/title>/)

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
  assert.match(PAGE, /s\.product\.queue \+ '\/todo\/ is empty'/, 'and the page says where the empty one is from it')
  assert.doesNotMatch(PAGE, /'tasks\//, 'never from a literal')
})

// ——— The one write: the configuration, between runs (ADR 0015).

// A product whose file already says more than the page may change, so what
// survives a write is visible: `docs`, a gauge, a repository's `compare`.
function configured() {
  return gitProduct(
    { gauge: { exit: [{ stage: 'test', command: 'true' }] }, models: { implement: { agent: 'claude' } } },
    { docs: 'acme-api', attempts: 5, models: { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'codex' } } },
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
      models: { implement: { agent: 'gemini', model: 'gemini-3-pro' }, accept: { agent: 'codex' } },
      attempts: 2,
      timeout: 45,
      concurrency: 1,
      notify: 'say done',
      repos: [{ name: 'acme-api', models: { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: null } }],
    })
    assert.equal(response.status, 200)
    assert.equal(result.written, true)

    const { configuration } = result
    assert.deepEqual(configuration.models.implement, { agent: 'gemini', model: 'gemini-3-pro' })
    assert.deepEqual(configuration.attempts, { value: 2, effective: 2 })
    assert.deepEqual(configuration.timeout, { value: 45, effective: 45 })
    assert.deepEqual(configuration.notify, { value: 'say done', effective: 'say done' })
    // A cleared role is the key gone, and the page is told whose it is now.
    assert.equal(configuration.repos[0].models.accept, null)
    assert.deepEqual(configuration.repos[0].inherited.accept, { agent: 'codex' })
    assert.deepEqual(readConfiguration(s.dir), configuration, 'the same as reading the file again')

    const text = readFileSync(file(s), 'utf8')
    const raw = JSON.parse(text)
    assert.deepEqual(raw.models.implement, { agent: 'gemini', model: 'gemini-3-pro' })
    assert.equal(raw.repos[0].models.accept, undefined)
    assert.equal(raw.timeout, 45)
    assert.equal(text, `${JSON.stringify(raw, null, 2)}\n`, 'the shape init writes it in')

    // The validator is the same code, so a written file is one a run can load.
    const product = loadProduct(s.dir)
    assert.equal(product.attempts, 2)
    assert.deepEqual(product.repos[0].models, { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'codex' } })
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
  // And the inputs it builds are the allowed ones and no others.
  const offered = [...PAGE.matchAll(/^ {2}\['(\w+)', '/gm)].map((m) => m[1])
  assert.deepEqual(offered, ['attempts', 'timeout', 'concurrency', 'notify'])
})

test('the page disables its inputs while a run is active, and never polls for the configuration', () => {
  assert.match(PAGE, /node\.disabled = active/)
  assert.match(PAGE, /A run is active — /)
  // The configuration is fetched once and again after a write. A form whose
  // values moved under the person filling it in would be a third state
  // between what the file says and what the page shows (ADR 0015).
  assert.deepEqual([...PAGE.matchAll(/setInterval\((\w+)/g)].map((m) => m[1]), ['refresh'])
})
