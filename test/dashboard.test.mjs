import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '../core/commands/dashboard.mjs'
import { EDITABLE, NOT_EDITABLE, readConfiguration } from '../core/configure.mjs'
import { PAGE, POLL, SCRIPT } from '../core/dashboard-page.mjs'
import { LIMITS } from '../core/dashboard/configuration.mjs'
import { LOG_CLIP, LOG_LINES, LOG_QUIET } from '../core/dashboard/log.mjs'
import { SECTIONS, SECTION_IDS, TASK_SECTION, sectionFor, taskFor } from '../core/dashboard/sections.mjs'
import { warnings } from '../core/dashboard/warnings.mjs'
import { appendJournal } from '../core/journal.mjs'
import { snapshotRefs } from '../core/git.mjs'
import { openAttemptLog } from '../core/log.mjs'
import { PRODUCT_FILE, loadProduct } from '../core/product.mjs'
import { snapshot } from '../core/snapshot.mjs'
import { FOLDERS } from '../core/task.mjs'
import { claim, setAttempt } from '../core/state.mjs'
import { openPage } from './support/page.mjs'
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
  task: ['task-detail', 'task-log-panel', 'task-log-state', 'task-log'],
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
  // a section rather than nothing. A number after a section that takes none is
  // not that section either — only the detail answers to the longer shape.
  for (const hash of [undefined, '', '#', '#nope', '#configuration/0003']) {
    assert.equal(sectionFor(hash, SECTION_IDS), 'overview', JSON.stringify(hash))
  }
  // And what somebody typed stays as they typed it: a page that corrects the
  // address bar loses the one thing the fragment was for.
  assert.doesNotMatch(SCRIPT, /location\.hash\s*=|location\.replace|(?:replace|push)State/)
  // Changing section is an attribute on markup already served.
  assert.doesNotMatch(SCRIPT, /addEventListener\('hashchange', (?!showSection)/)
  // Nothing is fetched to change section, with two exceptions the fragment
  // itself names: the task, which is not in the snapshot (ADR 0020 part 3),
  // and what its agent is saying, which is not in it either (ADR 0021).
  assert.deepEqual([...SCRIPT.matchAll(/fetch\('([\w.?=]+)/g)].map((m) => m[1]).sort(),
    ['configuration.json', 'configuration.json', 'log.json?task=', 'state.json', 'task.json?task='])
})

test('the fragment carries the task number, and a fragment that names none still lands on the section', () => {
  // Both functions the page runs, called here: they are serialised into it.
  assert.ok(SCRIPT.includes(String(sectionFor)) && SCRIPT.includes(String(taskFor)), 'the page runs some other copy of them')
  assert.ok(SECTION_IDS.includes(TASK_SECTION), 'the detail is a section')

  // A link to one task: the section, and the number after it.
  assert.equal(sectionFor(`#${TASK_SECTION}/0042`, SECTION_IDS), TASK_SECTION)
  assert.equal(taskFor(`#${TASK_SECTION}/0042`), '0042')
  assert.equal(taskFor(`${TASK_SECTION}/7`), '7', 'with or without the #')

  // The section named with no number, or with something that is not digits:
  // still the detail section rather than nothing, and it opens no task. The
  // number never becomes a path, here either.
  for (const hash of [`#${TASK_SECTION}`, `#${TASK_SECTION}/`, `#${TASK_SECTION}/nope`, `#${TASK_SECTION}/../0001`, `#${TASK_SECTION}/0001/x`]) {
    assert.equal(sectionFor(hash, SECTION_IDS), TASK_SECTION, hash)
    if (hash !== `#${TASK_SECTION}`) assert.equal(taskFor(hash), null, hash)
  }
  assert.equal(taskFor(`#${TASK_SECTION}`), null)
  assert.equal(taskFor('#queue/0001'), null, 'no other section opens a task')

  // Every table that lists a task opens it, and the detail is what the page
  // fetches when one is.
  assert.match(SCRIPT, /const opens = \(id, slug\) => el\('a', \{ href: '#' \+ TASK_SECTION \+ '\/' \+ id \}/)
  for (const table of ['todo', 'done']) assert.match(SCRIPT, new RegExp(String.raw`s\.queue\.${table}\.map\(\(t\) => \[opens\(t\.id, t\.slug\)`), table)
  for (const table of ['hold', 'failed']) assert.match(SCRIPT, new RegExp(String.raw`s\.queue\.${table}\.map\(\(t\) => \[queued\(t\)`), table)
  assert.match(SCRIPT, /function queued\(t\) \{\n\s*return el\('div', \{\}, el\('strong', \{\}, opens\(t\.id, t\.slug\)\)/)
  assert.match(SCRIPT, /s\.recent\.map\(\(r\) => \[when\(r\.finished\), opens\(r\.task, r\.slug\)/)
  assert.match(SCRIPT, new RegExp(String.raw`if \(current === TASK_SECTION\) \{\n\s*loadTask\(taskFor\(location\.hash\)\)\n\s*refreshLog\(\)\n\s*\}`))

  // And the body is text: nothing renders markdown, and what a task file says
  // only ever reaches a text node (ADR 0020 part 3, ADR 0006).
  assert.doesNotMatch(SCRIPT, /innerHTML|outerHTML|insertAdjacentHTML/)
  assert.match(SCRIPT, /el\('pre', \{ class: 'body' \}, text\)/)
  assert.match(SCRIPT, /el\('pre', \{ class: 'body' \}, d\.unreadable\.text\)/)
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

// ——— One task, opened by its number (ADR 0020 part 3).

// The four folders, each with a task in it: the three `readQueue` never opens,
// and the one it does.
function queued(s) {
  for (const folder of FOLDERS) mkdirSync(join(s.dir, 'tasks', folder), { recursive: true })
  const body = (id) => `---\nid: ${id}\nrepo: acme-api\ntouches_contract: false\n---\n\n# Goal\n\nTask ${id} must work.\n\n`
    + `# Acceptance criteria\n\n- [ ] the first one\n- [ ] the second one\n\n# Out of scope\n\nNothing else in ${id}.\n`
  writeFileSync(join(s.dir, 'tasks', 'done', '0001-first.md'), body('0001'))
  writeFileSync(join(s.dir, 'tasks', 'failed', '0004-gone.md'), body('0004'))
  return s
}

const open = async (base, asked) => {
  const response = await fetch(`${base}/task.json?task=${asked}`)
  return { response, detail: await response.json() }
}

test('a task in each of the four folders opens, with its sections and the journal lines for its number', async () => {
  const s = queued(setup())
  await dashboard(s, async (base) => {
    for (const [asked, folder, slug] of [['0003', 'todo', 'next'], ['0002', 'hold', 'float'], ['0001', 'done', 'first'], ['0004', 'failed', 'gone']]) {
      const { response, detail } = await open(base, asked)
      assert.equal(response.status, 200, asked)
      assert.equal(detail.folder, folder, asked)
      assert.equal(detail.slug, slug, asked)
      assert.equal(detail.where, `tasks/${folder}/${asked}-${slug}.md`, asked)
      assert.equal(detail.frontmatter.repo, 'acme-api', asked)
      assert.equal(detail.unreadable, null, asked)
    }

    // The three folders `readQueue` pushes without opening are read here: the
    // sections of a task that has already run are what a person wants when
    // working out why it stopped.
    const { detail } = await open(base, '0001')
    assert.deepEqual(detail.frontmatter, { id: '0001', repo: 'acme-api', touches_contract: false })
    assert.deepEqual(detail.goal.join('\n').trim(), 'Task 0001 must work.')
    assert.deepEqual(detail.criteria, ['the first one', 'the second one'])
    assert.deepEqual(detail.outOfScope.join('\n').trim(), 'Nothing else in 0001.')

    // The journal lines for that number and no others, with what each attempt
    // cost, what the reviewer said, and whether its links checked.
    assert.deepEqual(detail.history.map((r) => [r.task, r.outcome]), [['0001', 'passed']])
    const paused = (await open(base, '0002')).detail
    assert.deepEqual(paused.history.map((r) => r.task), ['0002'])
    assert.deepEqual(paused.history[0].acceptance, { verdict: 'rejected', doubts: ['add rounds'] })
    assert.equal(paused.history[0].attempts, 1)
    assert.deepEqual(paused.history[0].cost, { usd: 0.1, tokens: null })

    // 0042 and 00042 are one task: the number is compared as a number, which
    // is the rule the queue's own uniqueness check uses.
    assert.equal((await open(base, '00003')).detail.where, 'tasks/todo/0003-next.md')
    assert.equal((await open(base, '3')).detail.where, 'tasks/todo/0003-next.md')
  })
})

test('the journal history is the lines for that number, however many runs a task had', async () => {
  const s = queued(setup())
  const line = (o) => ({ kind: 'task', repo: 'acme-api', attempts: 2, lock: 'enforced', cost: { usd: 0.2, tokens: null }, links: { checked: 2, broken: ['shared-docs/adr/0003.md'] }, acceptance: { verdict: 'accepted', doubts: [] }, ...o })
  appendJournal(s.dir, line({ task: '0001', slug: 'first', outcome: 'error', reason: 'the agent stopped', finished: '2026-10-07T10:00:00Z' }))
  appendJournal(s.dir, line({ task: '0004', slug: 'gone', outcome: 'escalated', finished: '2026-10-07T11:00:00Z' }))

  await dashboard(s, async (base) => {
    const { detail } = await open(base, '0001')
    assert.deepEqual(detail.history.map((r) => r.outcome), ['passed', 'error'], 'both of its runs, in the order they happened')
    assert.deepEqual(detail.history.map((r) => r.task), ['0001', '0001'], 'and nobody else’s')
    assert.deepEqual(detail.history[1].links, { checked: 2, broken: ['shared-docs/adr/0003.md'] }, 'what the run recorded, not a second check')
    assert.deepEqual((await open(base, '0004')).detail.history.map((r) => r.outcome), ['escalated'])
    assert.deepEqual((await open(base, '0003')).detail.history, [], 'a task that has not run')
  })
})

test('a file that will not parse still opens: what it says, and what is wrong with it', async () => {
  const s = queued(setup())
  // In done/, which readQueue never opens, so the queue still reads whole.
  writeFileSync(join(s.dir, 'tasks', 'done', '0005-broken.md'), 'no frontmatter, no criteria, nobody can run it\n')
  await dashboard(s, async (base) => {
    const { response, detail } = await open(base, '0005')
    assert.equal(response.status, 200, 'a task nobody can open is a task nobody can fix')
    assert.equal(detail.folder, 'done')
    assert.equal(detail.frontmatter, null)
    assert.match(detail.unreadable.problems.join(' '), /no frontmatter/)
    assert.equal(detail.unreadable.text, 'no frontmatter, no criteria, nobody can run it\n', 'what the file says')
  })
})

test('a number in no folder is refused as that; a queue that will not read says so instead', async () => {
  const s = queued(setup())
  await dashboard(s, async (base) => {
    const { response, detail } = await open(base, '0099')
    assert.equal(response.status, 404)
    assert.equal(detail.refused, 'unknown')
    assert.match(detail.message, /there is no task 0099 in tasks\/ — it is in none of its four folders/)

    // A number that is not digits never becomes a path: a traversal is a
    // refusal rather than a file, and nothing outside the queue is reachable.
    for (const asked of ['..%2F..%2F..%2Fetc%2Fpasswd', '0003%2F..%2F..%2Fsecret', encodeURIComponent('../../.detent/product.json'), 'nope', '']) {
      const refused = await open(base, asked)
      assert.equal(refused.response.status, 400, asked)
      assert.equal(refused.detail.refused, 'number', asked)
      assert.match(refused.detail.message, /is not a task number/, asked)
      assert.equal(refused.detail.text, undefined, asked)
    }
  })

  // A queue with one unreadable file is no queue at all (§4), and the detail
  // says that rather than pretending the task is missing.
  writeFileSync(join(s.dir, 'tasks', 'todo', 'nope.md'), 'not a task file name\n')
  await dashboard(s, async (base) => {
    const { response, detail } = await open(base, '0099')
    assert.equal(response.status, 500)
    assert.equal(detail.refused, 'queue')
    assert.match(detail.message, /the queue at tasks\/ cannot be read/)
    assert.match(detail.problems.join(' '), /not a task file name/)

    // And a task that is in a folder still opens, because the one file is read
    // directly rather than looked up in a queue that will not read.
    const { response: ok, detail: task } = await open(base, '0003')
    assert.equal(ok.status, 200)
    assert.equal(task.where, 'tasks/todo/0003-next.md')
    assert.deepEqual(task.criteria, ['x'])
  })
})

test('the detail is a read: it is not polled, and state.json gains nothing', async () => {
  const s = queued(setup())
  // The page polls the snapshot and nothing else: a task is fetched when it is
  // opened, so no key of it is in the state the timer reads.
  const snap = snapshot(s.product)
  assert.deepEqual(Object.keys(snap).filter((key) => /task|detail|body|goal|criteria/i.test(key)), [])
  for (const t of snap.queue.todo) assert.deepEqual(Object.keys(t), ['id', 'slug', 'repo', 'outcome', 'reason', 'doubts', 'branch'])
  assert.doesNotMatch(SCRIPT, new RegExp(String.raw`setInterval\((?!${POLL.call})`))

  await dashboard(s, async (base) => {
    // It reads, like every other path but the one write.
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await fetch(`${base}/task.json?task=0003`, { method })
      assert.equal(response.status, 405, method)
      assert.equal(response.headers.get('allow'), 'GET, HEAD')
    }
    const before = readFileSync(join(s.dir, 'tasks', 'todo', '0003-next.md'), 'utf8')
    await open(base, '0003')
    assert.equal(readFileSync(join(s.dir, 'tasks', 'todo', '0003-next.md'), 'utf8'), before, 'opening a task wrote nothing')
  })
})

// ——— What the agent is saying, while it says it (ADR 0021).

// An attempt log with `lines` in it, as an agent would leave one. Returned open,
// because what matters about this surface is what it does while it is growing.
function printing(s, task, attempt, lines) {
  const log = openAttemptLog(s.dir, task, attempt)
  for (const line of lines) log.write(`${JSON.stringify(line)}\n`)
  return log
}

const INIT = { type: 'system', subtype: 'init', model: 'claude-opus-5', session_id: 'abc' }
const SAID = { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the wallet module.' }] } }
const log = (base, task, from = null) => fetch(`${base}/log.json?task=${task}${from === null ? '' : `&from=${from}`}`)

test('the dashboard serves the tail of a running task, and only what the asker has not got', async () => {
  const s = queued(setup())
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s.dir, 'acme-api', 2)
  const printed = printing(s, '0003', 2, [INIT])

  await dashboard(s, async (base) => {
    const first = await (await log(base, '0003')).json()
    assert.equal(first.attempt, 2, 'the attempt that is running, not the first one')
    assert.deepEqual(first.running, { repo: 'acme-api', attempt: 2 })
    assert.equal(first.text, `${JSON.stringify(INIT)}\n`)

    // It grows while the task runs, and asking again from where the last
    // answer ended brings back only what has arrived since.
    printed.write(`${JSON.stringify(SAID)}\n`)
    const next = await (await log(base, '0003', first.to)).json()
    assert.equal(next.from, first.to, 'it carried on instead of resending')
    assert.equal(next.text, `${JSON.stringify(SAID)}\n`)
    assert.equal((await (await log(base, '0003', next.to)).json()).text, '', 'and nothing twice')
  })
  printed.close()
})

test('a task that is not running says what it shows is what its last attempt said', async () => {
  const s = queued(setup())
  printing(s, '0001', 3, [INIT]).close()

  await dashboard(s, async (base) => {
    const finished = await (await log(base, '0001')).json()
    assert.equal(finished.running, null)
    assert.equal(finished.attempt, 3)
    assert.ok(finished.text.includes('"type":"system"'))

    // A task nothing has ever run is not a refusal: there is no log, and that
    // is an answer.
    const never = await (await log(base, '0004')).json()
    assert.deepEqual([never.attempt, never.text, never.running], [null, '', null])
  })

  // And a claim whose process is gone is not a running task either (ADR 0017):
  // what the page would show is a transcript, not something happening now.
  claim(s.dir, 'acme-api', { task: '0001', branch: 'agent/task-0001-first' })
  const state = JSON.parse(readFileSync(join(s.dir, '.detent', 'state.json'), 'utf8'))
  state.repos['acme-api'].pid = 2 ** 22 + 12345
  writeFileSync(join(s.dir, '.detent', 'state.json'), JSON.stringify(state))
  await dashboard(s, async (base) => {
    assert.equal((await (await log(base, '0001')).json()).running, null)
  })
})

test('the log is asked for by number, and reading it is all it is', async () => {
  const s = queued(setup())
  printing(s, '0003', 1, [INIT]).close()
  await dashboard(s, async (base) => {
    // The number never becomes a path here either.
    for (const asked of ['..%2F..%2F..%2Fetc%2Fpasswd', encodeURIComponent('../../runs/journal.jsonl'), 'nope', '']) {
      const response = await log(base, asked)
      assert.equal(response.status, 400, asked)
      assert.equal((await response.json()).refused, 'number', asked)
    }
    // An offset that is not an offset is the end of the file, not a complaint.
    assert.equal((await (await log(base, '0003', 'lots')).json()).text, `${JSON.stringify(INIT)}\n`)

    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await fetch(`${base}/log.json?task=0003`, { method })
      assert.equal(response.status, 405, method)
      assert.equal(response.headers.get('allow'), 'GET, HEAD')
    }
  })
})

test('the page shows it under the task, as it arrives, and asks only for what it has not got', async () => {
  const s = queued(setup())
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s.dir, 'acme-api', 1)
  const printed = printing(s, '0003', 1, [INIT, SAID])

  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()

    // Under the task's own detail, in the section a task is opened in — and it
    // is the task section that holds it, not a block of its own somewhere else.
    assert.ok(sectionOf(TASK_SECTION).indexOf('id="task-log-panel"') > sectionOf(TASK_SECTION).indexOf('id="task-detail"'))
    assert.equal(page.node('task-log-panel').hidden, false)
    assert.match(page.text('task-log-state'), /running now in acme-api, attempt 1/)
    assert.match(page.text('task-log'), /started on claude-opus-5/)
    assert.match(page.text('task-log'), /Looking at the wallet module\./)

    // What arrives next is appended to what is already there, and the page
    // asks to carry on rather than re-reading what it has.
    printed.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'wallet.js' } }] } })}\n`)
    printed.write(`${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'applied' }] } })}\n`)
    await page.refresh()
    await page.settle()
    const shown = page.text('task-log')
    assert.match(shown, /started on claude-opus-5/, 'what it already had is still there')
    assert.match(shown, /→ Edit \{"file_path":"wallet\.js"\}/)
    assert.match(shown, /← applied/)

    // Opening a task reads once of its own, so nobody waits for the next tick;
    // every read after that carries the offset, so the page never asks again
    // for a byte it already has.
    const asked = page.reads.filter((read) => read.includes('log.json'))
    assert.equal(asked[0], 'GET log.json?task=0003', 'the first read asks for the end of the file')
    for (const read of asked.slice(1)) assert.match(read, /^GET log\.json\?task=0003&from=[1-9]\d*$/)
    // The timer is the one the page already had: no second clock for this.
    assert.deepEqual(page.timers.map((t) => t.every), [POLL.every])
    assert.equal(page.timers.length, 1)
  })
  printed.close()
})

test('the page says plainly when what it shows is not happening now', async () => {
  const s = queued(setup())
  printing(s, '0001', 2, [INIT]).close()
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0001` })
    await page.settle()
    assert.match(page.text('task-log-state'), /not running — this is what attempt 2 said, not something happening now/)

    // And a task nothing has run says that, rather than showing an empty box
    // that could be either.
    page.location.hash = `#${TASK_SECTION}/0004`
    await page.refresh()
    await page.settle()
    assert.match(page.text('task-log-state'), /nothing has run this task, or detent prune has cleared what it said/)
    assert.equal(page.text('task-log'), '')
  })
})

