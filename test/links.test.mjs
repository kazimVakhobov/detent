// A task's links, checked against the documents the repository has mounted
// (ADR 0014, part 4). Two halves: what counts as a link, and what a broken one
// does to a run — which is everything except stop it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotRefs } from '../core/git.mjs'
import { checkLinks, taskLinks } from '../core/links.mjs'
import { readJournal } from '../core/journal.mjs'
import { runTask } from '../core/run.mjs'
import { readQueue } from '../core/task.mjs'
import { assertInvariant, gitProduct, notifier, sharedContext, sh } from './support/product.mjs'

const BRANCH = 'agent/task-0042-wallet-endpoint'
const GAUGE = { exit: [{ stage: 'test', command: 'test "$(cat value.txt 2>/dev/null)" = ok' }] }
const MODELS = { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'claude', model: 'claude-sonnet-5' } }

test('a link is a relative markdown link, and nothing else is', () => {
  assert.deepEqual(taskLinks('Read [the decision](shared-docs/adr/0003.md) first.'), ['shared-docs/adr/0003.md'])

  // Somebody else's to serve, or not a path at all.
  assert.deepEqual(taskLinks('[the spec](https://example.com/adr/0003.md)'), [], 'a URL')
  assert.deepEqual(taskLinks('[the spec](//example.com/adr.md)'), [], 'a protocol-relative URL')
  assert.deepEqual(taskLinks('[the spec](/srv/docs/adr.md)'), [], 'a site-absolute path')
  assert.deepEqual(taskLinks('[the spec](mailto:someone@example.com)'), [], 'another scheme')
  assert.deepEqual(taskLinks('[this section](#acceptance-criteria)'), [], 'an anchor in this document')
  assert.deepEqual(taskLinks('See docs/adr/0003.md before you start.'), [], 'prose that mentions a file is not a link')
  assert.deepEqual(taskLinks('Shape:\n\n```markdown\n[a decision](docs/adr/NNNN-whatever.md)\n```\n'), [], 'an example of a link inside a fence')

  // The parts a renderer uses and the tree does not.
  assert.deepEqual(taskLinks('[there](docs/adr.md#the-decision)'), ['docs/adr.md'], 'the anchor is cut')
  assert.deepEqual(taskLinks('[there](<docs/adr.md> "a title")'), ['docs/adr.md'], 'angle brackets and a title are not the path')
  assert.deepEqual(taskLinks('[there](docs/a%20b.md)'), ['docs/a b.md'], 'percent-encoding is decoded')
  assert.deepEqual(taskLinks('[there](docs/%zz.md)'), ['docs/%zz.md'], 'and encoding nobody can decode is read literally')

  assert.deepEqual(taskLinks('[a](docs/adr.md) and [again](docs/adr.md)'), ['docs/adr.md'], 'one document named twice is one document')
  assert.deepEqual(taskLinks(''), [])
})

test('a task with no links reads nothing', () => {
  const read = []
  const result = checkLinks('/nowhere', '# Goal\n\nWallet balance.\n', { exists: (path) => (read.push(path), true) })
  assert.deepEqual(result, { checked: 0, broken: [] })
  assert.deepEqual(read, [], 'nothing to check is nothing to stat')
})

test('a link is resolved from the root of the repository, not from the task file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detent-links-'))
  mkdirSync(join(dir, 'shared-docs', 'adr'), { recursive: true })
  writeFileSync(join(dir, 'shared-docs', 'adr', '0003.md'), 'a decision\n')

  assert.deepEqual(
    checkLinks(dir, 'Read [0003](shared-docs/adr/0003.md) and [0009](shared-docs/adr/0009.md).'),
    { checked: 2, broken: ['shared-docs/adr/0009.md'] },
  )
  assert.deepEqual(checkLinks(dir, '[0003](shared-docs/adr/0003.md)'), { checked: 1, broken: [] })
})

function setup(body, repo = {}) {
  const context = gitProduct({ gauge: GAUGE, models: MODELS, ...repo })
  const docs = sharedContext(context)
  const todo = join(context.dir, 'tasks', 'todo')
  mkdirSync(todo, { recursive: true })
  writeFileSync(join(todo, '0042-wallet-endpoint.md'), `---\nid: 0042\nrepo: acme-api\n---\n\n${body}`)
  const [task] = readQueue(context.dir, context.product)
  assert.equal(context.product.docs, null, 'no documents repository is configured, and the links are checked anyway')
  return { ...context, docs, task, before: snapshotRefs(context.repoDir) }
}

// A file pushed to the documents repository after the submodule was mounted:
// present only for a check that runs after the refresh.
function push(docs, path, text) {
  mkdirSync(join(docs.work, path, '..'), { recursive: true })
  writeFileSync(join(docs.work, path), text)
  sh(docs.work, 'add', '.')
  sh(docs.work, 'commit', '--quiet', '-m', `add ${path}`)
  sh(docs.work, 'push', '--quiet', 'origin', 'main')
}

