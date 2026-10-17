// The two questions `init` asks (ADR 0014): the asker itself, each question on
// its own, and `init` driven through both with no terminal anywhere near the
// test — which is also the thing most worth proving, since a question nobody
// is there to answer must not wait.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { ask, askDocs, askQueue } from '../core/ask.mjs'
import { PROPOSED_FILE, run } from '../core/commands/init.mjs'
import { PRODUCT_FILE } from '../core/product.mjs'

function repo(dir, name, files = {}) {
  const at = join(dir, name)
  mkdirSync(at)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: at })
  for (const [path, text] of Object.entries(files)) writeFileSync(join(at, path), text)
  execFileSync('git', ['-c', 'user.name=P', '-c', 'user.email=p@x', 'commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: at })
  return at
}

// A product folder nobody has run init in yet: repositories side by side, and
// no product.json to answer anything.
function shop(names = ['agent-loop', 'shop-api', 'shop-docs']) {
  const dir = join(mkdtempSync(join(tmpdir(), 'detent-ask-')), 'shop')
  mkdirSync(dir)
  for (const name of names) repo(dir, name, { 'README.md': `# ${name}\n` })
  return dir
}

// An asker reading from a script: every question it was given, in order, and
// one answer each. `null` in the script is nobody there.
function answering(...script) {
  const prompts = []
  return {
    prompts,
    ask: (text) => {
      prompts.push(text)
      return Promise.resolve(script.length ? script.shift() : null)
    },
  }
}

// `init`, with the terminal replaced by the script and the model pass off: the
// questions are not the model pass, and mixing them would prove neither.
async function init(dir, values = {}, asker = answering()) {
  const out = []
  const write = process.stdout.write
  process.stdout.write = (chunk) => (out.push(String(chunk)), true)
  try {
    const code = await run(dir, [], { 'no-agent': true, ...values }, { ask: asker.ask })
    return { code, out: out.join(''), prompts: asker.prompts }
  } finally {
    process.stdout.write = write
  }
}

function written(dir) {
  return JSON.parse(readFileSync(join(dir, PRODUCT_FILE), 'utf8'))
}

// --- the asker ----------------------------------------------------------------

test('the asker: a terminal is read, and anything else is nobody to answer', async () => {
  const output = new PassThrough()
  const shown = []
  output.on('data', (chunk) => shown.push(String(chunk)))

  const terminal = new PassThrough()
  terminal.isTTY = true
  terminal.setRawMode = () => terminal
  const answer = ask('which one? ', { input: terminal, output })
  terminal.write('  shop-docs  \n')
  assert.equal(await answer, 'shop-docs', 'the line, trimmed')
  assert.match(shown.join(''), /which one\? /, 'and the question was asked')

  // A pipe, a cron entry, a CI step: there is no terminal, so there is no
  // question — not a question with nobody to answer it.
  const piped = new PassThrough()
  let asked = false
  piped.on('data', () => (asked = true))
  assert.equal(await ask('which one? ', { input: piped, output }), null)
  assert.equal(asked, false, 'and nothing was read')

  // Ctrl-D is an answer too, and what it says is "stop asking me".
  const gone = new PassThrough()
  gone.isTTY = true
  gone.setRawMode = () => gone
  const interrupted = ask('which one? ', { input: gone, output })
  gone.end()
  assert.equal(await interrupted, null)
})

// --- each question ------------------------------------------------------------

test('the queue: a number, a name, a path, or enter for the default', async () => {
  const repos = ['agent-loop', 'shop-api']

  const byNumber = answering('2')
  assert.equal((await askQueue({ ask: byNumber.ask, repos })).value, 'agent-loop/tasks')
  assert.match(byNumber.prompts[0], /^\n.*queue/s)
  assert.match(byNumber.prompts[0], /^ {2}1 {2}tasks +beside the repositories/m, 'the default is a row, named')
  assert.match(byNumber.prompts[0], /^ {2}2 {2}agent-loop\/tasks/m, 'and every repository the scan found is one')
  assert.match(byNumber.prompts[0], /^ {2}3 {2}shop-api\/tasks/m)

  const byName = answering('agent-loop')
  const named = await askQueue({ ask: byName.ask, repos })
  assert.equal(named.value, 'agent-loop/tasks', 'a repository can be answered by name')
  assert.match(named.note, /the queue: agent-loop\/tasks — in agent-loop, which stops being a repository of the product/)

  assert.equal((await askQueue({ ask: answering('vendor/queue').ask, repos })).value, 'vendor/queue', 'a path answers too')
  assert.equal((await askQueue({ ask: answering('../elsewhere', '').ask, repos })).value, 'tasks', 'and one that escapes the product folder is not a path')

  const enter = answering('')
  const taken = await askQueue({ ask: enter.ask, repos })
  assert.equal(taken.value, 'tasks')
  assert.match(taken.note, /the queue: tasks — beside the repositories, in the product folder \(the default: enter was pressed\)/)

  const flagged = await askQueue({ repos, flag: 'agent-loop/queue', ask: () => assert.fail('a flag is an answer, not a suggestion') })
  assert.equal(flagged.value, 'agent-loop/queue')
  assert.match(flagged.note, /--queue said so/)
})

test('the documents: none is the default, and an answer', async () => {
  const repos = ['shop-api', 'shop-docs']

  const enter = answering('')
  const none = await askDocs({ ask: enter.ask, repos })
  assert.equal(none.value, null)
  assert.match(enter.prompts[0], /^ {2}1 {2}none +no documents repository/m)
  assert.match(enter.prompts[0], /^ {2}3 {2}shop-docs$/m)
  assert.match(none.note, /the documents: none — no documents repository \(the default: enter was pressed\)/)

  assert.equal((await askDocs({ ask: answering('3').ask, repos })).value, 'shop-docs')
  assert.equal((await askDocs({ ask: answering('shop-docs').ask, repos })).value, 'shop-docs')
  assert.equal((await askDocs({ ask: answering('none').ask, repos })).value, null, 'none typed is none chosen')

  // Nothing here is called that, and a typo is not a decision: it is asked
  // again, and the second question says what was not understood.
  const complained = answering('shop-dcos', '3')
  assert.equal((await askDocs({ ask: complained.ask, repos })).value, 'shop-docs')
  assert.match(complained.prompts[1], /^ *"shop-dcos" is not one of these\./m)

  // Not forever, though: three answers it cannot read and the default is
  // taken, because a person who does not know has to get out of the question.
  const stuck = answering('a', 'b', 'c')
  const gave = await askDocs({ ask: stuck.ask, repos })
  assert.equal(gave.value, null)
  assert.equal(stuck.prompts.length, 3)
  assert.match(gave.note, /the default: 3 answers I could not read/)

  const flagged = await askDocs({ repos, flag: 'none', ask: () => assert.fail('a flag is an answer') })
  assert.equal(flagged.value, null)
  assert.match(flagged.note, /the documents: none — no documents repository \(--docs none said so/)
})

// --- init, through both questions ---------------------------------------------

test('init asks both questions, and the answers are what it writes', async () => {
  const dir = shop()
  const asker = answering('agent-loop', 'shop-docs')
  const { code, out, prompts } = await init(dir, {}, asker)

  assert.equal(code, 0)
  assert.equal(prompts.length, 2, 'two questions, no more')
  const file = written(dir)
  assert.equal(file.queue, 'agent-loop/tasks')
  assert.equal(file.docs, 'shop-docs')
  assert.deepEqual(file.repos.map((r) => r.name), ['shop-api', 'shop-docs'], 'the repository that holds the queue is the queue, and not one of them')
  assert.deepEqual(readdirSync(join(dir, 'agent-loop', 'tasks')).sort(), ['done', 'failed', 'hold', 'todo'], 'and the queue is created where the answer put it')
  assert.equal(existsSync(join(dir, 'tasks')), false)
  assert.match(out, /^ {2}the queue: agent-loop\/tasks — in agent-loop/m)
  assert.match(out, /^ {2}the documents: shop-docs$/m)
})

test('enter answers both, and a person who presses it is told what they got', async () => {
  const dir = shop()
  const { code, out } = await init(dir, {}, answering('', ''))

  assert.equal(code, 0)
  assert.match(out, /^ {2}the queue: tasks — beside the repositories, in the product folder \(the default: enter was pressed\)$/m)
  assert.match(out, /^ {2}the documents: none — no documents repository \(the default: enter was pressed\)$/m)
  const file = written(dir)
  assert.equal(file.queue, 'tasks')
  assert.equal(file.docs, null, 'none is written, because an answer recorded is an answer nobody gives twice')
  assert.deepEqual(readdirSync(join(dir, 'tasks')).sort(), ['done', 'failed', 'hold', 'todo'])
})

test('--queue and --docs answer the same questions, and nothing is asked', async () => {
  const dir = shop()
  const asker = { prompts: [], ask: () => assert.fail('a flag is an answer, not a suggestion') }
  const { code, out } = await init(dir, { queue: 'agent-loop/queue', docs: 'shop-docs' }, asker)

  assert.equal(code, 0)
  const file = written(dir)
  assert.equal(file.queue, 'agent-loop/queue')
  assert.equal(file.docs, 'shop-docs')
  assert.deepEqual(readdirSync(join(dir, 'agent-loop', 'queue')).sort(), ['done', 'failed', 'hold', 'todo'])
  assert.match(out, /^ {2}the queue: agent-loop\/queue — in agent-loop, which stops being a repository of the product \(--queue said so/m)
  assert.match(out, /^ {2}the documents: shop-docs \(--docs shop-docs said so/m)

  // A name nobody here has is a usage message, like any other bad flag.
  await assert.rejects(() => init(shop(), { docs: 'shop-dcos' }, answering()), /no repository called that here — agent-loop, shop-api, shop-docs, or none/)
})

test('--docs none says there are none', async () => {
  const dir = shop()
  const { code, out } = await init(dir, { docs: 'none' }, answering(''))

  assert.equal(code, 0)
  assert.equal(written(dir).docs, null)
  assert.match(out, /^ {2}the documents: none — no documents repository \(--docs none said so/m)
})

test('with no terminal, init never waits: it takes the defaults and prints what it took', async () => {
  const dir = shop()
  // The asker init really uses, with the one thing a pipeline differs by: no
  // terminal on stdin. Nothing else about this run is pretended.
  const piped = new PassThrough()
  let read = false
  piped.on('data', () => (read = true))
  const asker = { prompts: [], ask: (text) => ask(text, { input: piped, output: new PassThrough() }) }

  const { code, out } = await init(dir, {}, asker)

  assert.equal(code, 0)
  assert.equal(read, false, 'nothing was read, so there was nothing to wait for')
  assert.match(out, /^ {2}the queue: tasks — beside the repositories, in the product folder \(the default: nobody is on stdin to answer\)$/m)
  assert.match(out, /^ {2}the documents: none — no documents repository \(the default: nobody is on stdin to answer\)$/m)
  assert.doesNotMatch(out, /^> $/m, 'and no question was printed to nobody')
  assert.match(out, /^wrote \.detent\/product\.json — 3 repositories/m, 'everything else is the run it always was')
  assert.equal(written(dir).queue, 'tasks')
  assert.equal(written(dir).docs, null)
})

test('a terminal that goes away is not asked the second question', async () => {
  const dir = shop()
  // Ctrl-D at the first question, and then nothing: the second question is not
  // printed to an empty room, and — the way this used to hang — not asked of
  // an input that has nothing left to give.
  const asker = answering(null)
  const { code, out, prompts } = await init(dir, {}, asker)

  assert.equal(code, 0)
  assert.equal(prompts.length, 1, 'asked once, told once')
  assert.match(out, /^ {2}the queue: tasks — .*\(the default: nobody is on stdin to answer\)$/m)
  assert.match(out, /^ {2}the documents: none — .*\(the default: nobody is on stdin to answer\)$/m)
  assert.equal(written(dir).docs, null)
})

test('a file that already answers is not asked again', async () => {
  const dir = shop()
  await init(dir, {}, answering('agent-loop', 'shop-docs'))

  const again = await init(dir, {}, { prompts: [], ask: () => assert.fail('asked about something the file answers') })
  assert.equal(again.code, 0)
  assert.match(again.out, /^ {2}the queue: agent-loop\/tasks — \.detent\/product\.json already says so, so you were not asked$/m)
  assert.match(again.out, /^ {2}the documents: shop-docs — \.detent\/product\.json already says so, so you were not asked$/m)
  assert.match(again.out, /already says everything the scan found/, 'and the answers changed nothing')
})

test('an answer that moves the queue is scanned again, both ways', async () => {
  const dir = shop()
  await init(dir, { queue: 'agent-loop/tasks', docs: 'none' }, answering())
  assert.deepEqual(written(dir).repos.map((r) => r.name), ['shop-api', 'shop-docs'])

  // Moved back out by a flag: agent-loop is a repository of the product again,
  // and the scan that skipped it is the reason it has to be read twice.
  const moved = await init(dir, { queue: 'tasks' }, answering())
  assert.equal(moved.code, 0)
  const proposed = JSON.parse(readFileSync(join(dir, PROPOSED_FILE), 'utf8'))
  assert.equal(proposed.queue, 'tasks', 'the flag is the answer, over what the file says')
  assert.deepEqual(proposed.repos.map((r) => r.name), ['shop-api', 'shop-docs', 'agent-loop'])
  assert.equal(written(dir).queue, 'agent-loop/tasks', 'and nothing a person wrote was overwritten')
})

test('the queue cannot be the whole product', async () => {
  const dir = shop(['only-repo'])
  const stderr = []
  const write = process.stderr.write
  process.stderr.write = (chunk) => (stderr.push(String(chunk)), true)
  let result
  try {
    result = await init(dir, { queue: 'only-repo/tasks' }, answering())
  } finally {
    process.stderr.write = write
  }
  assert.equal(result.code, 1)
  assert.match(stderr.join(''), /the queue went into only-repo, the only repository in .* — a product needs one that is not the queue/)
  assert.equal(existsSync(join(dir, PRODUCT_FILE)), false)
})