// A log nothing has written to for a while, which is what the file looks like
// whenever a run is between attempts: the gauge, the link check, the acceptance
// pass and the merge write no log at all.
function quietFor(log, ms) {
  const when = new Date(Date.now() - ms)
  utimesSync(log.path, when, when)
  return log
}

const DONE = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.42, session_id: 'abc' }

test('the log says how long it has been quiet, so a frozen tail can be told from a live one', async () => {
  const s = queued(setup())
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  const printed = quietFor(printing(s, '0003', 1, [INIT, SAID]), 3 * 60_000)

  await dashboard(s, async (base) => {
    const answer = await (await log(base, '0003')).json()
    assert.ok(answer.quiet >= 3 * 60_000, `the file's own mtime against the clock: ${answer.quiet}`)
    // Which is the whole of what the page is given about it: no phase is
    // recorded anywhere, and the claim says a repository, a task, an attempt
    // and a pid (ADR 0017).
    assert.deepEqual(Object.keys(answer.running).sort(), ['attempt', 'repo'])
  })
  printed.close()
})

test('the page distinguishes running and printing from running and not printing', async () => {
  const s = queued(setup())
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s.dir, 'acme-api', 1)

  // The reviewer's case, and the one this surface would otherwise lie about:
  // the agent has printed its result object and the task is still claimed,
  // because what is running now is the gauge, the link check, the acceptance
  // pass or the merge — and none of those write a log.
  const printed = printing(s, '0003', 1, [INIT, SAID, DONE])
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()
    const said = page.text('task-log-state')
    assert.match(said, /running now in acme-api, attempt 1, and the agent has finished printing/)
    assert.match(said, /the rest of a run writes no log/)
    assert.match(said, /what is running is the gauge, the acceptance pass or the merge/)
    // What it printed is still there: the lines are the point, and the sentence
    // is about them rather than instead of them.
    assert.match(page.text('task-log'), /Looking at the wallet module\./)
  })
  printed.close()

  // Mid-turn and quiet: a tool call prints nothing here until it returns, which
  // is not the same sentence and is not "a few seconds behind" either.
  const s2 = queued(setup())
  claim(s2.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s2.dir, 'acme-api', 1)
  const waiting = quietFor(printing(s2, '0003', 1, [INIT, SAID]), LOG_QUIET + 100_000)
  await dashboard(s2, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()
    const said = page.text('task-log-state')
    assert.match(said, /nothing has arrived for 2m \d+s/)
    assert.match(said, /the agent is mid-turn, and a tool call prints nothing here until it returns/)
  })
  waiting.close()

  // And a log that is moving says what it has always said: this is now.
  const s3 = queued(setup())
  claim(s3.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s3.dir, 'acme-api', 1)
  const live = printing(s3, '0003', 1, [INIT, SAID])
  await dashboard(s3, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()
    assert.match(page.text('task-log-state'), /running now in acme-api, attempt 1 — the end of what it has printed, a few seconds behind/)
  })
  live.close()
})