function reply(message, extra = {}) {
  return { ok: true, message, model: { requested: null, actual: null }, cost: { usd: 0.1, tokens: { input: 10, output: 1 } }, session: null, error: null, ms: 1, ...extra }
}

function agents(implement = [(cwd) => writeFileSync(join(cwd, 'value.txt'), 'ok\n')]) {
  const calls = { implement: [], review: [] }
  const invoke = async (role, { cwd, prompt, readOnly }) => {
    const kind = readOnly ? 'review' : 'implement'
    calls[kind].push(prompt)
    if (kind === 'review') return reply('VERDICT: NO DOUBTS')
    const step = implement[calls.implement.length - 1]
    if (!step) throw new Error(`no step ${calls.implement.length}`)
    return (await step(cwd)) ?? reply('Commit: feat(wallet): balance')
  }
  return { invoke, calls }
}

test('a link that resolves is not mentioned anywhere, and the journal says it was checked', async () => {
  const s = setup('# Goal\n\nFollow [the decision](docs/adr/0003-idempotency.md).\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  // The document arrives with the refresh, which is why the check is after it.
  push(s.docs, 'adr/0003-idempotency.md', 'retry safely\n')
  const a = agents()

  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })

  assert.equal(result.outcome, 'passed', result.reason)
  assert.deepEqual(result.links, { checked: 1, broken: [] })
  assert.deepEqual(readJournal(s.dir).lines.at(-1).links, { checked: 1, broken: [] })
  assert.doesNotMatch(a.calls.implement[0], /not in this repository/, 'silence is the normal case')
  assert.doesNotMatch(a.calls.implement[0], /\blinks?\b/i, 'and a check that reports its own success spends a line on nothing')
  assert.doesNotMatch(a.calls.review[0], /could not read/)
  assertInvariant(s.repoDir, s.before, s.product)
})

test('a broken link reaches the agent, the journal and the acceptance pass, and changes nothing else', async () => {
  const s = setup(
    '# Goal\n\nFollow [the decision](docs/adr/0009-wallets.md), [the style guide](docs/style.md) and\n[the API](https://example.com/api) — but not [this](/etc/passwd).\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n',
  )
  const a = agents()
  const n = notifier()

  const result = await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: n.notify })

  assert.deepEqual(result.links, { checked: 2, broken: ['docs/adr/0009-wallets.md', 'docs/style.md'] }, 'a URL and an absolute path are nobody\'s to check')
  assert.deepEqual(readJournal(s.dir).lines.at(-1).links, { checked: 2, broken: ['docs/adr/0009-wallets.md', 'docs/style.md'] })

  const prompt = a.calls.implement[0]
  assert.match(prompt, /The task links to 2 documents that are not in this repository:\n- docs\/adr\/0009-wallets\.md\n- docs\/style\.md\n/)
  assert.match(prompt, /They were looked for from the root of this repository at the start of this task, once everything mounted here was up to date, so they are not there to read\. Decide whether you needed them/)
  assert.match(
    a.calls.review[0],
    /2 documents this task links to were not in the repository when the work started, so the implementer could not read them:\n- docs\/adr\/0009-wallets\.md\n- docs\/style\.md/,
    'a reviewer deciding whether the work is sound knows what the implementer could not read',
  )

  // The whole of what a broken link costs the run: it is told, and that is all.
  assert.equal(result.outcome, 'passed', result.reason)
  assert.equal(result.merged, true)
  assert.equal(result.attempts, 1, 'not retried')
  assert.equal(result.reason, null, 'not paused')
  assert.deepEqual(n.sent, [], 'and nobody is woken up about it')
  assert.equal(sh(s.repoDir, 'branch', '--list', BRANCH), '', 'the task branch is gone, like any passed task')
  assertInvariant(s.repoDir, s.before, s.product)
})

test('one broken link reads as one, and a task with no links leaves an empty record', async () => {
  const s = setup('# Goal\n\nFollow [the decision](docs/adr/0009-wallets.md).\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  const a = agents()
  await runTask(s.product, s.repo, s.task, { invoke: a.invoke, notify: notifier().notify })
  assert.match(a.calls.implement[0], /The task links to a document that is not in this repository:\n- docs\/adr\/0009-wallets\.md\nIt was looked for/)
  assert.match(a.calls.review[0], /One document this task links to was not in the repository/)

  const plain = setup('# Goal\n\nWallet balance.\n\n# Acceptance criteria\n\n- [ ] value.txt says ok\n')
  const b = agents()
  const result = await runTask(plain.product, plain.repo, plain.task, { invoke: b.invoke, notify: notifier().notify })
  assert.equal(result.outcome, 'passed', result.reason)
  assert.deepEqual(result.links, { checked: 0, broken: [] }, 'nothing to check is its own record, not a clean one')
})
