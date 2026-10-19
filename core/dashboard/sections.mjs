// The page is sections, one shown at a time, and the one shown is named in the
// fragment (ADR 0020 part 1). A reload and a copied link both come back to
// where somebody was: no server route, nothing fetched to change section, and
// nothing hidden that a person needs — what is wrong lives outside every
// section, in `warnings.mjs`.
//
// Every section is in the document from the start and all but one is `hidden`.
// The page renders into all of them whether they are shown or not, so showing
// one is an attribute and never a fetch.

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
// This is the function the page runs — it is serialised into the script below,
// so what a test calls and what a browser calls are the same code.
export function sectionFor(hash, ids) {
  const name = String(hash || '').replace(/^#/, '')
  return ids.includes(name) ? name : ids[0]
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

${sectionFor}

function showSection() {
  const current = sectionFor(location.hash, SECTION_IDS)
  for (const section of document.querySelectorAll('main > section[id]')) section.hidden = section.id !== current
  for (const link of document.querySelectorAll('nav a[href]')) {
    if (link.hash === '#' + current) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

window.addEventListener('hashchange', showSection)
`
