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
