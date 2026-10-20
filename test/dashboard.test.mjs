import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '../core/commands/dashboard.mjs'
import { EDITABLE, NOT_EDITABLE, readConfiguration } from '../core/configure.mjs'
import { PAGE, POLL, SCRIPT } from '../core/dashboard-page.mjs'
import { LIMITS } from '../core/dashboard/configuration.mjs'
import { LOG_CLIP, LOG_LINES, LOG_QUIET } from '../core/dashboard/log.mjs'
import { nextNumber, taskName } from '../core/dashboard/queue.mjs'
import { DRAWER, SECTIONS, SECTION_IDS, TASK_PART, sectionFor, taskFor, taskHash } from '../core/dashboard/sections.mjs'
import { STYLE } from '../core/dashboard/style.mjs'
import { NEXT_UP } from '../core/dashboard/view.mjs'
import { warnings } from '../core/dashboard/warnings.mjs'
import { schedule } from '../core/scheduler.mjs'
import { appendJournal } from '../core/journal.mjs'
import { snapshotRefs } from '../core/git.mjs'
import { openAttemptLog } from '../core/log.mjs'
import { MODEL_SUGGESTIONS, PRODUCT_FILE, loadProduct } from '../core/product.mjs'
import { snapshot } from '../core/snapshot.mjs'
import { FOLDERS, parseTask } from '../core/task.mjs'
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
// Overview's are listed in the order they are served, which the test below
// asserts: what is running, what is next, what is waiting, and the figures
// under those three (§12).
const BLOCKS = {
  overview: ['now', 'next-up-order', 'next-up', 'waiting', 'figures'],
  repositories: ['repos', 'by-repo'],
  queue: ['todo-order', 'todo', 'hold', 'done', 'failed', 'queue-how'],
  agents: ['by-model'],
  runs: ['recent'],
  configuration: ['config', 'fixed'],
}

