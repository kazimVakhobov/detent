// The page is sections, one shown at a time, and the one shown is named in the
// fragment (ADR 0020 part 1). A reload and a copied link both come back to
// where somebody was: no server route, nothing fetched to change section, and
// nothing hidden that a person needs — what is wrong lives outside every
// section, in `warnings.mjs`.
//
// Every section is in the document from the start and all but one is `hidden`.
// The page renders into all of them whether they are shown or not, so showing
// one is an attribute and never a fetch.

// The one section a fragment may name with something after it: the task
// detail, which is one task of many and so cannot be named by a section id
// alone. `#task/0042`, and nothing else in the page has that shape.
export const TASK_SECTION = 'task'

export const SECTIONS = [
  {
    id: 'overview',
    nav: 'Overview',
    // The figures `summary` computes, from the same code (§12).
    markup: `<div class="figures" id="figures"></div>`,
  },
  {
    id: 'repositories',
    nav: 'Repositories',
    // Where each repository stands, and how it has done: `numbers.byRepo` was
    // computed every read and drawn nowhere.
    markup: `<h2>Repositories</h2>
<div class="scroll"><table id="repos"></table></div>
<h2>By repository</h2>
<div class="scroll"><table id="by-repo"></table></div>`,
  },
  {
    id: 'queue',
    nav: 'Queue',
    // All four folders the snapshot reads. Two of them were read and thrown
    // away: `done/` is detent's own bookkeeping, and `failed/` is where a
    // person puts a task they abandon — detent never moves anything there.
    markup: `<div class="grid2">
  <div><h2>Queue</h2><div class="scroll"><table id="todo"></table></div></div>
  <div><h2>Paused — waiting for you</h2><div class="scroll"><table id="hold"></table></div></div>
  <div><h2>Done</h2><div class="scroll"><table id="done"></table></div></div>
  <div><h2>Abandoned by hand</h2><div class="scroll"><table id="failed"></table></div></div>
</div>`,
  },
  {
    id: TASK_SECTION,
    nav: 'Task',
    // One task, opened from any table that lists it (ADR 0020 part 3): its
    // frontmatter, its goal, its criteria, its out-of-scope and what its
    // attempts did. The fragment carries the number — `#task/0042` — so a link
    // to one task is a link somebody can send and reload. It is fetched when a
    // task is opened and never polled; `state.json` gains nothing.
    markup: `<h2>Task</h2>
<div class="panel" id="task-detail"></div>`,
  },
  {
    id: 'agents',
    nav: 'Agents',
    markup: `<h2>Agents</h2>
<div class="scroll"><table id="by-model"></table></div>`,
  },
  {
    id: 'runs',
    nav: 'Recent runs',
    markup: `<h2>Recent runs</h2>
<div class="scroll"><table id="recent"></table></div>`,
  },
  {
    id: 'configuration',
    nav: 'Configuration',
    // Moved into a section of its own and otherwise untouched (ADR 0020 keeps
    // reading-before-writing for its own change).
    markup: `<h2>Configuration</h2>
<div class="panel" id="config">
  <div class="status look lock" id="config-lock"></div>
  <div id="config-fields"></div>
  <div class="actions">
    <button type="button" id="save">Save configuration</button>
    <span id="config-note" class="muted"></span>
  </div>
  <ul class="problems" id="config-problems"></ul>
</div>
<h2>Shown here, changed on disk</h2>
<div class="scroll"><table id="fixed"></table></div>`,
  },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

// Which section a fragment names.
//
// An absent or unrecognised fragment is the first section rather than nothing,
// and nothing rewrites `location.hash`: a link somebody typed stays as they
// typed it even when it names no section here, because a page that corrects
// the address bar loses the one thing the fragment was for.
//
// The detail section also answers to its name and a number. Which section is
// shown and which task it shows are two questions, and this answers the first
// — so `#task`, `#task/0042` and `#task/nope` all land on the detail, and only
// the middle one opens anything.
//
// This is the function the page runs — it is serialised into the script below,
// so what a test calls and what a browser calls are the same code.
export function sectionFor(hash, ids, numbered = TASK_SECTION) {
  const name = String(hash || '').replace(/^#/, '')
  if (ids.includes(name)) return name
  if (name.split('/')[0] === numbered && ids.includes(numbered)) return numbered
  return ids[0]
}

// Which task a fragment opens, or null for a fragment that opens none. Digits
// after the detail section's own name and nothing else: the number stays a
// number here too, and `#task/../x` names no task.
export function taskFor(hash, numbered = TASK_SECTION) {
  const match = /^#?([a-z-]+)\/(\d+)$/.exec(String(hash || ''))
  return match && match[1] === numbered ? match[2] : null
}

const indent = (text, by) => text.split('\n').map((line) => (line === '' ? line : by + line)).join('\n')

export const BODY = `<main>
  <header>
    <h1 id="name">detent</h1>
    <span id="state" class="chip"><span class="dot"></span><span id="state-text">loading</span></span>
    <span id="summary" class="sub"></span>
  </header>
  <nav aria-label="Sections">
${SECTIONS.map((s) => `    <a href="#${s.id}">${s.nav}</a>`).join('\n')}
  </nav>
  <div class="alerts" id="alerts"></div>
${SECTIONS.map((s) => `  <section id="${s.id}" hidden>\n${indent(s.markup, '    ')}\n  </section>`).join('\n')}
  <footer id="footer"></footer>
</main>`

export const SHOW = `// The sections, and the fragment that names one.
const SECTION_IDS = ${JSON.stringify(SECTION_IDS)}
const SECTION_NAMES = ${JSON.stringify(Object.fromEntries(SECTIONS.map((s) => [s.id, s.nav])))}
const TASK_SECTION = ${JSON.stringify(TASK_SECTION)}

${sectionFor}

${taskFor}

function showSection() {
  const current = sectionFor(location.hash, SECTION_IDS)
  for (const section of document.querySelectorAll('main > section[id]')) section.hidden = section.id !== current
  for (const link of document.querySelectorAll('nav a[href]')) {
    if (link.hash === '#' + current) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  // The one thing showing a section fetches, and only when it is the one being
  // shown: a task is not in the snapshot and is not polled (ADR 0020 part 3).
  if (current === TASK_SECTION) loadTask(taskFor(location.hash))
}

window.addEventListener('hashchange', showSection)
`
