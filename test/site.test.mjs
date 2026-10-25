import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

// The demo is the dashboard's own page with a few lines in front of its script,
// so a change to the page can break the site without breaking anything else.
// This is where that shows up: on the pull request, not on main after a deploy.
test('the site builds, and the demo is the dashboard answering from what it was asked', () => {
  const out = mkdtempSync(join(tmpdir(), 'detent-site-'))
  const built = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'build-site.mjs'), out], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)

  const landing = readFileSync(join(out, 'index.html'), 'utf8')
  assert.doesNotMatch(landing, /\{\{\w+\}\}/, 'every placeholder is filled')
  assert.match(landing, /href="demo\/"/)

  // The site is deployed from an artifact, and an artifact without this file
  // is a deployment that drops the custom domain — quietly, on the next push
  // to main, with the old address answering again. It is one line, and it is
  // the only thing that keeps the published address the published address.
  assert.equal(readFileSync(join(out, 'CNAME'), 'utf8').trim(), 'detent.kazimvakhobov.com')

  const demo = readFileSync(join(out, 'demo', 'index.html'), 'utf8')
  assert.match(demo, /window\.fetch =/)
  for (const path of ['state.json', 'configuration.json', 'task.json?task=0013', 'log.json?task=0013']) {
    assert.ok(demo.includes(JSON.stringify(path)), `the demo carries the answer to ${path}`)
  }
  assert.doesNotMatch(demo, /detent-demo-/, 'the temporary folder it was built in is not on the page')
})