// And what is in no section, because it is drawn over one: the drawer a task
// opens in, and the way out it carries (ADR 0022).
const DRAWN_OVER = ['task-close', 'task-detail', 'task-log-panel', 'task-log-state', 'task-log']

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

  // The drawer is in none of them and holds everything a task is: it is drawn
  // over whichever section is showing, so a section that contained it would be
  // the section the detail used to be (ADR 0022).
  for (const block of DRAWN_OVER) {
    assert.deepEqual(SECTION_IDS.filter((s) => sectionOf(s).includes(`id="${block}"`)), [], `${block} is inside a section`)
    assert.ok(DRAWER.includes(`id="${block}"`), `${block} is not in the drawer`)
  }
  assert.ok(PAGE.includes(DRAWER), 'the drawer is served as it is written')
  assert.equal(PAGE.indexOf('</main>') < PAGE.indexOf('<aside id="task-drawer"'), true, 'and over the sections, not among them')

  // Nothing the page renders into is outside the sections and the drawer, and
  // no two things share an id — a mistake the split invites and a single
  // literal could not make, because every module now writes markup of its own.
  const drawn = [...Object.values(BLOCKS).flat(), ...DRAWN_OVER]
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
  for (const hash of [undefined, '', '#', '#nope', '#nope/task/0003']) {
    assert.equal(sectionFor(hash, SECTION_IDS), 'overview', JSON.stringify(hash))
  }
  // And what somebody typed stays as they typed it: a page that corrects the
  // address bar loses the one thing the fragment was for. The one thing that
  // writes a fragment is a person closing the drawer, which is them acting on
  // the page rather than the page correcting their arrival (ADR 0022).
  assert.deepEqual(SCRIPT.match(/location\.hash\s*=/g).length, 1)
  assert.match(SCRIPT, /function closeTask\(\) \{\n[^}]*\n\s*location\.hash = '#' \+ sectionFor\(location\.hash, SECTION_IDS\)\n/)
  assert.doesNotMatch(SCRIPT, /location\.replace|(?:replace|push)State/)
  // Changing section is an attribute on markup already served.
  assert.doesNotMatch(SCRIPT, /addEventListener\('hashchange', (?!showSection)/)
  // Nothing is fetched to change section, with two exceptions the fragment
  // itself names: the task, which is not in the snapshot (ADR 0020 part 3),
  // and what its agent is saying, which is not in it either (ADR 0021).
  assert.deepEqual([...SCRIPT.matchAll(/fetch\('([\w.?=]+)/g)].map((m) => m[1]).sort(),
    ['configuration.json', 'configuration.json', 'log.json?task=', 'state.json', 'task.json?task='])
})

test('the fragment names a section and a task over it, and a fragment that is half wrong still lands on a section', () => {
  // Every function the page runs, called here: they are serialised into it.
  for (const fn of [sectionFor, taskFor, taskHash]) assert.ok(SCRIPT.includes(String(fn)), 'the page runs some other copy of it')
  assert.ok(!SECTION_IDS.includes(TASK_PART), 'the detail is a section again')
  assert.ok(!PAGE.includes('>Task</a>'), 'the detail has a link in the nav again')

  // A link to one task: the section it opens over, and the number it opens.
  assert.equal(taskHash('queue', '0042'), '#queue/task/0042')
  assert.equal(sectionFor(taskHash('queue', '0042'), SECTION_IDS), 'queue')
  assert.equal(taskFor(taskHash('queue', '0042'), SECTION_IDS), '0042')
  assert.equal(taskFor('queue/task/7', SECTION_IDS), '7', 'with or without the #')
  // Over any of them, because a task is opened from wherever it is listed.
  for (const id of SECTION_IDS) assert.equal(taskFor(taskHash(id, '0042'), SECTION_IDS), '0042', id)

  // A fragment with no task is the bare section, exactly as it was.
  for (const id of SECTION_IDS) {
    assert.equal(sectionFor(`#${id}`, SECTION_IDS), id)
    assert.equal(taskFor(`#${id}`, SECTION_IDS), null, id)
  }

  // An unknown section with a good number, and a good section with a bad one:
  // both land on a section, and neither opens anything. Half a fragment is not
  // read as the half of it that parses, and the number never becomes a path.
  const wrong = ['#nope/task/0042', '#queue/task/', '#queue/task/nope', '#queue/task/../0001', '#queue/task/0001/x', '#queue/0001', '#queue/tasks/0001']
  for (const hash of wrong) {
    assert.ok(SECTION_IDS.includes(sectionFor(hash, SECTION_IDS)), hash)
    assert.equal(taskFor(hash, SECTION_IDS), null, hash)
  }
  assert.equal(sectionFor('#queue/task/nope', SECTION_IDS), 'queue', 'a readable section is still read')
  assert.equal(sectionFor('#nope/task/0042', SECTION_IDS), 'overview')

  // Everything that lists a task opens it over the section the list is in, and
  // the detail is what the page fetches when one is open: the tables by the
  // cell they put a link in, and the queue's cards by the head of the card.
  assert.match(SCRIPT, /const opens = \(section, id, slug\) => el\('a', \{ href: taskHash\(section, id\) \}/)
  assert.match(SCRIPT, /el\('a', \{ href: taskHash\('queue', task\.id\), title: task\.id \+ ' · ' \+ name \}/)
  assert.match(SCRIPT, /s\.queue\.hold\.map\(\(t\) => \[queued\(t\)/)
  assert.match(SCRIPT, /function queued\(t\) \{\n\s*return el\('div', \{\}, el\('strong', \{\}, opens\('overview', t\.id, t\.slug\)\)/)
  assert.match(SCRIPT, /shown\.map\(\(t, i\) => \[i \+ 1, opens\('overview', t\.id, t\.slug\)/)
  assert.match(SCRIPT, /s\.recent\.map\(\(r\) => \[when\(r\.finished\), opens\('runs', r\.task, r\.slug\)/)
  assert.match(SCRIPT, new RegExp(String.raw`function showDrawer\(\) \{\n\s*const number = taskFor\(location\.hash, SECTION_IDS\)\n`
    + String.raw`\s*document\.getElementById\('task-drawer'\)\.hidden = number === null\n\s*if \(number === null\) return\n`
    + String.raw`\s*loadTask\(number\)\n\s*refreshLog\(\)\n\s*\}`))

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

  // Each of the four has a list of cards of its own in the queue section, and
  // the numbers by repository have a table beside the repositories.
  for (const folder of FOLDERS) {
    assert.ok(sectionOf('queue').includes(`<div class="cards" id="${folder}">`), folder)
  }
  assert.ok(sectionOf('repositories').includes('<table id="by-repo">'))
  assert.match(SCRIPT, /numbersFor\('by-repo', 'Repository', n\.byRepo\)/)
  for (const folder of FOLDERS) assert.match(SCRIPT, new RegExp(String.raw`cards\('${folder}', shown\.queue\.${folder}`), folder)
})

// ——— The queue is four folders of cards, and the two commands the page does
// not run (§12).

// All four folders filled, and a journal that has a line for some of these
// tasks and none for the others — which is the state a real queue is in.
function filled() {
  const s = setup()
  for (const folder of FOLDERS) mkdirSync(join(s.dir, 'tasks', folder), { recursive: true })
  const put = (folder, name) => writeFileSync(join(s.dir, 'tasks', folder, name), `---\nid: ${name.split('-')[0]}\nrepo: acme-api\n---\n\n# Acceptance criteria\n\n- [ ] x\n`)
  put('done', '0001-first.md')
  put('done', '0005-a-task-is-something-you-can-open.md')
  put('failed', '0004-gone.md')
  put('failed', '0006-abandoned-after-a-doubt.md')
  appendJournal(s.dir, journalLine({
    task: '0005', slug: 'a-task-is-something-you-can-open', outcome: 'passed',
    attempts: 2, cost: { usd: 1.5, tokens: null }, finished: '2026-10-07T09:00:00Z',
  }))
  appendJournal(s.dir, journalLine({
    task: '0006', slug: 'abandoned-after-a-doubt', outcome: 'rejected', attempts: 3,
    reason: 'the acceptance pass raised a doubt: the rounding is still wrong',
    branch: 'agent/task-0006-abandoned-after-a-doubt', finished: '2026-10-08T09:00:00Z',
    acceptance: { verdict: 'rejected', doubts: ['the rounding is still wrong'] },
  }))
  return s
}

const journalLine = (o) => ({
  kind: 'task', repo: 'acme-api', attempts: 1, lock: 'enforced',
  models: { implement: { agent: 'claude', requested: null, actual: 'claude-opus-5' } },
  cost: { usd: 0.1, tokens: null }, acceptance: { verdict: 'accepted', doubts: [] }, ...o,
})

const cardsIn = (page, folder) => page.node(folder).all((n) => n.className === 'card')
const headOf = (card) => card.all((n) => n.className === 'card-head')[0]
const numbersIn = (page, folder) => cardsIn(page, folder).map((card) => headOf(card).textContent.split(' ')[0])
const cardFor = (page, folder, id) => cardsIn(page, folder).find((card) => headOf(card).textContent.startsWith(id + ' '))
const linesOf = (card) => card.children.filter((child) => child.className.includes('line')).map((child) => child.textContent)

test('a task in the queue is a card: the number and its name on one line, and the facts in a row under it', async () => {
  const s = filled()
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()

    // The head is the one row that has to read like a title, and it is a link
    // to the task, as every list of tasks on this page is.
    const card = cardFor(page, 'done', '0005')
    assert.equal(headOf(card).textContent, '0005 · A task is something you can open')
    assert.equal(headOf(card).all((n) => n.tag === 'a')[0].getAttribute('href'), taskHash('queue', '0005'))
    // The path stays visible, small, for whoever opens the file.
    assert.deepEqual(linesOf(card).filter((text) => text.includes('.md')),
      ['tasks/done/0005-a-task-is-something-you-can-open.md'])

    // And what `Recent runs` says about the same journal line, all of it in
    // one row of the card: the snapshot passes attempts, cost and finished out
    // of the line it was already reading.
    const facts = card.all((n) => n.className === 'facts')
    assert.equal(facts.length, 1, 'the facts are one row and not several')
    assert.deepEqual(facts[0].children.map((child) => child.textContent),
      ['✓passed', 'acme-api', '2 attempts', '$1.50', 'finished ' + new Date('2026-10-07T09:00:00Z').toLocaleString(), 'acceptance: accepted'])

    // Which is the same run `Recent runs` draws, from the same line.
    assert.match(page.text('recent'), /2 attempts|0005/)
  })
})

test('a card row does not wrap, so the reason a task is in failed/ is on the card and not under the height of a row', async () => {
  const s = filled()
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()

    // The case this fixes: a task a person abandoned, which the journal has no
    // line for. The words sat under the height of the row they were in and
    // were never seen; they are a line of the card now.
    const gone = cardFor(page, 'failed', '0004')
    assert.deepEqual(linesOf(gone), [
      'tasks/failed/0004-gone.md',
      'abandoned by hand',
      'the journal has not seen this task — nothing has run it',
    ])

    // And a task abandoned after the acceptance pass sent it back says what it
    // said: the doubt, and the branch the work is still on.
    const doubted = cardFor(page, 'failed', '0006')
    assert.match(doubted.textContent, /the rounding is still wrong/)
    assert.match(doubted.textContent, /agent\/task-0006-abandoned-after-a-doubt/)
    assert.deepEqual(doubted.all((n) => n.tag === 'li').map((n) => n.textContent), ['the rounding is still wrong'])

    // What keeps it there: a card's rows do not wrap, so nothing in one
    // becomes a silent second line, and anything longer than a row is a line.
    assert.match(STYLE, /\.card-head, \.card-head a \{[^}]*flex-wrap: nowrap/)
    assert.match(STYLE, /\.card \.facts \{[^}]*flex-wrap: nowrap/)
    assert.match(STYLE, /\.card \.line \{[^}]*white-space: normal/)
  })
})

test('the readable name is the slug, and no field is added to the frontmatter to hold it', () => {
  // The function the page runs, called here: it is serialised into the script.
  assert.ok(SCRIPT.includes(String(taskName)), 'the page runs some other copy of it')
  assert.equal(taskName('a-task-is-something-you-can-open'), 'A task is something you can open')
  assert.equal(taskName('first'), 'First')
  assert.equal(taskName(''), 'no name')

  // The slug already is the name, so the frontmatter gains nothing: a second
  // place to keep it is a second place to get it wrong.
  const { problems } = parseTask('---\nid: 0001\nrepo: acme-api\ntitle: A task\n---\n\n# Acceptance criteria\n\n- [ ] x\n', { id: '0001', slug: 'a-task' })
  assert.match(problems.join('\n'), /frontmatter key "title" is unknown/)
  // And the page reads the name off the slug rather than out of a field: the
  // first line of `# Goal` is not a name either.
  assert.match(SCRIPT, /const name = taskName\(task\.slug\)/)
})

test('todo/ is in run order and says so; done/ and failed/ are newest first', async () => {
  const s = filled()
  writeFileSync(where(s, '00011-eleven.md'), todoTask('00011'))
  writeFileSync(where(s, '0007-shared.md'), todoTask('0007', true))

  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()

    // Ascending task id, which is what `schedule()` sorts by — and the line
    // above the folder says that is the order a run takes them, because a list
    // that looks arbitrary teaches the wrong thing about how the queue works.
    assert.deepEqual(numbersIn(page, 'todo'), ['0003', '0007', '00011'])
    assert.match(page.text('todo-order'), /^A run takes these in ascending task id, and a barrier alone\.$/)
    assert.match(cardFor(page, 'todo', '0007').textContent, /barrier — runs alone, and nothing queued after it starts/)

    // Newest first, by what the journal says finished: the oldest thing you
    // finished is not what a list of finished work is for. A task the journal
    // never dated has no date to sort by, so it falls back to its number.
    assert.deepEqual(numbersIn(page, 'done'), ['0005', '0001'])
    assert.deepEqual(numbersIn(page, 'failed'), ['0006', '0004'])
  })
})

test('a column sorts on a click, the arrow says which and which way, and the choice survives the refresh', async () => {
  const s = filled()
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    const heading = (folder, label) => page.node(folder).all((n) => n.tag === 'button').find((b) => b.textContent.startsWith(label))

    // Which column and which way, on the heading that is in force.
    assert.match(heading('done', 'Finished').textContent, /▼$/)
    assert.equal(heading('done', 'Finished').getAttribute('aria-pressed'), 'true')
    assert.equal(heading('done', 'Task').getAttribute('aria-pressed'), 'false')

    // Another column takes the way it reads first; the same one again turns
    // round.
    await heading('done', 'Task').click()
    assert.deepEqual(numbersIn(page, 'done'), ['0001', '0005'])
    assert.match(heading('done', 'Task').textContent, /▲$/)
    assert.equal(heading('done', 'Finished').getAttribute('aria-pressed'), 'false')
    await heading('done', 'Task').click()
    assert.deepEqual(numbersIn(page, 'done'), ['0005', '0001'])
    assert.match(heading('done', 'Task').textContent, /▼$/)

    // The page redraws every three seconds, and the choice is not redrawn
    // away: a list that reordered itself under a reader would be worse than no
    // sort at all. The click read nothing, either.
    const read = page.reads.length
    await page.refresh()
    assert.deepEqual(numbersIn(page, 'done'), ['0005', '0001'])
    assert.match(heading('done', 'Task').textContent, /▼$/)
    assert.equal(page.reads.length - read, 2, 'the snapshot and the configuration — and nothing for a sort')

    // A sort of todo/ never changes what a run does, and the line says so
    // rather than letting the order on the screen imply it.
    await heading('todo', 'Name').click()
    assert.match(page.text('todo-order'), /^A run takes these in ascending task id, and a barrier alone\./)
    assert.match(page.text('todo-order'), /Sorted here by name — the order a run takes them is unchanged\.$/)
  })
})

test('the section says how to make a task and how to run one, in this product own paths', async () => {
  // A queue that is not at `tasks/`: what the page says to type is read from
  // the product, never from a literal (ADR 0012).
  const s = gitProduct({}, { queue: 'agent-loop/tasks' })
  mkdirSync(join(s.dir, 'agent-loop', 'tasks', 'todo'), { recursive: true })
  writeFileSync(join(s.dir, 'agent-loop', 'tasks', 'todo', '0003-next.md'), todoTask('0003'))

  assert.equal(nextNumber(snapshot(s.product).queue), '0004', 'one past the highest in all four folders')
  assert.ok(SCRIPT.includes(String(nextNumber)), 'the page runs some other copy of it')

  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    const how = page.text('queue-how')

    // The number, the file in this product's own todo/, and the shape §4 gives.
    assert.match(how, /The next number is 0004, one past the highest in all four folders/)
    assert.match(how, /agent-loop\/tasks\/todo\/0004-<slug>\.md/)
    assert.match(how, /id: 0004\nrepo: acme-api\ntouches_contract: false/)
    assert.match(how, /# Acceptance criteria/)

    // And the commands, for this product, ready to copy.
    assert.ok(how.includes(`detent plan --product ${s.product.dir}`), how)
    assert.ok(how.includes(`detent run --product ${s.product.dir}`))
    assert.ok(how.includes(`detent run 0004 --product ${s.product.dir}`))

    // Said plainly, because the page is not a second writer of these files
    // (§12): it does not run or move a task, and nothing here writes.
    assert.match(how, /This page does not run or move tasks\./)
    assert.match(how, /moves these files between the four folders by its own results/)
    assert.deepEqual(page.reads.filter((read) => !read.startsWith('GET ')), [])
  })
})

// ——— Overview answers "what now": what is running, what is next, what is
// waiting — and the figures under those three (§12).

const todoTask = (id, barrier = false) =>
  `---\nid: ${id}\nrepo: acme-api\ntouches_contract: ${barrier}\n---\n\n# Acceptance criteria\n\n- [ ] x\n`

const where = (s, name) => join(s.dir, 'tasks', 'todo', name)

test('Overview is the landing screen: what is running, what is next, what is waiting, and the figures under them', async () => {
  // In the document in that order, and every block of it inside Overview and
  // inside no other section — the figures included, which is where they were
  // and where they stay.
  const overview = sectionOf('overview')
  const at = (block) => overview.indexOf(`id="${block}"`)
  for (const block of BLOCKS.overview) assert.notEqual(at(block), -1, block)
  assert.deepEqual([...BLOCKS.overview].sort((a, b) => at(a) - at(b)), BLOCKS.overview,
    'what is running, what is next, what is waiting, then the figures')
  for (const block of BLOCKS.overview) {
    assert.deepEqual(SECTION_IDS.filter((id) => sectionOf(id).includes(`id="${block}"`)), ['overview'], block)
  }
  // And Repositories keeps its own: this adds a landing screen rather than
  // moving anything into one.
  assert.deepEqual(BLOCKS.repositories, ['repos', 'by-repo'])
  assert.ok(sectionOf('repositories').includes('<h2>By repository</h2>'))

  // Nothing running: a sentence, because an empty box reads the same whether
  // nothing is running or the page failed to draw what is.
  const s = setup()
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    assert.match(page.text('now'), /^Nothing is running\. One task is queued, and a run takes them in the order below\.$/)
    assert.match(page.text('next-up-order'), /ascending task id, and a barrier alone/)
    assert.match(page.text('next-up'), /0003 next/)

    // What is waiting for a person, and why it stopped — the reviewer's doubt
    // and not only the outcome.
    assert.match(page.text('waiting'), /0002 float/)
    assert.match(page.text('waiting'), /rejected/)
    assert.match(page.text('waiting'), /add rounds/)

    // The figures are still the figures, from the same numbers as before.
    assert.match(page.text('figures'), /Pass rate/)
    assert.match(page.text('figures'), /1 of 2 runs passed/)

    // The strip is untouched: what is wrong is still outside every section,
    // and this block repeating it is the list under the line.
    assert.match(page.text('alerts'), /one task is paused, waiting for you/)

    // A task named here opens, the way one named in Queue or Recent runs does.
    assert.deepEqual(page.node('next-up').all((n) => n.tag === 'a').map((n) => n.getAttribute('href')),
      [taskHash('overview', '0003')])
    assert.deepEqual(page.node('waiting').all((n) => n.tag === 'a').map((n) => n.getAttribute('href')),
      [taskHash('overview', '0002')])
  })
})

test('Overview says what is running: the repository, the task, the attempt and how long it has been going', async () => {
  const s = setup()
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  setAttempt(s.dir, 'acme-api', 2)

  // An hour and ten minutes ago, by the clock the claim wrote. The page reads
  // it against the snapshot's own `generated` and never against the browser's,
  // so a machine whose clock is out is not told a run started in the future.
  const file = join(s.dir, '.detent', 'state.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
  state.repos['acme-api'].started = new Date(Date.now() - ((70 * 60) + 30) * 1000).toISOString()
  writeFileSync(file, JSON.stringify(state))

  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    const [head] = page.node('now').all((n) => n.className === 'run-head')
    assert.deepEqual(head.children.map((child) => child.textContent),
      ['acme-api', 'task', '0003', 'attempt 2', 'going for 1h 10m'])
    assert.match(page.text('now'), /agent\/task-0003-next/, 'and the branch it is on')
    assert.equal(page.node('now').all((n) => n.tag === 'a')[0].getAttribute('href'), taskHash('overview', '0003'))
    // Nothing about how much longer it has or what it will cost: both are
    // predictions, and this page says what is true.
    assert.doesNotMatch(page.text('now'), /left|remaining|estimat|\$/)
  })

  // A run whose process is gone is not working on anything, so this block does
  // not show it as running. Saying so stays the strip's job, above every
  // section (ADR 0020's first consequence).
  state.repos['acme-api'].pid = 2 ** 22 + 12345 // no such process
  writeFileSync(file, JSON.stringify(state))
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    assert.match(page.text('now'), /^Nothing is running\./)
    assert.match(page.text('alerts'), /the run on acme-api is gone — task 0003, attempt 2/)
  })
})

