// The project's site: a landing page, and the real dashboard serving a product
// that does not exist.
//
// The demo is not a drawing of the dashboard. A product folder is made in a
// temporary directory — two repositories with a history, a queue in all four
// folders, a journal, a run that is still going and what its agent is saying —
// and `serve` from `core/commands/dashboard.mjs` is asked every question the
// page will ask. Its answers are written beside the page it served, and a few
// lines in front of the page's own script answer `fetch` from them. So the demo
// is what this version of the dashboard draws, and it cannot drift from it.
//
// Two things are the demo's own and nothing else's: its timestamps move with the
// clock, so "an hour ago" is still an hour ago when somebody opens it a month
// from now; and the running task's log arrives a line at a time, because
// watching it arrive is the point of that panel. Nothing is written: a Save on
// the page is answered the way the server answers a write it refuses.
//
// Usage: node scripts/build-site.mjs [out]   (out defaults to _site)

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { serve } from '../core/commands/dashboard.mjs'
import { git } from '../core/git.mjs'
import { appendJournal } from '../core/journal.mjs'
import { loadProduct } from '../core/product.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(root, '_site'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// What the demo calls the folder it was built in. The real one is a temporary
// directory, and its name is noise on a page somebody is reading.
const SHOWN_DIR = '~/work/acme'

const NOW = Date.now()
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

// ── the product ────────────────────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'detent-demo-'))

const GAUGE = {
  'acme-api': [
    { stage: 'lint', command: 'npm run lint' },
    { stage: 'typecheck', command: 'npm run typecheck' },
    { stage: 'test', command: 'npm test' },
  ],
  'acme-web': [
    { stage: 'lint', command: 'npm run lint' },
    { stage: 'test', command: 'npm test' },
    { stage: 'build', command: 'npm run build' },
  ],
}