test('a running task whose log is not the attempt that is running says so', async () => {
  const s = queued(setup())
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s.dir, 'acme-api', 2)

  // Attempt 2 has been claimed and has printed nothing yet — the gauge sent the
  // agent back, and what is below belongs to the attempt before it.
  const printed = printing(s, '0003', 1, [INIT, SAID])
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()
    assert.match(page.text('task-log-state'), /running now in acme-api, attempt 2, and the lines below are attempt 1/)
    assert.match(page.text('task-log-state'), /writes no log/)
  })
  printed.close()

  // And a run with no log at all — one that could not open its file, or one
  // prune has been through — is not an empty box under the word "running".
  const bare = queued(setup())
  claim(bare.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  await dashboard(bare, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()
    assert.match(page.text('task-log-state'), /running now in acme-api, attempt 1 — nothing is being written here: the run could not open a log, or detent prune has cleared it/)
  })
})

test('the page shows the end of the output, and does not grow with the run', async () => {
  const s = queued(setup())
  const lines = Array.from({ length: LOG_LINES + 200 }, (_, i) => ({ type: 'assistant', message: { content: [{ type: 'text', text: `line ${i}` }] } }))
  printing(s, '0003', 1, [...lines, { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(LOG_CLIP * 3) }] } }]).close()

  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: `#${TASK_SECTION}/0003` })
    await page.settle()
    const shown = page.text('task-log').split('\n')
    assert.equal(shown.length, LOG_LINES, 'the last of it, bounded')
    assert.ok(!shown.includes('line 0'), 'the oldest have fallen off the top')
    assert.ok(shown.includes(`line ${lines.length - 1}`), 'and the newest are there')
    // A line nobody scans is clipped rather than shown whole: a tool result the
    // agent read in full would otherwise be one line of several thousand.
    assert.equal(shown.at(-1), `${'x'.repeat(LOG_CLIP)}…`)
  })
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