test('Overview lists what is next in the order a run takes it — ascending task id, with the barrier marked', async () => {
  const s = setup()
  // Written so the file system's order is not the run's: 00011 sorts before
  // 0003 by name and after it by number. The middle one is the barrier.
  writeFileSync(where(s, '00011-eleven.md'), todoTask('00011'))
  writeFileSync(where(s, '0007-shared.md'), todoTask('0007', true))

  const snap = snapshot(s.product)
  assert.deepEqual(snap.queue.todo.map((t) => [t.id, t.touchesContract]),
    [['0003', false], ['0007', true], ['00011', false]], 'the snapshot carries which one runs alone')

  // The order a run would take them, from the scheduler that would take them.
  const started = []
  await schedule(snap.queue.todo.map((t) => ({ id: t.id, repo: t.repo, touchesContract: t.touchesContract })), {
    concurrency: 2,
    runOne: async () => ({ outcome: 'passed' }),
    onStart: (t) => started.push(t.id),
  })
  assert.deepEqual(started, ['0003', '0007', '00011'])

  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    const rows = page.node('next-up').children.at(-1).children.map((row) => row.children.map((cell) => cell.textContent))
    assert.deepEqual(rows.map((cells) => cells[0]), ['1', '2', '3'], 'numbered, so the order is not left to be inferred')
    assert.deepEqual(rows.map((cells) => cells[1].split(' ')[0]), started)
    assert.match(page.text('next-up-order'), /ascending task id/)

    // The barrier is marked as one, and what is behind it says what it is
    // behind: it runs alone, and nothing queued past it starts (§8).
    assert.equal(rows[0][3], '—')
    assert.match(rows[1][3], /barrier — alone, and nothing after it starts/)
    assert.equal(rows[2][3], 'after task 0007')
  })

  // More than the few it lists: it says how many of how many and where the
  // rest are, rather than growing into the table Queue already has.
  for (let n = 20; n < 20 + NEXT_UP; n += 1) writeFileSync(where(s, `00${n}-more.md`), todoTask(`00${n}`))
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()
    assert.equal(page.node('next-up').children.at(-1).children.length, NEXT_UP)
    assert.match(page.text('next-up-order'), new RegExp(`The next ${NEXT_UP} of ${NEXT_UP + 3} — the rest are in Queue`))
  })
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

