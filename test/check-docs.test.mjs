// The docs stage is a claim about documentation, so it is checked the same way
// the documentation is: against a tree that really has the problem. Each
// fixture is a git repository, because the stage reads tracked files.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'check-docs.mjs')

const INDEX = `# Decisions

| # | Decision | Status |
|---|---|---|
| [0001](0001-first.md) | The first one | accepted |
`

// A consistent tree: links that resolve, a status line that agrees with
// package.json, a changelog of past releases, an index that matches.
function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'detent-docs-'))
  const written = {
    'package.json': JSON.stringify({ name: 'fixture', version: '2.1.0' }),
    'README.md': '> **Status: 2.1.0 — it works.**\n\nSee [the design](DESIGN.md) and [the decisions](docs/adr/).\n',
    'DESIGN.md': 'Shape, in [one step](PROGRESS.md#1-first).\n',
    'PROGRESS.md': '# Progress\n\n## 1. First\n',
    'CHANGELOG.md': '# Changelog\n\n## 2.1.0 — 2026-10-13\n\n## 1.0.0 — 2026-01-01\n\nThe latest version is 2.1.0 as of writing.\n',
    'docs/adr/README.md': INDEX,
    'docs/adr/0001-first.md': '# 0001. First\n',
    ...files,
  }
  for (const [name, text] of Object.entries(written)) {
    if (text === null) continue
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git('init', '--quiet')
  git('add', '.')
  return dir
}

function check(dir) {
  const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

test('a consistent tree passes, and says what it covered', () => {
  const { code, out } = check(fixture())
  assert.equal(code, 0, out)
  assert.match(out, /^docs: \d+ markdown files/)
  assert.match(out, /\d+ stated counts/)
})

test('this repository passes its own docs stage', () => {
  const { code, out } = check(root)
  assert.equal(code, 0, out)
})

test('a dead relative link fails, naming the file, the line and the path', () => {
  const dir = fixture({ 'README.md': '# R\n\nSee [the plan](PLAN.md).\n' })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /README\.md:3: .*PLAN\.md.*does not exist/)
})

test('an anchor is part of the link and not part of the path', () => {
  const dir = fixture({ 'DESIGN.md': 'See [a heading](PROGRESS.md#9-nowhere) and [an own heading](#top).\n' })
  assert.equal(check(dir).code, 0)

  const dead = fixture({ 'DESIGN.md': 'See [a heading](GONE.md#9-nowhere).\n' })
  const { code, out } = check(dead)
  assert.equal(code, 1)
  assert.match(out, /DESIGN\.md:1: link "GONE\.md#9-nowhere" points at GONE\.md/)
})

test('an absolute URL is somebody else to serve', () => {
  const dir = fixture({ 'README.md': 'See [npm](https://npmjs.com/x) and [mail](mailto:a@b.c).\n' })
  assert.equal(check(dir).code, 0)
})

test('a link inside a fenced block is an example of a link', () => {
  const dir = fixture({ 'README.md': 'Shape:\n\n```markdown\n[a decision](docs/adr/NNNN-whatever.md)\n```\n' })
  assert.equal(check(dir).code, 0)
})

test('a stale current version fails, naming both versions', () => {
  const dir = fixture({ 'README.md': '> **Status: 1.4.0 — it works.**\n' })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /README\.md:1: states 1\.4\.0 as the current version; package\.json says 2\.1\.0/)
})

test('a changelog heading naming a past release is a record, not a claim', () => {
  const dir = fixture({
    'CHANGELOG.md': '# Changelog\n\n## 2.1.0 — 2026-10-13\n\n## 1.0.0 — 2026-01-01\n\n0.9.0 was tagged and never served.\n',
  })
  assert.equal(check(dir).code, 0)
})

test('a stale version stated as current in prose fails', () => {
  const dir = fixture({ 'DESIGN.md': 'The current version is 1.0.0, and that is that.\n' })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /DESIGN\.md:1: states 1\.0\.0 as the current version/)
})