function repository(name, landed, human) {
  const repoDir = join(dir, name)
  mkdirSync(repoDir)
  const sh = (...args) => git(repoDir, args)
  sh('init', '--quiet', '--initial-branch=dev')
  sh('config', 'user.name', 'Person')
  sh('config', 'user.email', 'person@example.com')
  sh('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repoDir, 'README.md'), `${name}\n`)
  sh('add', '.')
  sh('commit', '--quiet', '-m', 'init')
  sh('branch', 'agent/dev', 'dev')

  // Tasks that landed on agent/dev and are waiting for a person to take them.
  sh('switch', '--quiet', 'agent/dev')
  for (const [id, slug] of landed) {
    sh('switch', '--quiet', '-c', `agent/task-${id}-${slug}`, 'agent/dev')
    writeFileSync(join(repoDir, `${slug}.txt`), `${slug}\n`)
    sh('add', '.')
    sh('commit', '--quiet', '-m', `feat: ${slug.replaceAll('-', ' ')}\n\nTask: ${id}`)
    sh('switch', '--quiet', 'agent/dev')
    sh('merge', '--quiet', '--no-ff', '-m', `merge: task ${id} — ${slug}\n\nTask: ${id}`, `agent/task-${id}-${slug}`)
  }

  // And a person's work on dev that agent/dev has not seen yet.
  sh('switch', '--quiet', 'dev')
  for (const subject of human) {
    writeFileSync(join(repoDir, 'CHANGELOG.md'), `${subject}\n`)
    sh('add', '.')
    sh('commit', '--quiet', '-m', subject)
  }
  sh('switch', '--quiet', 'agent/dev')
}

repository('acme-api', [['0009', 'rate-limit-quotes'], ['0011', 'carrier-webhooks']], ['fix: a typo in the pricing doc'])
repository('acme-web', [['0010', 'quote-form-validation']], [])

mkdirSync(join(dir, '.detent'))
writeFileSync(join(dir, '.detent', 'product.json'), `${JSON.stringify({
  version: 1,
  product: { name: 'acme', summary: 'freight marketplace' },
  queue: 'tasks',
  concurrency: 2,
  attempts: 3,
  timeout: 30,
  notify: {
    events: ['paused', 'passed'],
    channels: [
      { kind: 'command', command: 'notify-send detent "$DETENT_MESSAGE"' },
      { kind: 'telegram', chat: '-1001234567890', tokenEnv: 'ACME_TELEGRAM_TOKEN' },
    ],
  },
  models: {
    implement: { agent: 'claude', model: 'claude-sonnet-5' },
    accept: { agent: 'claude', model: 'claude-opus-5' },
  },
  repos: Object.entries(GAUGE).map(([name, exit]) => ({
    name,
    compare: 'dev',
    role: name === 'acme-api' ? 'REST API, owns the database schema' : 'the customer-facing web app',
    gauge: { exit, merge: [], promote: [] },
  })),
}, null, 2)}\n`)

// ── the queue ──────────────────────────────────────────────────────────────

const TASKS = [
  ['todo', '0015', 'acme-api', 'invoice-pdf', 'Shippers can download an invoice for a delivered load as a PDF.',
    ['GET /loads/:id/invoice returns application/pdf for a delivered load', 'a load that is not delivered gets 409 and a sentence saying why', 'the PDF carries the totals the quote showed'],
    ['emailing the invoice'], false],
  ['todo', '0016', 'acme-web', 'invoice-button', 'The load page offers the invoice once the load is delivered.',
    ['the button appears only on a delivered load', 'it downloads what the API serves, and shows its error otherwise'],
    ['a preview of the PDF'], false],
  ['todo', '0017', 'acme-api', 'quote-currency', 'A quote carries its currency, and every endpoint that returns money says which.',
    ['quotes.currency is a column with a migration', 'every money field in the OpenAPI document names its currency', 'existing quotes are USD'],
    ['conversion between currencies'], true],
  ['hold', '0013', 'acme-api', 'carrier-rating', 'Shippers can rate a carrier after a delivery, once per load.',
    ['POST /loads/:id/rating stores a 1–5 rating', 'a second rating on the same load is refused', 'the carrier profile shows the average'],
    ['rating shippers'], false],
  ['hold', '0014', 'acme-web', 'tracking-map', 'The load page shows where the truck is, refreshed while the page is open.',
    ['a map with the last reported position', 'it refreshes every 30 seconds without reloading the page', 'a load with no position says so instead of an empty map'],
    ['history of the route'], false],
  ['done', '0009', 'acme-api', 'rate-limit-quotes', 'Quote requests are limited per shipper so one integration cannot starve the rest.',
    ['60 requests a minute per API key', '429 with Retry-After past the limit'], ['per-endpoint limits'], false],
  ['done', '0010', 'acme-web', 'quote-form-validation', 'The quote form says what is wrong with a field before it is sent.',
    ['weight, dimensions and dates are checked as they are typed', 'the server\'s own error is shown when it disagrees'], ['a redesign of the form'], false],
  ['done', '0011', 'acme-api', 'carrier-webhooks', 'Carriers get a webhook when a load they bid on is awarded.',
    ['a signed POST to the carrier\'s URL', 'three retries with backoff, then the attempt is recorded'], ['a UI for webhook settings'], false],
  ['failed', '0012', 'acme-api', 'legacy-import', 'Loads from the old system are imported with their history.',
    ['every load in the export is imported once', 'status history keeps its timestamps'], ['users and companies'], false],
]

for (const [folder, id, repo, slug, goal, criteria, outOfScope, contract] of TASKS) {
  mkdirSync(join(dir, 'tasks', folder), { recursive: true })
  writeFileSync(join(dir, 'tasks', folder, `${id}-${slug}.md`), [
    '---', `id: ${id}`, `repo: ${repo}`, `touches_contract: ${contract}`, '---', '',
    '# Goal', '', goal, '',
    '# Acceptance criteria', '', ...criteria.map((c) => `- [ ] ${c}`), '',
    '# Out of scope', '', ...outOfScope.map((o) => `- ${o}`), '',
  ].join('\n'))
}
for (const folder of ['todo', 'hold', 'done', 'failed']) mkdirSync(join(dir, 'tasks', folder), { recursive: true })

// ── the journal ────────────────────────────────────────────────────────────

const model = (actual) => ({ agent: 'claude', requested: actual, actual })
const tokens = (usd) => ({ input: Math.round(usd * 420_000), output: Math.round(usd * 14_000) })
const round = (attempt, usd, { failedStage = null, verdict = 'accepted', doubts = [] } = {}) => ({
  attempt,
  gauge: { profile: 'exit', green: failedStage === null, failedStage },
  acceptance: failedStage === null ? { verdict, doubts } : null,
  cost: { usd, tokens: tokens(usd) },
})

function run({ task, slug, repo, outcome, implement = 'claude-sonnet-5', started, minutes, rounds, reason = null, merged = false }) {
  const last = rounds.at(-1)
  const usd = Math.round(rounds.reduce((t, r) => t + r.cost.usd, 0) * 100) / 100
  appendJournal(dir, {
    kind: 'task', task, slug, repo,
    started: ago(started), finished: ago(started - minutes),
    outcome, ...(reason ? { reason } : {}),
    attempts: rounds.length,
    lock: 'enforced',
    gauge: { profile: 'exit', failedStage: last.gauge.failedStage },
    models: { implement: model(implement), accept: model('claude-opus-5') },
    acceptance: last.acceptance ? { ...last.acceptance, cost: { usd: 0.06, tokens: { input: 21_004, output: 312 } } } : { verdict: 'absent', doubts: [] },
    rounds,
    links: { checked: 2, broken: [] },
    cost: { usd, tokens: tokens(usd) },
    branch: `agent/task-${task}-${slug}`,
    ...(merged ? { commit: 'a1b2c3d', merged: true } : {}),
  })
}

run({ task: '0009', slug: 'rate-limit-quotes', repo: 'acme-api', outcome: 'passed', started: 3 * 1440, minutes: 9, rounds: [round(1, 0.42)], merged: true })
run({ task: '0010', slug: 'quote-form-validation', repo: 'acme-web', outcome: 'passed', implement: 'claude-opus-5', started: 2 * 1440 + 300, minutes: 14,
  rounds: [round(1, 0.61, { failedStage: 'test' }), round(2, 0.55)], merged: true })
run({ task: '0011', slug: 'carrier-webhooks', repo: 'acme-api', outcome: 'passed', started: 2 * 1440, minutes: 21,
  rounds: [round(1, 0.38, { verdict: 'rejected', doubts: ['the retries are not covered by a test: nothing fails if the backoff is removed'] }), round(2, 0.33)], merged: true })
run({ task: '0012', slug: 'legacy-import', repo: 'acme-api', outcome: 'escalated', started: 1440 + 200, minutes: 38,
  reason: 'three identical failures on test', rounds: [round(1, 0.71, { failedStage: 'test' }), round(2, 0.66, { failedStage: 'test' }), round(3, 0.69, { failedStage: 'test' })] })
run({ task: '0013', slug: 'carrier-rating', repo: 'acme-api', outcome: 'rejected', started: 300, minutes: 26,
  reason: 'the acceptance pass raised a doubt on the last attempt',
  rounds: [
    round(1, 0.29, { failedStage: 'typecheck' }),
    round(2, 0.31, { verdict: 'rejected', doubts: ['a second rating on the same load is accepted: the uniqueness is checked in the handler, not the database, and two requests at once both pass'] }),
    round(3, 0.27, { verdict: 'rejected', doubts: ['the average on the carrier profile is computed over all loads, not over rated ones'] }),
  ] })
run({ task: '0014', slug: 'tracking-map', repo: 'acme-web', outcome: 'escalated', started: 140, minutes: 31,
  reason: 'three failures on build', rounds: [round(1, 0.48, { failedStage: 'build' }), round(2, 0.51, { failedStage: 'build' }), round(3, 0.5, { failedStage: 'build' })] })
run({ task: '0008', slug: 'shipper-search', repo: 'acme-web', outcome: 'passed', implement: 'claude-opus-5', started: 4 * 1440, minutes: 11, rounds: [round(1, 0.74)], merged: true })
appendJournal(dir, {
  kind: 'promote', repo: 'acme-api', started: ago(1440 + 30), finished: ago(1440 + 18), outcome: 'passed',
  tasks: ['0009', '0011'], gauge: { profile: 'promote', failedStage: null }, branch: 'agent/staging', lock: 'enforced',
})

// ── a run that is still going ──────────────────────────────────────────────
//
// Task 0015 on acme-api, on its second attempt, its agent talking. The claim
// names this process, which is alive for as long as the questions are asked.

writeFileSync(join(dir, '.detent', 'state.json'), `${JSON.stringify({
  version: 1,
  repos: { 'acme-api': { task: '0015', branch: 'agent/task-0015-invoice-pdf', attempt: 2, started: ago(12), pid: process.pid } },
}, null, 2)}\n`)

const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const use = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const back = (content) => ({ type: 'user', message: { content: [{ type: 'tool_result', content }] } })
const thinking = { type: 'assistant', message: { content: [] } }

const FIRST = [
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
  say('Reading the task and the loads module before changing anything.'),
  use('Read', { file_path: 'src/loads/loads.controller.ts' }),
  back('export class LoadsController { … }'),
  use('Write', { file_path: 'src/loads/invoice.ts' }),
  back('File created'),
  say('The endpoint is in place. Running the tests.'),
  use('Bash', { command: 'npm test -- loads' }),
  back('Tests: 41 passed, 41 total'),
  { type: 'result', subtype: 'success', total_cost_usd: 0.3912 },
]
const SECOND = [
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
  say('The gauge failed on typecheck: `Invoice.total` is a string in the PDF builder and a number in the quote. Fixing the type at the source.'),
  use('Grep', { pattern: 'total:', path: 'src' }),
  back('src/quotes/quote.ts:14:  total: number\nsrc/loads/invoice.ts:22:  total: string'),
  thinking, thinking, thinking,
  use('Edit', { file_path: 'src/loads/invoice.ts' }),
  back('The file src/loads/invoice.ts has been updated.'),
  say('A load that is not delivered still returns 500 from the PDF builder. The criteria ask for 409 and a sentence.'),
  use('Edit', { file_path: 'src/loads/loads.controller.ts' }),
  back('The file src/loads/loads.controller.ts has been updated.'),
  use('Write', { file_path: 'test/loads/invoice.test.ts' }),
  back('File created'),
  thinking, thinking,
  use('Bash', { command: 'npm run typecheck' }),
  back('tsc --noEmit\n(no output)'),
  use('Bash', { command: 'npm test -- invoice' }),
  back('✓ returns a PDF for a delivered load\n✓ refuses a load that is not delivered with 409\n✓ carries the totals the quote showed\nTests: 3 passed, 3 total'),
  say('Typecheck is clean and the three criteria each have a test. Checking that the totals are formatted the way the quote shows them.'),
  use('Read', { file_path: 'src/quotes/format.ts' }),
  back('export const money = (n, currency = "USD") => …'),
  thinking, thinking, thinking, thinking,
  use('Edit', { file_path: 'src/loads/invoice.ts' }),
  back('The file src/loads/invoice.ts has been updated.'),
  use('Bash', { command: 'npm test' }),
  back('Tests: 213 passed, 213 total'),
  say('Done: the invoice uses the quote\'s own formatter, the 409 has a sentence, and every criterion is under a test.'),
]

const lines = (events) => events.map((e) => `${JSON.stringify(e)}\n`).join('')
mkdirSync(join(dir, 'runs', 'logs'), { recursive: true })
writeFileSync(join(dir, 'runs', 'logs', '0015-attempt-1.jsonl'), lines(FIRST))
// What is on disk when the page opens: the start of the second attempt. The
// rest arrives on the page, a line at a time.
const SHOWN = 4
writeFileSync(join(dir, 'runs', 'logs', '0015-attempt-2.jsonl'), lines(SECOND.slice(0, SHOWN)))

// And an earlier task's last attempt, for a drawer opened on something finished.
writeFileSync(join(dir, 'runs', 'logs', '0013-attempt-3.jsonl'), lines([
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
  say('The reviewer says a second rating on the same load is accepted under concurrency. Moving the check into a unique index.'),
  use('Write', { file_path: 'migrations/0042_rating_unique.sql' }),
  back('File created'),
  use('Bash', { command: 'npm test -- rating' }),
  back('Tests: 7 passed, 7 total'),
  { type: 'result', subtype: 'success', total_cost_usd: 0.2704 },
]))

// ── asking the dashboard ───────────────────────────────────────────────────

const product = loadProduct(dir)
const server = await serve(product, { port: 0 })
const base = `http://127.0.0.1:${server.address().port}`
const ask = async (path) => {
  const response = await fetch(base + path)
  return { status: response.status, body: await response.text() }
}

// Every path the page fetches, under the name it fetches it by.
const answers = {}
const page = (await ask('/')).body
for (const path of ['state.json', 'configuration.json']) answers[path] = await ask(`/${path}`)
for (const [, id] of TASKS) {
  for (const number of [id, String(Number(id))]) {
    answers[`task.json?task=${number}`] = await ask(`/task.json?task=${number}`)
    answers[`log.json?task=${number}`] = await ask(`/log.json?task=${number}`)
  }
}
server.close()

// The temporary directory is replaced by the name a reader expects, and the
// clock the answers were taken at travels with them.
const scrub = (text) => text.replaceAll(JSON.stringify(dir).slice(1, -1), SHOWN_DIR).replaceAll(dir, SHOWN_DIR)
for (const answer of Object.values(answers)) answer.body = scrub(answer.body)

const LIVE = { task: '0015', attempt: 2, shown: SHOWN, lines: SECOND.map((e) => JSON.stringify(e)) }

rmSync(dir, { recursive: true, force: true })

// ── the static page ────────────────────────────────────────────────────────

const SHIM = `
// The static demo's server: every answer the real one gave when this page was
// built, with its timestamps moved to now. Generated by scripts/build-site.mjs.
;(() => {
  const BUILT = ${NOW}
  const ANSWERS = ${JSON.stringify(answers)}
  const LIVE = ${JSON.stringify(LIVE)}
  const OPENED = Date.now()
  const SHIFT = OPENED - BUILT
  const ISO = /"(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z)"/g
  const moved = (text) => text.replace(ISO, (_, at) => JSON.stringify(new Date(Date.parse(at) + SHIFT).toISOString()))
  const reply = (status, body) => Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }))

  // The running task's second attempt, a line every few seconds; offsets are
  // characters of the whole transcript, which only this page ever reads.
  const STEP = 2600
  const transcript = LIVE.lines.map((line) => line + '\\n')
  const at = (n) => transcript.slice(0, n).join('').length
  const arrived = () => Math.min(transcript.length, LIVE.shown + Math.floor((Date.now() - OPENED) / STEP))
  function live(from) {
    const n = arrived()
    const to = at(n)
    const start = from !== null && from >= 0 && from <= to ? from : 0
    const lastAt = n >= transcript.length ? OPENED + (transcript.length - LIVE.shown) * STEP : OPENED + (n - LIVE.shown) * STEP
    return {
      task: LIVE.task,
      running: { repo: 'acme-api', attempt: LIVE.attempt },
      attempt: LIVE.attempt,
      file: '${SHOWN_DIR}/runs/logs/' + LIVE.task + '-attempt-' + LIVE.attempt + '.jsonl',
      quiet: Math.max(0, Date.now() - lastAt),
      from: start,
      to,
      text: transcript.join('').slice(start, to),
    }
  }

  const READ_ONLY = JSON.stringify({ refused: 'origin', message: 'This is a demo on made-up data, and nothing on it is written. On your own product, detent dashboard writes product.json between runs.' })

  window.fetch = (input, init = {}) => {
    const url = new URL(String(input), location.href)
    const name = url.pathname.split('/').pop()
    if ((init.method || 'GET').toUpperCase() !== 'GET') return reply(403, READ_ONLY)
    if (name === 'log.json') {
      const task = url.searchParams.get('task')
      if (task !== null && Number(task) === Number(LIVE.task)) {
        const from = url.searchParams.get('from')
        return reply(200, JSON.stringify(live(from === null ? null : Number(from))))
      }
      const found = ANSWERS['log.json?task=' + task]
      return found ? reply(found.status, moved(found.body)) : reply(404, '{"refused":"unknown"}')
    }
    const key = name === 'task.json' ? 'task.json?task=' + url.searchParams.get('task') : name
    const found = ANSWERS[key]
    if (!found) return reply(404, JSON.stringify({ refused: 'unknown', message: 'there is no such task in this demo' }))
    return reply(found.status, moved(found.body))
  }
})()
`

const BANNER = `<div style="font:13px/1.4 system-ui,sans-serif;padding:8px 16px;background:#1f2937;color:#f9fafb;text-align:center">
Demo of <code>detent dashboard</code> ${pkg.version}, on a made-up product. Nothing here is written. · <a href="../" style="color:#93c5fd">back to the overview</a>
</div>`

// The landing page's icon, so the demo tab belongs to the same site. It is
// added here rather than to the page itself: the dashboard a person runs is
// served under a policy that allows no images at all, not even a data URI
// (`core/commands/dashboard.mjs`), and a favicon is not worth widening it.
const ICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%232f5bd3'/><rect x='6' y='11' width='11' height='10' rx='2.5' fill='%23fff'/><rect x='21' y='5' width='5' height='22' rx='2.5' fill='%23fff'/></svg>">`

const demo = page
  .replace('<title>detent</title>', `<title>detent — dashboard demo</title>\n${ICON}`)
  .replace('<body>\n', `<body>\n${BANNER}\n`)
  .replace('<script>\n', () => `<script>\n${SHIM}\n`)

if (demo === page || !demo.includes('window.fetch =')) throw new Error('the dashboard page no longer has the shape this script inserts into')

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'demo'), { recursive: true })
cpSync(join(root, 'site'), out, { recursive: true })
writeFileSync(join(out, 'index.html'), readFileSync(join(root, 'site', 'index.html'), 'utf8').replaceAll('{{version}}', pkg.version))
writeFileSync(join(out, 'demo', 'index.html'), demo)
process.stdout.write(`site written to ${out}\n`)
