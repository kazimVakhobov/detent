// The page is sections, one shown at a time, and the one shown is named in the
// fragment (ADR 0020 part 1). A reload and a copied link both come back to
// where somebody was: no server route, nothing fetched to change section, and
// nothing hidden that a person needs — what is wrong lives outside every
// section, in `warnings.mjs`.
//
// Every section is in the document from the start and all but one is `hidden`.
// The page renders into all of them whether they are shown or not, so showing
// one is an attribute and never a fetch.
//
// **One task is a drawer over the section, not a section of its own**
// (ADR 0022). A person is in Queue working down a list, opens a task, and the
// list has to still be there when they close it — so the detail is drawn over
// whichever section is showing, the section behind it is not touched, and
// closing it is nothing to restore. The fragment carries both: a section, and
// the task open over it.

// The word a fragment puts between the section a task was opened from and the
// number it opens: `#queue/task/0043`. Not a section id — `SECTIONS` has no
// entry for the detail, because two ways to see one task would be two code
// paths free to disagree about what a task is (ADR 0022).
export const TASK_PART = 'task'

export const SECTIONS = [
  {
    id: 'overview',
    nav: 'Overview',
    // The landing section, so it answers the question somebody opens the page
    // with: **what is happening and what is next** (§12). Three blocks, in the
    // order a person asks them in — what is running, what runs next, and what
    // has stopped and is waiting for them — and the figures under those three.
    // The figures are the answer to "was it worth it", which is a different
    // question from "what now" and reads after it rather than instead of it.
    //
    // Every block is read from the snapshot the page already has: `active` for
    // what is running, `queue.todo` for what is next, `queue.hold` for what is
    // waiting. Nothing new is fetched.
    //
    // The paused tasks are listed here *and* in Queue, and named a third time
    // in the strip above every section. That is not a mistake: the strip is a
    // line saying how many, and this is the list saying which.
    markup: `<h2>Running now</h2>
<div class="panel" id="now"></div>
<h2>Next up</h2>
<p class="muted" id="next-up-order"></p>
<div class="scroll"><table id="next-up"></table></div>
<h2>Waiting for you</h2>
<div class="scroll"><table id="waiting"></table></div>
<h2>Was it worth it</h2>
<div class="figures" id="figures"></div>`,
  },
  {
    id: 'repositories',
    nav: 'Repositories',
    // Where each repository stands, and how it has done: `numbers.byRepo` was
    // computed every read and drawn nowhere.
    //
    // Not which models it uses. This table stated that in a format of its own
    // beside a configuration panel stating it as form controls, and two
    // renderings of one fact are free to disagree — so it is read where it is
    // written, and the line below says where that is (ADR 0020 part 2).
    markup: `<h2>Repositories</h2>
<div class="scroll"><table id="repos"></table></div>
<p class="muted">Which model each repository uses is read in <a href="#configuration">Configuration</a>, where it is also written.</p>
<h2>By repository</h2>
<div class="scroll"><table id="by-repo"></table></div>`,
  },
  {
    id: 'queue',
    nav: 'Queue',
    // All four folders the snapshot reads, each task a card rather than a row:
    // a column a third of the width wide cannot hold what the journal knows
    // about a task, and what did not fit was not shown at all (`queue.mjs`).
    //
    // And under them, how to make a task and how to run one — because this
    // page does neither, and the one thing a read-only view of a queue owes
    // somebody is the command they came looking for.
    markup: `<div class="grid2">
  <div><h2>Queue</h2><p class="muted" id="todo-order"></p><div class="cards" id="todo"></div></div>
  <div><h2>Paused — waiting for you</h2><div class="cards" id="hold"></div></div>
  <div><h2>Done</h2><div class="cards" id="done"></div></div>
  <div><h2>Abandoned by hand</h2><div class="cards" id="failed"></div></div>
</div>
<h2>Making a task, and running one</h2>
<div class="panel" id="queue-how"></div>`,
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
    // Read until a person says otherwise (ADR 0020 part 2): the view is what
    // is in the document, the editor is the half that is hidden until somebody
    // asks for it, and the lock above both is why the asking is refused during
    // a run.
    //
    // Notifications is a block of its own and not a row among the limits
    // (ADR 0025): the events are choices and the channels are a list, and
    // neither is one value under one key. It is drawn from the same read and
    // written by the same Save — one file, one editor. The secret beside it is
    // the exception that writes somewhere else, and the only control on this
    // page whose value is never read back.
    markup: `<h2>Configuration</h2>
<div class="panel" id="config">
  <div class="status look lock" id="config-lock"></div>
  <div id="config-view"></div>
  <div id="config-fields" hidden></div>
  <datalist id="model-names"></datalist>
  <p class="muted" id="config-models-note" hidden></p>
  <div class="actions">
    <button type="button" id="config-edit">Edit configuration</button>
    <button type="button" id="config-save" hidden>Save configuration</button>
    <button type="button" id="config-discard" class="quiet" hidden>Discard</button>
    <span id="config-note" class="muted"></span>
  </div>
  <ul class="problems" id="config-problems"></ul>
</div>
<h2>Notifications</h2>
<div class="panel" id="notify">
  <div id="notify-view"></div>
  <div id="notify-fields" hidden></div>
  <ul class="problems" id="notify-problems"></ul>
  <p class="muted" id="notify-how"></p>
  <div class="actions" id="notify-secret" hidden>
    <label for="notify-secret-value">Its secret</label>
    <select id="notify-secret-name"></select>
    <input type="password" id="notify-secret-value" placeholder="the token — written to a file of its own, never read back">
    <button type="button" id="notify-secret-set">Set it</button>
    <span id="notify-secret-note" class="muted"></span>
  </div>
</div>
<h2>Shown here, changed on disk</h2>
<div class="scroll"><table id="fixed"></table></div>`,
  },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

// One task, over whichever section is showing (ADR 0022): what its attempts
// did, its frontmatter, its goal, its criteria and its out-of-scope. It is
// fetched when a task is opened and never polled; `state.json` gains nothing.
//
// And under it, what the agent is saying while it says it (ADR 0021) — the one
// part of a task that *is* polled, because it is the one part that changes
// under a reader. It lives here and nowhere else: a transcript with no task
// attached is a log viewer, which is not what this is for. **A drawer is where
// it is drawn and not a change to how it is read**: the same one timer, the
// same request, the same byte offset to carry on from.
//
// The head holds the way out, because a panel that covers content with no
// obvious way back is worse than the section that got replaced. Escape is the
// other way out, and the two are one function.
export const DRAWER = `<aside id="task-drawer" class="drawer" aria-label="Task" hidden>
  <div class="drawer-head">
    <h2>Task</h2>
    <button type="button" id="task-close" class="quiet">Close</button>
  </div>
  <div class="panel" id="task-detail"></div>
  <div class="panel log-panel" id="task-log-panel" hidden>
    <div class="legend">What the agent is saying</div>
    <div class="status" id="task-log-state"></div>
    <pre class="body log" id="task-log"></pre>
  </div>
</aside>`

// Which section a fragment names: what is before the first slash, and the
// first section when that is not one of them.
//
// An absent or unrecognised fragment is the first section rather than nothing,
// and nothing rewrites `location.hash` on arrival: a link somebody typed stays
// as they typed it even when it names no section here, because a page that
// corrects the address bar loses the one thing the fragment was for. The
// grammar grew a second part (ADR 0022) and that rule covers every new way of
// getting it wrong — `#nope/task/0043` and `#queue/task/nope` both land on a
// section, and neither is corrected.
//
// This is the function the page runs — it is serialised into the script below,
// so what a test calls and what a browser calls are the same code.
export function sectionFor(hash, ids) {
  const name = String(hash || '').replace(/^#/, '').split('/')[0]
  return ids.includes(name) ? name : ids[0]
}

// Which task a fragment opens over that section, or null for a fragment that
// opens none. The whole of what follows the section has to be `task/<digits>`,
// after a section this page has: half a fragment opens nothing rather than
// something guessed from its readable half, and the number stays a number —
// `#queue/task/../x` names no task.
export function taskFor(hash, ids) {
  const [name, part, number, ...rest] = String(hash || '').replace(/^#/, '').split('/')
  if (!ids.includes(name) || part !== TASK_PART || rest.length > 0) return null
  return /^\d+$/.test(number) ? number : null
}

// The fragment a row links to: the section it is being opened from, and the
// number. One task is a link somebody can send and reload, as it was when the
// detail was a section — what it now says is where it opens.
export function taskHash(section, id) {
  return '#' + section + '/' + TASK_PART + '/' + id
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
</main>
${DRAWER}`

export const SHOW = `// The sections, the fragment that names one, and the drawer a task opens in.
const SECTION_IDS = ${JSON.stringify(SECTION_IDS)}
const SECTION_NAMES = ${JSON.stringify(Object.fromEntries(SECTIONS.map((s) => [s.id, s.nav])))}
const TASK_PART = ${JSON.stringify(TASK_PART)}

${sectionFor}

${taskFor}

${taskHash}

function showSection() {
  const current = sectionFor(location.hash, SECTION_IDS)
  for (const section of document.querySelectorAll('main > section[id]')) section.hidden = section.id !== current
  for (const link of document.querySelectorAll('nav a[href]')) {
    if (link.hash === '#' + current) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  showDrawer()
}

// The drawer over it. **Nothing here touches the section behind it** — it is
// already drawn, it keeps its own scroll and its own sort, and that is the
// whole of what a drawer is for (ADR 0022).
//
// The only things it fetches, and only when a task is open: the task, which is
// not in the snapshot (ADR 0020 part 3), and what its agent is saying, which is
// read here as well as on the timer so that opening one does not mean waiting
// for the next tick to see anything (ADR 0021).
function showDrawer() {
  const number = taskFor(location.hash, SECTION_IDS)
  document.getElementById('task-drawer').hidden = number === null
  if (number === null) return
  loadTask(number)
  refreshLog()
}

// Closing it is a person acting on the page, so the fragment follows them to
// the bare section: leaving \`#queue/task/0043\` in the address bar after they
// closed it would be the page lying about where they are. **Landing is the
// other way round and is untouched** — a page that corrects a fragment
// somebody typed loses the one thing the fragment was for, and that is about
// arriving rather than about acting (ADR 0022).
function closeTask() {
  if (taskFor(location.hash, SECTION_IDS) === null) return
  location.hash = '#' + sectionFor(location.hash, SECTION_IDS)
  showDrawer()
}

window.addEventListener('hashchange', showSection)
// Escape closes it, like the control in its head: a panel covering content with
// no obvious way back is worse than the section that got replaced.
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeTask() })
`
