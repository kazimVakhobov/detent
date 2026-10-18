// The gauge was green on every documentation change this repository had seen,
// because none of its stages opened a markdown file (docs/adr/0011). This is
// the stage that opens them. It reads nothing but what can be settled without
// judgement — a link either resolves or it does not — and whether a sentence
// is *true* stays outside the gauge on purpose.
//
// Four checks, each one here because it already failed:
//   1. every relative link in a tracked markdown file points at a path that exists
//   2. every version a document states as the current one agrees with package.json
//   3. docs/adr/README.md's index lists exactly the files in docs/adr/
//   4. a number written in prose beside the thing it counts is that count
//
// Usage: node scripts/check-docs.mjs [root]   (root defaults to this repository)

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const problems = []
const at = (file, line, problem) => problems.push(`${file}:${line}: ${problem}`)

// Tracked, because an untracked scratch file is nobody's claim.
const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', '*.md'], { encoding: 'utf8' })
if (listed.status !== 0) {
  process.stderr.write(`docs: the documentation cannot be checked — git ls-files failed in ${root}\n`)
  process.stderr.write(`  ${(listed.stderr || listed.error?.message || '').trim()}\n`)
  process.exit(1)
}
const files = listed.stdout.split('\0').filter((name) => name !== '')

// A link or a version inside a fenced block is an example of one, not one.
function proseLines(text) {
  const lines = []
  let fence = null
  text.split('\n').forEach((text, index) => {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(text)
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null
      return
    }
    if (open) {
      fence = open[1]
      return
    }
    lines.push({ number: index + 1, text })
  })
  return lines
}

// 1. Relative links resolve.
//
// A `#anchor` is part of the link and not part of the path, so it is cut before
// the path is looked for; whether the heading exists is a question about
// rendering, not about the tree. Anything with a scheme, and anything
// site-absolute, is somebody else's to serve and is left alone.
const LINK = /\]\(([^)]+)\)/g
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i

let links = 0

for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8')
  const dir = dirname(join(root, file))

  for (const line of proseLines(text)) {
    for (const [, raw] of line.text.matchAll(LINK)) {
      const target = raw.trim().split(/\s+/)[0].replace(/^<|>$/g, '')
      if (target === '' || ELSEWHERE.test(target)) continue
      const path = target.split('#')[0].split('?')[0]
      if (path === '') continue
      links += 1
      if (!existsSync(resolve(dir, decodeURIComponent(path)))) {
        at(file, line.number, `link "${target}" points at ${path}, which does not exist`)
      }
    }
  }
}

// 2. A version stated as the current one is the version in package.json.
//
// Only a line that claims currency is read — a status line, "the current
// version", "the latest release is". A `CHANGELOG.md` heading names a release
// that happened and is a record rather than a claim about now, so it is never
// read this way, and neither is prose about a version that is past.
const CURRENCY = /\b(?:status\s*:|current(?:ly)?\s+(?:released\s+|published\s+|at\s+)?version|version\s+is\s+(?:now|currently)|latest\s+(?:release|version)\s+is)/i
const SEMVER = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g

let claims = 0

for (const file of files) {
  const changelog = /(?:^|\/)CHANGELOG\.md$/.test(file)
  for (const line of proseLines(readFileSync(join(root, file), 'utf8'))) {
    if (changelog && /^\s{0,3}#/.test(line.text)) continue
    if (!CURRENCY.test(line.text)) continue
    for (const [, version] of line.text.matchAll(SEMVER)) {
      claims += 1
      if (version !== pkg.version) {
        at(file, line.number, `states ${version} as the current version; package.json says ${pkg.version}`)
      }
    }
  }
}

// 3. The ADR index and the ADR directory agree, in both directions.
//
// An index is only useful if it is complete, and an entry whose file is gone
// is worse than no entry. A repository with no docs/adr/ has nothing to check.
const adrDir = join(root, 'docs', 'adr')
const ADR = /^\d{4}-.+\.md$/
let indexed = 0

if (existsSync(adrDir)) {
  const onDisk = readdirSync(adrDir).filter((name) => ADR.test(name)).sort()
  const indexPath = join(adrDir, 'README.md')

  if (!existsSync(indexPath)) {
    at('docs/adr/README.md', 1, `${onDisk.length} decision files and no index — docs/adr/README.md is missing`)
  } else {
    const entries = new Map()
    let lastRow = 1
    for (const line of proseLines(readFileSync(indexPath, 'utf8'))) {
      if (!line.text.startsWith('|')) continue
      for (const [, raw] of line.text.matchAll(LINK)) {
        const name = raw.trim().split(/\s+/)[0].split('#')[0]
        if (!ADR.test(name)) continue
        if (!entries.has(name)) entries.set(name, line.number)
        lastRow = line.number
      }
    }
    indexed = entries.size

    for (const [name, line] of entries) {
      if (!onDisk.includes(name)) at('docs/adr/README.md', line, `the index lists ${name}, which is not in docs/adr/`)
    }
    for (const name of onDisk) {
      if (!entries.has(name)) at('docs/adr/README.md', lastRow, `docs/adr/${name} has no entry in the index`)
    }
  }
}

// 4. A number stated beside the thing it counts is the count of that thing.
//
// Two shapes, both of which have been wrong here more than once: a line that
// links to docs/adr/ and says how many decisions are in it, and a heading of
// the form "<count> <things>" over the list of those things. Each correction
// so far was somebody noticing by hand.
//
// Nothing else is read. "The nine conditions", "three attempts", "two gates"
// are claims about behaviour, and the code is what settles whether they hold;
// counting them would be guessing at meaning, which is the line 0011 drew.
// Counts written as English words are read, because that is how this
// repository writes them — and a word that is not a number ("a few decisions",
// "several things") is not a count, so it is left alone rather than guessed
// at. A false failure in a gauge stage costs more than a missed one.
//
// A CHANGELOG.md entry dates what it says: "Eight decision records" under
// 0.0.2 was true of 0.0.2, and is a record rather than a claim about now — the
// same reason its headings are not read as version claims.
const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
]
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// The number a word states, or null if it does not state one with certainty.
function countOf(word) {
  const text = word.toLowerCase()
  if (/^\d+$/.test(text)) return Number(text)
  const one = ONES.indexOf(text)
  if (one >= 0) return one
  const [tens, rest] = text.split('-')
  const ten = TENS.indexOf(tens)
  if (ten < 0) return null
  if (rest === undefined) return (ten + 2) * 10
  const unit = ONES.indexOf(rest)
  return unit >= 1 && unit <= 9 ? (ten + 2) * 10 + unit : null
}