// ——— What its attempts did, which is what the panel leads with (§12).

// The blocks the panel drew, in the order it drew them, named by the legend
// over each one.
const blocksOf = (page) => page.node('task-detail').children
  .filter((child) => child.className === 'group')
  .map((group) => group.children[0].textContent)
const blockNamed = (page, legend) => page.node('task-detail').children
  .find((child) => child.className === 'group' && child.children[0].textContent === legend)
const recordsIn = (page) => page.node('task-detail').all((node) => node.className === 'run-record')
const rowsOf = (record) => record.all((node) => node.tag === 'tr').map((row) => row.children.map((cell) => cell.textContent))

// A run with everything a journal line carries, so the block can be read
// against it: two passes with a cost and a model each, tokens, the two
// instants, a gauge stage that failed on the way, and a resume. It is the
// second run of 0001 — `setup` already wrote the first — so one task shows
// both a line that reported everything and a line that reported little.
function ranAgain(s) {
  appendJournal(s.dir, {
    kind: 'task',
    task: '0001',
    slug: 'first',
    repo: 'acme-api',
    started: '2026-10-07T09:00:00Z',
    finished: '2026-10-07T09:07:30Z',
    outcome: 'passed',
    reason: null,
    resumed: true,
    attempts: 2,
    lock: 'enforced',
    gauge: { profile: 'exit', failedStage: 'test' },
    models: {
      implement: { agent: 'claude', requested: 'claude-opus-5', actual: 'claude-opus-5-20260101' },
      accept: { agent: 'claude', requested: 'claude-sonnet-5', actual: null },
    },
    cost: { usd: 1.5, tokens: { input: 100000, output: 26000 } },
    acceptance: { verdict: 'accepted', doubts: [], cost: { usd: 0.3, tokens: { input: 20000, output: 1000 } } },
    links: { checked: 2, broken: [] },
    commit: 'abc1234',
    branch: 'agent/task-0001-first',
    merged: true,
  })
  return s
}