test('a write is refused while a run is active, by the server and not only by the editor that will not open', async () => {
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

// ——— The configuration is read until a person says otherwise (ADR 0020 part 2).

// The page, running: the script the server serves, a document that is enough
// of one, and that same server in front of it (test/support/page.mjs). What is
// asserted below is what the page does, not what its source says.
async function onThePage(s, body) {
  return dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    return body(page, base)
  })
}

const LABELS = Object.fromEntries(LIMITS.map(([key, label]) => [key, label]))

const editor = (page) => page.node('config-fields')

// One group of the editor, by the legend over it: a role is `accept` in more
// than one of them, which is the point of the per-repository ones.
function group(page, legend) {
  const [found] = editor(page).all((n) => n.className === 'group' && n.children[0]?.textContent === legend)
  assert.ok(found, `the editor drew no group called "${legend}"`)
  return found
}

// A control, found the way a person finds it: by the label beside it. Nothing
// like it exists for the view, which has no controls to find.
function control(root, label, tag = 'input') {
  const [field] = root.all((n) => n.className === 'field' && n.children[0]?.textContent === label)
  assert.ok(field, `the editor drew no field labelled "${label}"`)
  const [node] = field.tags(tag)
  assert.ok(node, `the field "${label}" has no ${tag}`)
  return node
}