const NUMBER = String.raw`\d+|[A-Za-z]+(?:-[A-Za-z]+)?`
const DECISIONS = new RegExp(String.raw`\b(${NUMBER})\s+(?:decision records?|decisions?|records?|ADRs?)\b`, 'gi')
const COUNTED = new RegExp(String.raw`^(${NUMBER})\s+\S`)
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const EMPHASIS = /[`*_]/g
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/

// How many items the list immediately below `from` has, or null if what is
// there is not a list — a table, a paragraph, or a fenced block, which this
// stage does not read for anything else either.
function listItems(lines, from) {
  let index = from
  while (index < lines.length && lines[index].text.trim() === '') index += 1
  const first = index < lines.length ? ITEM.exec(lines[index].text) : null
  if (!first) return null

  const indent = first[1].length
  let items = 0
  for (; index < lines.length; index += 1) {
    const { text } = lines[index]
    if (text.trim() === '') continue
    if (HEADING.test(text)) break
    const item = ITEM.exec(text)
    if (item) {
      if (item[1].length < indent) break
      if (item[1].length === indent) items += 1
      continue
    }
    // Indented enough to continue an item; anything else is prose of its own.
    if (text.search(/\S/) <= indent) break
  }
  return items
}

const decisions = existsSync(adrDir) ? readdirSync(adrDir).filter((name) => ADR.test(name)).length : null
let counted = 0

for (const file of files) {
  if (/(?:^|\/)CHANGELOG\.md$/.test(file)) continue
  const dir = dirname(join(root, file))
  const lines = proseLines(readFileSync(join(root, file), 'utf8'))

  lines.forEach((line, index) => {
    const linksToDecisions = decisions !== null && [...line.text.matchAll(LINK)].some(([, raw]) => {
      const target = raw.trim().split(/\s+/)[0].replace(/^<|>$/g, '').split('#')[0].split('?')[0]
      if (target === '' || ELSEWHERE.test(target)) return false
      return resolve(dir, decodeURIComponent(target)) === adrDir
    })

    if (linksToDecisions) {
      // One readable count on the line is the claim; two is a sentence this
      // stage cannot read, and it says nothing about it.
      const stated = [...line.text.matchAll(DECISIONS)].map(([, word]) => countOf(word)).filter((n) => n !== null)
      if (stated.length === 1) {
        counted += 1
        if (stated[0] !== decisions) {
          at(file, line.number, `states ${stated[0]} decisions beside the link to docs/adr/, which holds ${decisions}`)
        }
      }
    }

    const heading = HEADING.exec(line.text)
    if (!heading) return
    const shape = COUNTED.exec(heading[1].replace(EMPHASIS, ''))
    if (!shape) return
    const stated = countOf(shape[1])
    if (stated === null) return
    const items = listItems(lines, index + 1)
    if (items === null) return
    counted += 1
    if (items !== stated) {
      at(file, line.number, `the heading "${heading[1]}" says ${stated}; the list below it has ${items} items`)
    }
  })
}

if (problems.length > 0) {
  process.stderr.write('docs: the documentation claims something the tree does not support:\n')
  for (const problem of problems) process.stderr.write(`  ${problem}\n`)
  process.exit(1)
}

process.stdout.write(`docs: ${files.length} markdown files, ${links} relative links, ${claims} version claims, ${indexed} decisions indexed, ${counted} stated counts\n`)