test('what its attempts did is first, under a head that reads as a number and a name', async () => {
  const s = ranAgain(queued(setup()))
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('queue', '0001') })
    await page.settle()

    // Directly under the head, and before the body: the file is written goal
    // first, and that is the opposite of the order it is read in.
    const panel = page.node('task-detail')
    assert.equal(panel.children[0].className, 'task-head')
    assert.equal(panel.children[1].children[0].textContent, 'What its attempts did')

    // And the body blocks keep their order among themselves, with nothing
    // dropped on the way down.
    assert.deepEqual(blocksOf(page), ['What its attempts did', 'Frontmatter', 'Goal', 'Acceptance criteria', 'Out of scope'])
    assert.match(blockNamed(page, 'Goal').textContent, /Task 0001 must work\./)
    assert.deepEqual(blockNamed(page, 'Acceptance criteria').all((n) => n.tag === 'li').map((n) => n.textContent),
      ['the first one', 'the second one'])
    assert.match(blockNamed(page, 'Out of scope').textContent, /Nothing else in 0001\./)
    assert.match(blockNamed(page, 'Frontmatter').textContent, /acme-api/)

    // The head is a number and a name, from the slug by the helper the queue's
    // cards use — `0001 first` was a file name. The folder and the path are
    // still there, small, because the path is what opens the file.
    const head = panel.children[0]
    assert.equal(head.all((n) => n.tag === 'strong')[0].textContent, '0001 · First')
    assert.equal(head.all((n) => n.className === 'chip')[0].textContent, 'done')
    assert.equal(head.all((n) => n.tag === 'code')[0].textContent, 'tasks/done/0001-first.md')
    assert.match(STYLE, /\.task-head strong \{ font-size/)
  })
})