test('an index entry with no file fails', () => {
  const dir = fixture({
    'docs/adr/README.md': `${INDEX}| [0002](0002-second.md) | The second one | accepted |\n`,
  })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /docs\/adr\/README\.md:6: the index lists 0002-second\.md, which is not in docs\/adr\//)
})

test('a file with no index entry fails', () => {
  const dir = fixture({ 'docs/adr/0002-second.md': '# 0002. Second\n' })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /docs\/adr\/README\.md:5: docs\/adr\/0002-second\.md has no entry in the index/)
})

test('decision files with no index at all fail', () => {
  const dir = fixture({ 'docs/adr/README.md': null })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /docs\/adr\/README\.md:1: .*no index/)
})

// A count stated beside the thing it counts. The fixture holds one decision.
test('a stale count beside the link to docs/adr/ fails, naming both numbers', () => {
  const dir = fixture({ 'README.md': 'See [the decisions](docs/adr/) — three decisions, each with its cost.\n' })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /README\.md:1: states 3 decisions beside the link to docs\/adr\/, which holds 1/)
})

test('a count beside the link to docs/adr/ that is right passes', () => {
  const dir = fixture({ 'README.md': 'See [the decisions](docs/adr/) — one decision so far.\n' })
  assert.equal(check(dir).code, 0)
})

test('a link to a decision rather than to the directory states nothing about how many', () => {
  const dir = fixture({ 'README.md': 'See [ADR 0001](docs/adr/0001-first.md), the one decision that matters.\n' })
  assert.equal(check(dir).code, 0)
})

test('a heading that counts its list fails, naming both numbers and the heading', () => {
  const dir = fixture({
    'DESIGN.md': '### Five things `doctor` checks\n\n- one\n- two\n- three\n- four\n',
  })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /DESIGN\.md:1: the heading "Five things `doctor` checks" says 5; the list below it has 4 items/)
})

test('a heading whose count matches its list passes, and a nested item is not one of them', () => {
  const dir = fixture({
    'DESIGN.md': '### Two gates\n\n- the first, which has\n  - a part\n  - another part\n- the second\n\nAnd then prose.\n',
  })
  assert.equal(check(dir).code, 0)
})

test('a count written in digits is read the same way', () => {
  const dir = fixture({ 'DESIGN.md': '## 3 steps\n\n1. first\n2. second\n' })
  const { code, out } = check(dir)
  assert.equal(code, 1)
  assert.match(out, /DESIGN\.md:1: the heading "3 steps" says 3; the list below it has 2 items/)
})

test('a count the check cannot read is not a claim, and is skipped', () => {
  const dir = fixture({
    'DESIGN.md': '### Several things `doctor` checks\n\n- one\n- two\n',
    'README.md': 'See [the decisions](docs/adr/) — a few decisions, and dozens of records.\n',
  })
  assert.equal(check(dir).code, 0)
})

test('a number in ordinary prose is untouched', () => {
  const dir = fixture({
    'DESIGN.md': 'The nine conditions, three profiles and three attempts, since 0.5.0.\n\n- one\n',
    'PROGRESS.md': '# Progress\n\n## 1. First\n\n### Four invariants\n\n| | What |\n|---|---|\n| I1 | one |\n',
  })
  assert.equal(check(dir).code, 0)
})

test('a fenced block is not a list a heading can be counted against', () => {
  const dir = fixture({ 'DESIGN.md': '### Four things\n\n```markdown\n- one\n- two\n```\n' })
  assert.equal(check(dir).code, 0)
})

test('a count in the changelog is a record of a release, not a claim about now', () => {
  const dir = fixture({
    'CHANGELOG.md': '# Changelog\n\n## 2.1.0 — 2026-10-13\n\n- Eight decision records in [`docs/adr/`](docs/adr/).\n',
  })
  assert.equal(check(dir).code, 0)
})