test('the configuration is a view by default: what the file says as text, and an inherited value says where from', async () => {
  const s = configured()
  await onThePage(s, async (page) => {
    // The view is shown, the editor is not there at all, and the only button
    // is the one that asks for it.
    assert.equal(page.node('config-view').hidden, false)
    assert.equal(page.node('config-fields').hidden, true)
    assert.deepEqual(page.node('config-fields').children, [], 'the editor is not built until it is asked for')
    assert.equal(page.node('config-edit').hidden, false)
    assert.equal(page.node('config-save').hidden, true)
    assert.equal(page.node('config-discard').hidden, true)

    // Text, not disabled controls: reading which model a repository uses was
    // reading the contents of form controls (ADR 0020 part 2).
    assert.deepEqual(page.node('config-view').tags('input', 'select', 'button'), [], 'the view is built out of controls')
    const view = page.node('config-view').textContent
    assert.match(view, /implementclaude claude-opus-5/, 'the product’s own models')
    assert.match(view, new RegExp(`${LABELS.attempts}5`), 'a key the file sets')
    assert.match(view, new RegExp(`${LABELS.timeout}30 — the default`), 'and one it leaves out')
    assert.match(view, new RegExp(`${LABELS.notify}none`))

    // What a repository inherits is shown as inherited and says from where —
    // a repository overrides a role and never "the model" — and the editor's
    // empty option says the same sentence, because both say it from the one
    // function.
    assert.match(view, /Models for acme-api/)
    assert.match(view, /acceptthe product setting — claude claude-sonnet-5/)
    await page.click('config-edit')
    const [option] = control(group(page, 'Models for acme-api'), 'accept', 'select').children
    assert.equal(option.textContent, 'the product setting — claude claude-sonnet-5')
    assert.equal(control(group(page, 'Models for the product'), 'accept', 'select').children[0].textContent, 'not set',
      'and the product’s own roles inherit from nowhere')

    // And the fact is stated once: the repositories table used to say it too.
    assert.doesNotMatch(SCRIPT, /r\.implement|r\.accept/)
    assert.ok(!('implement' in snapshot(s.product).repos[0]), 'and the snapshot no longer carries it')
    assert.match(PAGE, /Which model each repository uses is read in <a href="#configuration">/)
  })
})