test('the implementation cost and the acceptance pass are separated, and come out of the total', async () => {
  const s = ranAgain(queued(setup()))
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('queue', '0001') })
    await page.settle()

    const [, second] = recordsIn(page)
    assert.equal(recordsIn(page).length, 2, 'both of its runs, in the order they happened')

    // Two rows, each with its own cost, its own tokens and the model it ran
    // on: one number for both would hide what reading the work cost against
    // what doing it cost.
    assert.deepEqual(rowsOf(second), [
      ['Pass', 'Cost', 'Tokens', 'Model'],
      ['Implementation', '$1.20', '105,000 tok (80,000 in, 25,000 out)', 'claude · claude-opus-5-20260101 (asked for claude-opus-5)'],
      ['Acceptance', '$0.30', '21,000 tok (20,000 in, 1,000 out)', 'claude · claude-sonnet-5 (requested — the CLI reported no model)'],
    ])

    // And the total the line recorded, beside the two rather than instead of
    // them: $1.20 + $0.30 is the $1.50 the journal has, and 105,000 + 21,000
    // the 126,000 — so a line whose two numbers disagree shows that it does.
    const lines = second.children.filter((child) => child.className === 'line').map((child) => child.textContent)
    assert.equal(lines[0], 'The run: $1.50 · 126,000 tok (100,000 in, 26,000 out)'
      + ' — the total the line recorded, which the two rows above come out of')

    // Tokens, how long it ran — from `started` and `finished`, not from this
    // machine's clock — how many attempts, and which gauge stage sent it back.
    const facts = second.all((n) => n.className === 'facts')[0].children.map((child) => child.textContent)
    assert.deepEqual(facts.slice(0, 5),
      ['✓passed', 'acme-api', '2 attempts', 'took 7m 30s', 'finished ' + new Date('2026-10-07T09:07:30Z').toLocaleString()])
    assert.match(second.textContent, /the exit gauge stopped on test/)

    // Whether it landed, and on what.
    assert.match(lines.join('\n'), /✓merged/)
    assert.match(lines.join('\n'), /commit abc1234/)
    assert.match(lines.join('\n'), /agent\/task-0001-first/)
    assert.match(lines.join('\n'), /acceptance: accepted/)
    assert.match(lines.join('\n'), /links: 2 checked/)
  })
})

test('a cost, a model or an instant the journal has as null is shown as not reported, never as zero', async () => {
  const s = ranAgain(queued(setup()))
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('queue', '0001') })
    await page.settle()

    // `setup`'s line has dollars and no tokens, no acceptance cost, no
    // acceptance model and no `started`. Every one of those says what it is: a
    // zero there would be a number nobody recorded, which is the one thing the
    // journal has always refused.
    const [first] = recordsIn(page)
    assert.deepEqual(rowsOf(first), [
      ['Pass', 'Cost', 'Tokens', 'Model'],
      ['Implementation', '$0.10', 'not reported', 'claude · claude-opus-5'],
      ['Acceptance', 'not reported', 'not reported', 'not reported'],
    ])
    assert.match(first.textContent, /took not reported/)
    assert.doesNotMatch(first.textContent, /\$0\.00|0 tok/)
    // And it is not the resumed one: `resumed` is read off the line.
    assert.doesNotMatch(first.textContent, /resumed/)
  })
})

test('a run that was resumed says so, because coming back from hold/ is a different story', async () => {
  const s = ranAgain(queued(setup()))
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('queue', '0001') })
    await page.settle()
    const [, second] = recordsIn(page)
    assert.match(second.textContent, /↻resumed — it carried on what an earlier run left behind/)
    // An icon and a word, never a colour alone.
    const resumed = second.all((n) => n.className === 'status info')[0]
    assert.equal(resumed.children[0].getAttribute('aria-hidden'), 'true')
  })
})

test('a task the journal has never seen says so, and grows no block of dashes', async () => {
  const s = queued(setup())
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('queue', '0003') })
    await page.settle()

    const block = blockNamed(page, 'What its attempts did')
    assert.equal(blocksOf(page)[0], 'What its attempts did', 'still the first block')
    assert.equal(recordsIn(page).length, 0, 'no run, and so no record of one')
    assert.match(block.textContent, /this task has not run — the journal has no line for it/)
    assert.equal(block.all((n) => n.tag === 'table').length, 0, 'no table, so no row of blanks to read as zeros')
    assert.doesNotMatch(block.textContent, /not reported|\$|tok|merged/, 'and no figure it has not got')
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
  // What a queue entry is: its identity, what the journal's last line for it
  // says, and whether it runs alone. Not its body, its goal or its criteria —
  // those are the detail, and the detail is fetched when a task is opened.
  for (const t of snap.queue.todo) {
    assert.deepEqual(Object.keys(t),
      ['id', 'slug', 'repo', 'outcome', 'reason', 'doubts', 'verdict', 'branch', 'attempts', 'cost', 'finished', 'touchesContract'])
  }
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
    const page = openPage(base, { hash: taskHash('queue', '0003') })
    await page.settle()

    // Under the task's own detail, in the drawer that task is opened in — and
    // it moved with the detail rather than becoming a block somewhere else: a
    // drawer is where it is drawn and not a change to how it is read (ADR 0022).
    assert.ok(DRAWER.indexOf('id="task-log-panel"') > DRAWER.indexOf('id="task-detail"'))
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
    const page = openPage(base, { hash: taskHash('queue', '0001') })
    await page.settle()
    assert.match(page.text('task-log-state'), /not running — this is what attempt 2 said, not something happening now/)

    // And a task nothing has run says that, rather than showing an empty box
    // that could be either.
    await page.go(taskHash('queue', '0004'))
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
    const page = openPage(base, { hash: taskHash('queue', '0003') })
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
    const page = openPage(base, { hash: taskHash('queue', '0003') })
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
    const page = openPage(base, { hash: taskHash('queue', '0003') })
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
    const page = openPage(base, { hash: taskHash('queue', '0003') })
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
    const page = openPage(base, { hash: taskHash('queue', '0003') })
    await page.settle()
    assert.match(page.text('task-log-state'), /running now in acme-api, attempt 1 — nothing is being written here: the run could not open a log, or detent prune has cleared it/)
  })
})

