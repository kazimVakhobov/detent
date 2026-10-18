// What a task's links point at (ADR 0014, part 4).
//
// A task body links to a document, which is the whole reason a methodology
// puts documents in a repository and mounts it. The link is a markdown
// link — `](path)` — whose path is **relative to the root of the repository the
// task names**: `shared-docs/adr/0003.md` in a task for acme-api is
// acme-api/shared-docs/adr/0003.md. That is the only form that means anything
// when the documents arrive as a submodule.
//
// What is not a link: prose that mentions a file, a URL or anything else with
// a scheme, a site-absolute path, a bare `#anchor`, and an example inside a
// fenced block. `scripts/check-docs.mjs` draws the same line for this
// repository's own documentation, for the same reason — a path nobody linked is
// nobody's claim that it exists.
//
// The check runs at the start of the task, after the shared context has been
// refreshed, so it is against the revision the agent will actually read. A
// broken link is told to the agent, recorded in the journal and shown to the
// acceptance pass. **It is never a reason to stop.** detent cannot tell a
// load-bearing link from a decorative one, and stopping on the decorative one
// trains a person to stop reading the reason; the price, which ADR 0014 records
// rather than hides, is that a task can end green and under-informed.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const LINK = /\]\(([^)]+)\)/g
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

// The relative paths a body links to, in the order it names them and each one
// once: the same document linked twice is one document to look for.
export function taskLinks(body) {
  const paths = new Set()
  let fence = null

  for (const line of (body ?? '').split('\n')) {
    const open = FENCE.exec(line)
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
      continue
    }
    if (open) {
      fence = open[1]
      continue
    }
    for (const [, raw] of line.matchAll(LINK)) {
      const target = raw.trim().split(/\s+/)[0].replace(/^<|>$/g, '')
      if (target === '' || ELSEWHERE.test(target)) continue
      // The `#heading` and the `?query` are the renderer's; the path is the
      // tree's, and the path is the only part a document can be missing from.
      const path = decode(target.split('#')[0].split('?')[0])
      if (path !== '') paths.add(path)
    }
  }

  return [...paths]
}

// `{ checked, broken }` for one task body against the root of its repository.
// Both are always reported, because a task with no links and a task whose links
// all resolved are not the same record — and a body with no links costs one
// pass over text and not a single filesystem read, which is what `exists` is
// injectable to prove.
export function checkLinks(dir, body, { exists = existsSync } = {}) {
  const paths = taskLinks(body)
  return { checked: paths.length, broken: paths.filter((path) => !exists(resolve(dir, path))) }
}

// A path that is not valid percent-encoding is read as the literal text it is.
// This check reports a missing document; it is never the thing that throws.
function decode(path) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
