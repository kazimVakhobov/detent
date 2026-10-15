// A product folder with one repository holding a human history — dev, a
// feature branch, a tag — and agent/dev made from dev, as a person would.
// Not a test file; node --test loads it and finds nothing to run.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { currentBranch, git, isClean, operationInProgress, snapshotRefs } from '../../core/git.mjs'
import { validateProduct } from '../../core/product.mjs'
import { readState } from '../../core/state.mjs'

export function sh(cwd, ...args) {
  return git(cwd, args)
}

export function gitProduct(repoOverrides = {}, productOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'detent-product-'))
  const repoDir = join(dir, 'acme-api')
  mkdirSync(repoDir)
  sh(repoDir, 'init', '--quiet', '--initial-branch=dev')
  sh(repoDir, 'config', 'user.name', 'Person')
  sh(repoDir, 'config', 'user.email', 'person@example.com')
  sh(repoDir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repoDir, 'README.md'), 'acme\n')
  writeFileSync(join(repoDir, 'app.js'), 'export const a = 1\n')
  writeFileSync(join(repoDir, '.gitignore'), 'node_modules/\n')
  sh(repoDir, 'add', '.')
  sh(repoDir, 'commit', '--quiet', '-m', 'init')
  sh(repoDir, 'branch', 'feature/human-work')
  sh(repoDir, 'tag', 'v1')
  sh(repoDir, 'branch', 'agent/dev', 'dev')

  const raw = { version: 1, product: { name: 'acme' }, repos: [{ name: 'acme-api', compare: 'dev', ...repoOverrides }], ...productOverrides }
  mkdirSync(join(dir, '.detent'))
  writeFileSync(join(dir, '.detent', 'product.json'), JSON.stringify(raw))
  const { product, problems } = validateProduct(raw, dir)
  assert.deepEqual(problems, [])
  return { dir, repoDir, product, repo: product.repos[0] }
}

// A repository with a remote of its own, somewhere a product folder's scan
// never looks: the far side of a submodule or of a queue two machines share.
// `write` is the session's move — a commit pushed to that remote.
function remoteRepository(dir, name, file) {
  const work = join(dir, '.remotes', name)
  const origin = join(dir, '.remotes', `${name}.git`)
  mkdirSync(work, { recursive: true })
  sh(work, 'init', '--quiet', '--initial-branch=main')
  sh(work, 'config', 'user.name', 'Session')
  sh(work, 'config', 'user.email', 'session@example.com')
  sh(work, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(work, file), 'one\n')
  sh(work, 'add', '.')
  sh(work, 'commit', '--quiet', '-m', 'one')
  sh(dir, 'clone', '--quiet', '--bare', work, origin)
  sh(work, 'remote', 'add', 'origin', origin)
  return {
    origin,
    work,
    write(text) {
      writeFileSync(join(work, file), text)
      sh(work, 'commit', '--quiet', '-am', text.trim())
      sh(work, 'push', '--quiet', 'origin', 'main')
      return sh(work, 'rev-parse', 'HEAD')
    },
    tip: () => sh(work, 'rev-parse', 'HEAD'),
    refs: () => sh(origin, 'for-each-ref', '--format=%(refname)'),
  }
}

// The shared context of ADR 0012: a documentation repository a session pushes
// to, mounted as a submodule of the product's repository on dev and agent/dev.
// The submodule is allowed the file transport, because its remote is a path.
export function sharedContext(context, path = 'docs') {
  const shared = remoteRepository(context.dir, 'shared-docs', 'adr.md')
  const repo = context.repoDir
  sh(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', shared.origin, path)
  sh(join(repo, path), 'config', 'protocol.file.allow', 'always')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '--quiet', '-m', `mount ${path}`)
  sh(repo, 'branch', '--force', 'agent/dev', 'dev')
  return { ...shared, path, pointer: (rev) => sh(repo, 'rev-parse', `${rev}:${path}`), head: () => sh(join(repo, path), 'rev-parse', 'HEAD'), remoteTip: () => sh(join(repo, path), 'rev-parse', 'refs/remotes/origin/main') }
}

// The queue in a repository of its own, cloned from a remote the way a second
// machine has it: `queue` then names a path inside that clone.
export function queueRepository(dir, path) {
  const root = path.split('/')[0]
  const shared = remoteRepository(dir, basename(root), 'README.md')
  sh(dir, 'clone', '--quiet', shared.origin, root)
  const clone = join(dir, root)
  sh(clone, 'config', 'user.name', 'Person')
  sh(clone, 'config', 'user.email', 'person@example.com')
  sh(clone, 'config', 'commit.gpgsign', 'false')
  return { ...shared, dir: clone, subjects: () => sh(clone, 'log', '--format=%s'), pushed: () => sh(shared.origin, 'log', '--format=%s') }
}

// The invariant of DESIGN.md §2, as one assertion over every ref.
export function assertInvariant(repoDir, before, product) {
  const after = snapshotRefs(repoDir)
  const moved = new Set()
  for (const [ref, object] of before) if (after.get(ref) !== object) moved.add(ref)
  for (const [ref] of after) if (!before.has(ref)) moved.add(ref)
  const outside = [...moved].filter((ref) => !ref.startsWith('refs/heads/agent/'))
  assert.deepEqual(outside, [], `refs moved outside refs/heads/agent/: ${outside.join(', ')}`)
  assert.equal(currentBranch(repoDir), 'agent/dev', 'the repository rests on agent/dev')
  assert.equal(operationInProgress(repoDir), null, 'git is not left in the middle of anything')
  assert.equal(isClean(repoDir), true, `the tree is clean:\n${sh(repoDir, 'status', '--short')}`)
  assert.deepEqual(readState(product.dir).repos, {}, 'state.json lists nothing as out')
  assert.equal(sh(repoDir, 'stash', 'list'), '', 'nothing was stashed')
}

export function show(repoDir, rev, path) {
  return sh(repoDir, 'show', `${rev}:${path}`)
}