test('the configuration view may refresh, and an open editor never does', async () => {
  const s = configured()
  // One timer on the page, and what it calls is the snapshot's own refresh,
  // which reads the state and the configuration view beside it.
  assert.deepEqual(POLL, { call: 'refresh', every: 3000 })
  assert.deepEqual([...PAGE.matchAll(/setInterval\((\w+)/g)].map((m) => m[1]), ['refresh'])
  assert.equal([...PAGE.matchAll(/setInterval|setTimeout|requestAnimationFrame/g)].length, 1, 'one timer')
  assert.ok(PAGE.includes(`setInterval(${POLL.call}, ${POLL.every})`))
  assert.match(SCRIPT, new RegExp(String.raw`async function ${POLL.call}\(\) \{[^}]*fetch\('state\.json'`))

  await onThePage(s, async (page) => {
    assert.deepEqual(page.timers, [{ call: page.refresh, every: POLL.every }], 'the timer calls the page’s own refresh')
    assert.deepEqual(page.reads, ['GET state.json', 'GET configuration.json'], 'the load reads both')

    // The view refreshes: the timer's own function, run again, reads the file
    // again and shows what it now says.
    writeFileSync(file(s), JSON.stringify({ ...JSON.parse(readFileSync(file(s), 'utf8')), attempts: 4 }, null, 2))
    await page.refresh()
    assert.match(page.node('config-view').textContent, new RegExp(`${LABELS.attempts}4`))

    // The editor does not. From the read that opened it until it closes,
    // nothing moves under the person typing — not the timer, not a write by
    // something else (ADR 0020 part 2, narrowing ADR 0015).
    await page.click('config-edit')
    const typed = control(editor(page), LABELS.attempts)
    typed.value = '6'
    writeFileSync(file(s), JSON.stringify({ ...JSON.parse(readFileSync(file(s), 'utf8')), attempts: 7 }, null, 2))
    const read = page.reads.length
    await page.refresh()
    await page.refresh()
    assert.equal(page.editing(), true)
    assert.equal(typed.value, '6', 'the timer moved a value under the person typing')
    assert.deepEqual(page.reads.slice(read), ['GET state.json', 'GET state.json'], 'and read the configuration while it was open')
  })
})

test('the editor takes a fresh read, so what is edited is what the file currently says', async () => {
  const s = configured()
  await onThePage(s, async (page) => {
    // Something else writes the file after the view was drawn.
    writeFileSync(file(s), JSON.stringify({ ...JSON.parse(readFileSync(file(s), 'utf8')), attempts: 9, notify: 'say done' }, null, 2))
    const read = page.reads.length
    await page.click('config-edit')

    assert.deepEqual(page.reads.slice(read), ['GET configuration.json'], 'opening the editor reads the file')
    assert.equal(page.editing(), true)
    assert.equal(page.node('config-fields').hidden, false)
    assert.equal(page.node('config-view').hidden, true)
    assert.equal(control(editor(page), LABELS.attempts).value, '9')
    assert.equal(control(editor(page), LABELS.notify).value, 'say done')
    // The buttons swap: there is a way out that is not the write.
    assert.equal(page.node('config-edit').hidden, true)
    assert.equal(page.node('config-save').hidden, false)
    assert.equal(page.node('config-discard').hidden, false)
  })
})

test('the editor does not open while a run is active, and the view stays readable', async () => {
  const s = configured()
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  await onThePage(s, async (page) => {
    // Nothing is disabled but the one button, and the view is text anyway:
    // somebody who opens the page during a run to see which model is costing
    // what finds the answer (ADR 0020 part 2).
    assert.equal(page.node('config-edit').disabled, true)
    assert.equal(page.node('config-view').hidden, false)
    assert.match(page.node('config-view').textContent, /implementclaude claude-opus-5/)
    assert.doesNotMatch(SCRIPT, /#config input|#config select/, 'the panel is not disabled whole')

    // And the refusal keeps the explanation 0015 made part of the feature:
    // that a run is active, what it is working on, and that the server refuses
    // regardless of what this page allows.
    const lock = page.text('config-lock')
    assert.match(lock, /A run is active — acme-api on task 0003, attempt 0/)
    assert.match(lock, /written between runs/)
    assert.match(lock, /the server refuses a write now whatever this page allows/)

    // Clicking it anyway — the button is a courtesy and this is the rule.
    const read = page.reads.length
    await page.click('config-edit')
    assert.equal(page.editing(), false)
    assert.deepEqual(page.node('config-fields').children, [], 'no editor was built')
    assert.equal(page.node('config-view').hidden, false)
    assert.deepEqual(page.reads.slice(read), [], 'and nothing was read for it')
    assert.match(page.text('config-note'), /a run is active/)
  })
})

test('a write the server refuses leaves the editor open with what was typed in it', async () => {
  const s = configured()
  const before = readFileSync(file(s), 'utf8')
  await onThePage(s, async (page) => {
    await page.click('config-edit')
    control(editor(page), LABELS.attempts).value = '0'
    control(editor(page), LABELS.notify).value = 'say done'
    await page.click('config-save')

    // Refused by the validator, whole and by path — the server's own rules,
    // untouched (ADR 0015).
    assert.ok(page.reads.includes('POST configuration.json'))
    assert.equal(readFileSync(file(s), 'utf8'), before, 'nothing was written')
    const problems = page.node('config-problems').textContent
    assert.match(problems, /^attempts:/)
    assert.match(page.text('config-note'), /was not written/)

    // And the editor is still open with the edits in it: losing somebody's
    // work to a validation error would make this mode worse than the one it
    // replaced.
    assert.equal(page.editing(), true)
    assert.equal(page.node('config-fields').hidden, false)
    assert.equal(control(editor(page), LABELS.attempts).value, '0')
    assert.equal(control(editor(page), LABELS.notify).value, 'say done', 'the edit that was fine survived too')

    // Fixed in place, from the same editor, and the write goes through.
    control(editor(page), LABELS.attempts).value = '2'
    await page.click('config-save')
    assert.equal(page.editing(), false, 'a write that is accepted closes it')
    assert.equal(JSON.parse(readFileSync(file(s), 'utf8')).attempts, 2)
    assert.match(page.node('config-view').textContent, new RegExp(`${LABELS.attempts}2`))
    assert.deepEqual(page.node('config-problems').children, [])
  })
})

test('leaving the editor discards, and writes nothing', async () => {
  const s = configured()
  const before = readFileSync(file(s), 'utf8')
  await onThePage(s, async (page) => {
    await page.click('config-edit')
    control(editor(page), LABELS.attempts).value = '11'
    control(editor(page), 'implement', 'input').value = 'claude-haiku-4-5'
    await page.click('config-discard')

    assert.equal(page.editing(), false)
    assert.deepEqual(page.node('config-fields').children, [], 'the editor and what was typed in it are gone')
    assert.equal(page.node('config-view').hidden, false)
    assert.equal(readFileSync(file(s), 'utf8'), before, 'discarding wrote nothing')
    assert.ok(!page.reads.includes('POST configuration.json'), 'and asked for no write')
    assert.match(page.node('config-view').textContent, new RegExp(`${LABELS.attempts}5`), 'the view says what the file says')

    // There is no prompt on the way out and no change held back to be applied
    // later: a change accepted and not yet applied is the third state the page
    // exists to avoid (ADR 0015).
    assert.doesNotMatch(SCRIPT, /confirm\(|beforeunload|dialog/)
  })
})