test('the page shows the end of the output, and does not grow with the run', async () => {
  const s = queued(setup())
  const lines = Array.from({ length: LOG_LINES + 200 }, (_, i) => ({ type: 'assistant', message: { content: [{ type: 'text', text: `line ${i}` }] } }))
  printing(s, '0003', 1, [...lines, { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(LOG_CLIP * 3) }] } }]).close()

  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('queue', '0003') })
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

// ——— The detail is a drawer over the section somebody was on (ADR 0022).

test('a task opens in a drawer over the section, and closing it gives back the list that was being read', async () => {
  const s = filled()
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: '#queue' })
    await page.settle()

    // Queue, before anything is opened, and the card a person is about to
    // click: the drawer is in the document and showing nothing.
    assert.equal(page.node('task-drawer').hidden, true)
    assert.equal(page.node('queue').hidden, false)
    const card = cardFor(page, 'done', '0005')
    const cards = page.node('done').children
    const read = page.reads.length

    // Opened by the fragment the card's own link carries.
    await page.go(card.all((n) => n.tag === 'a')[0].getAttribute('href'))
    await page.settle()
    assert.equal(page.node('task-drawer').hidden, false)
    assert.match(page.text('task-detail'), /^0005 · A task is something you can open/)

    // **And Queue is still Queue.** Not hidden, not drawn again, the same
    // nodes in the same order — so there is nothing to restore when the drawer
    // closes, which is the whole of what a drawer is for. Opening one read the
    // task and its log and nothing else: the snapshot the section was drawn
    // from was not asked for again.
    assert.equal(page.node('queue').hidden, false)
    assert.equal(page.node('done').children, cards, 'the folder was drawn again')
    assert.equal(cardFor(page, 'done', '0005'), card, 'the card is a different card')
    assert.deepEqual(page.reads.slice(read).map((r) => r.split('?')[0]), ['GET task.json', 'GET log.json'])

    // Closing rewrites the fragment to the bare section — leaving
    // #queue/task/0005 in the address bar after somebody closed it would be
    // the page lying about where they are — and moves nothing else.
    // By the control in its head, which says what it does: a panel covering
    // content with no obvious way back is worse than the section it covers.
    assert.match(DRAWER, /<button type="button" id="task-close"[^>]*>Close<\/button>/)
    await page.click('task-close')
    assert.equal(page.location.hash, '#queue')
    assert.equal(page.node('task-drawer').hidden, true)
    assert.equal(page.node('queue').hidden, false)
    assert.equal(cardFor(page, 'done', '0005'), card)
    assert.equal(page.node('done').children, cards)

    // The timer is still the one timer, and the drawer asked for no asset of
    // its own: it is a positioned element and a `hidden` attribute.
    assert.deepEqual(page.timers.map((t) => t.every), [POLL.every])
    assert.deepEqual([...new Set(page.reads.map((r) => r.split('?')[0]))].sort(),
      ['GET configuration.json', 'GET log.json', 'GET state.json', 'GET task.json'])
  })
})

test('Escape closes the drawer, and the way out is reachable on a screen the drawer fills', async () => {
  const s = filled()
  await dashboard(s, async (base) => {
    const page = openPage(base, { hash: taskHash('runs', '0005') })
    await page.settle()
    assert.equal(page.node('task-drawer').hidden, false)
    assert.equal(page.node('runs').hidden, false, 'Recent runs is behind it')

    await page.press('Escape')
    assert.equal(page.location.hash, '#runs')
    assert.equal(page.node('task-drawer').hidden, true)

    // A key that is not Escape is not a way out.
    await page.go(taskHash('runs', '0005'))
    await page.press('a')
    assert.equal(page.node('task-drawer').hidden, false)

    // And Escape with nothing open rewrites nothing: closing is the one thing
    // on this page that writes the fragment, and there is nothing to close.
    await page.press('Escape')
    await page.press('Escape')
    assert.equal(page.location.hash, '#runs')
  })

  // On a narrow screen the drawer is the screen — the section replacement this
  // decision exists to avoid, arriving through the viewport instead of through
  // the navigation. Said here rather than left to a width that happens to
  // overlap, with the head it is closed from stuck to the top so it stays
  // reachable however far down a task somebody has scrolled.
  assert.match(STYLE, /@media \(max-width: 760px\) \{ \.drawer \{ width: 100%/)
  assert.match(STYLE, /\.drawer-head \{ position: sticky; top: 0/)
  // And nothing in it moves of its own accord (ADR 0006).
  assert.doesNotMatch(STYLE, /\b(?:transition|animation)(?:-[a-z]+)?\s*:|@keyframes/)
})

test('a task opens from Overview, from any of the four folders and from Recent runs, each over its own section', async () => {
  const s = filled()
  claim(s.dir, 'acme-api', { task: '0003', branch: 'agent/task-0003-next' })
  await dashboard(s, async (base) => {
    const page = openPage(base)
    await page.settle()

    // Every list of tasks the page draws, and the section each is drawn in:
    // what is running, what is next and what is waiting in Overview, the four
    // folders in Queue, and the recent runs.
    const WHERE = [
      ['now', 'overview'], ['next-up', 'overview'], ['waiting', 'overview'],
      ['todo', 'queue'], ['hold', 'queue'], ['done', 'queue'], ['failed', 'queue'],
      ['recent', 'runs'],
    ]
    const opened = WHERE.map(([block, section]) => {
      const links = page.node(block).all((n) => n.tag === 'a')
        .map((n) => n.getAttribute('href')).filter((href) => href && href.includes('/' + TASK_PART + '/'))
      assert.ok(links.length > 0, `${block} lists no task that opens`)
      for (const href of links) assert.equal(sectionFor(href, SECTION_IDS), section, href)
      return [block, links[0]]
    })

    // And each one opens over the section it was opened from, which is still
    // the section showing — before the drawer and after it closes.
    for (const [block, href] of opened) {
      const section = sectionFor(href, SECTION_IDS)
      await page.go(href)
      await page.settle()
      assert.equal(page.node('task-drawer').hidden, false, block)
      assert.equal(page.node(section).hidden, false, block)
      assert.match(page.text('task-detail'), new RegExp('^' + taskFor(href, SECTION_IDS) + ' · '), block)
      await page.click('task-close')
      assert.equal(page.location.hash, '#' + section, block)
      assert.equal(page.node('task-drawer').hidden, true, block)
      assert.equal(page.node(section).hidden, false, block)
    }
  })
})

test('the fragment the detail shipped as a section names nothing now, and lands on a section', () => {
  // `#task/0043` went to the detail when it was the seventh section. It is a
  // drawer now, `task` is no section id, and the landing rule has it: a
  // section rather than nothing, and still not corrected (ADR 0022).
  assert.equal(sectionFor('#task/0043', SECTION_IDS), 'overview')
  assert.equal(taskFor('#task/0043', SECTION_IDS), null)
  assert.equal(sectionFor('#task', SECTION_IDS), 'overview')
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

// ——— The names on offer where a model is typed (ADR 0019).

// The list on the page is the file's or the shipped one, the input stays free
// text, and the line under it says the thing somebody had to ask for: where
// the names come from, where to add one, and that any name may be typed.
test('the model input is backed by the list and stays free text, and the page says where the list is', async () => {
  const s = configured()
  await onThePage(s, async (page) => {
    // Read with the rest of the configuration, from the file or from detent.
    assert.deepEqual(readConfiguration(s.dir).modelSuggestions, [...MODEL_SUGGESTIONS], 'a file that says nothing is offered the shipped list')

    // Nothing of it in the view: there is no model to type into there.
    assert.equal(page.node('config-models-note').hidden, true)
    assert.deepEqual(page.node('model-names').children, [])

    await page.click('config-edit')
    const names = page.node('model-names').children.map((option) => option.getAttribute('value'))
    assert.deepEqual(names, [...MODEL_SUGGESTIONS], 'the aliases lead, as shipped')

    // Every model input offers it, and every one of them is still free text.
    const inputs = [
      control(group(page, 'Models for the product'), 'implement', 'input'),
      control(group(page, 'Models for the product'), 'accept', 'input'),
      control(group(page, 'Models for acme-api'), 'implement', 'input'),
    ]
    for (const input of inputs) {
      assert.equal(input.getAttribute('list'), 'model-names')
      assert.equal(input.getAttribute('type'), 'text', 'a list to pick from, and anything may be typed')
      assert.match(input.getAttribute('placeholder'), /optional, a suggestion or any name/)
    }
    assert.deepEqual(group(page, 'Models for the product').tags('datalist'), [], 'one list for the page, not one per field')

    // The sentence the whole task exists to make unnecessary to ask for.
    assert.equal(page.node('config-models-note').hidden, false)
    const note = page.text('config-models-note')
    assert.match(note, /modelSuggestions in \.detent\/product\.json/, 'where the list comes from')
    assert.match(note, /yours to extend there/, 'and that it can be extended there')
    assert.match(note, /Any model name may be typed/, 'and that the list is not the limit')
    assert.match(note, /not what your account and your installed CLI can run between them/,
      'and it does not claim to be what the account can run')
  })
})

test('a file with its own list is offered that list and nothing else, and an empty one offers nothing', async () => {
  for (const [offered, shown] of [[['opus', 'mine-5'], ['opus', 'mine-5']], [[], []]]) {
    const s = configured()
    writeFileSync(file(s), JSON.stringify({ ...JSON.parse(readFileSync(file(s), 'utf8')), modelSuggestions: offered }, null, 2))
    assert.deepEqual(readConfiguration(s.dir).modelSuggestions, shown)
    await onThePage(s, async (page) => {
      await page.click('config-edit')
      assert.deepEqual(page.node('model-names').children.map((option) => option.getAttribute('value')), shown)
      // A name the shipped list has and this file does not stays removed.
      if (offered.length) assert.ok(!shown.includes('sonnet'), 'the shipped list is not merged back in')
      // And the sentence is there either way: an empty list is still a list
      // somebody can extend, and that is where it says to do it.
      assert.match(page.text('config-models-note'), /modelSuggestions in \.detent\/product\.json/)
    })
  }
})

test('a model the list does not offer is written from the page like any other', async () => {
  const s = configured()
  writeFileSync(file(s), JSON.stringify({ ...JSON.parse(readFileSync(file(s), 'utf8')), modelSuggestions: ['opus'] }, null, 2))
  await onThePage(s, async (page) => {
    await page.click('config-edit')
    control(group(page, 'Models for the product'), 'implement', 'input').value = 'a-model-nobody-ships'
    await page.click('config-save')

    assert.equal(page.editing(), false, 'the write went through — nothing checks a model against the list')
    assert.deepEqual(page.node('config-problems').children, [])
    const raw = JSON.parse(readFileSync(file(s), 'utf8'))
    assert.deepEqual(raw.models.implement, { agent: 'claude', model: 'a-model-nobody-ships' })
    assert.deepEqual(raw.modelSuggestions, ['opus'], 'and the list the page showed is not rewritten by showing it')
    // And a run would load it: the validator is the same code.
    assert.equal(loadProduct(s.dir).models.implement.model, 'a-model-nobody-ships')
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
