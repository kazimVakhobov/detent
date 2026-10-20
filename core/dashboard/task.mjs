// One task, opened by its number (ADR 0020 part 3).
//
// **What its attempts did comes first**, directly under the head. The file is
// written head, frontmatter, goal, criteria, out-of-scope — and that is the
// opposite of the order it is read in. Somebody opening a task that has run
// wants "what happened and what did it cost"; the body is what they scroll to
// when the answer raises a question, not four blocks to scroll past before
// finding out whether it ran at all.
//
// **Every number in that block is already in the journal line** (§11), and
// nothing here records one. No rate, no average, no projection either:
// `summary` and the Agents section are where numbers are compared, and this is
// one task's record.
//
// **The body is text.** A task body is markdown written by whoever wrote the
// task, and detent renders no markdown: every line of it arrives as a text
// node inside a `pre`, so nothing in a task file can become markup and there
// is no sanitiser here to be wrong about (ADR 0006). The structure comes from
// the sections `parseTask` already found, which is why there are headings at
// all.
//
// It is fetched when a task is opened and never polled: the state the page
// polls is the snapshot, and a task body does not change under a reader the way
// a run's numbers do.

export const TASK = `// One task, from task.json — fetched when it is opened, never polled.
let opened = null

const legend = (text, ...nodes) => el('div', { class: 'group' }, el('div', { class: 'legend' }, text), nodes)
const icon = (glyph) => el('span', { class: 'icon', 'aria-hidden': 'true' }, glyph)
const scrolled = (node) => el('div', { class: 'scroll' }, node)

// As written. A text node in a <pre>: the sections are already parsed, and
// nothing in the file gets to be markup (ADR 0020 part 3).
function asWritten(lines) {
  const text = (lines || []).join('\\n').trim()
  return text === '' ? el('div', { class: 'muted' }, 'nothing under that heading') : el('pre', { class: 'body' }, text)
}

function frontmatter(fields) {
  const node = el('table')
  table(node, [['Key'], ['Value']], Object.entries(fields).map(([key, value]) => [el('code', {}, key), String(value)]), 'nothing')
  return scrolled(node)
}

// A field the journal line has as null, said as what it is. Never a zero and
// never a dash beside real figures: both read as a number, and an invented
// number is the one thing the journal has always refused (§11).
const notReported = () => el('span', { class: 'muted' }, 'not reported')

// What the reviewer said and what it doubted, as the journal recorded it: this
// is a record of the acceptance pass and never a second one.
function verdict(run) {
  const acceptance = run.acceptance
  if (!acceptance) return notReported()
  const doubts = acceptance.doubts || []
  return el('div', {},
    el('div', {}, acceptance.verdict || notReported()),
    doubts.length ? el('ul', { class: 'doubts' }, doubts.map((d) => el('li', {}, d))) : null,
    run.reason && !doubts.length ? el('div', { class: 'muted' }, run.reason) : null)
}

// Whether its links checked, from the line the run wrote (ADR 0014). "0
// checked" is a task that named no documents, and must not read as a task
// whose documents were all found.
function checked(links) {
  if (!links) return notReported()
  const broken = links.broken || []
  return el('div', {}, links.checked + ' checked',
    broken.length ? el('ul', { class: 'doubts' }, broken.map((p) => el('li', {}, el('code', {}, p)))) : null)
}

const money = (usd) => (usd < 0 ? '-$' : '$') + Math.abs(usd).toFixed(2)
const count = (n) => n.toLocaleString('en-US')

// Dollars only if the line has them. \`addCost\` clears \`usd\` to null the moment
// one call does not report its own, so a figure here is a total and never a
// part of one pretending to be.
const dollars = (c) => c && typeof c.usd === 'number' ? el('span', {}, money(c.usd)) : notReported()

// Tokens in and out, and their sum — the sum is what a reader compares and the
// two halves are what makes it checkable against the line.
function tokensOf(c) {
  if (!c || !c.tokens) return notReported()
  return el('span', {}, count(c.tokens.input + c.tokens.output) + ' tok',
    el('span', { class: 'muted' }, ' (' + count(c.tokens.input) + ' in, ' + count(c.tokens.output) + ' out)'))
}

// What the implementation cost: the run's total, less what the acceptance pass
// cost. Those are the only two numbers the line carries, and nothing else is
// added up to get here. Dollars come off dollars and tokens off tokens, each
// kind absent on its own — and a difference that comes out negative is shown as
// it comes out, beside the total it was taken from: two numbers in one line
// disagreeing is a fact about the journal, not something to tidy away on the
// way to the screen.
function less(total, part) {
  if (!total) return null
  return {
    usd: typeof total.usd === 'number' ? total.usd - (part && typeof part.usd === 'number' ? part.usd : 0) : null,
    tokens: total.tokens ? {
      input: total.tokens.input - (part && part.tokens ? part.tokens.input : 0),
      output: total.tokens.output - (part && part.tokens ? part.tokens.output : 0),
    } : null,
  }
}

// Which model a pass ran on: the name that was asked for, and the name the CLI
// reported if it reported one. They are two facts and the line keeps them
// apart, so a request the CLI never confirmed says that rather than standing in
// for a confirmation — \`actual\` is null until something tells detent otherwise.
function ranOn(role) {
  if (!role) return notReported()
  const asked = role.requested || null
  const actual = role.actual || null
  if (actual && asked && actual !== asked) {
    return el('span', {}, role.agent + ' · ' + actual, el('span', { class: 'muted' }, ' (asked for ' + asked + ')'))
  }
  if (actual) return el('span', {}, role.agent + ' · ' + actual)
  if (asked) return el('span', {}, role.agent + ' · ' + asked, el('span', { class: 'muted' }, ' (requested — the CLI reported no model)'))
  return el('span', {}, role.agent, el('span', { class: 'muted' }, ' — no model named'))
}

// How long it ran, from the two instants the line carries and from no clock on
// this machine. A run with no \`finished\` never got to write one and says so: it
// is not measured against now, which would turn a crashed run into one that is
// still going.
function took(started, finished) {
  if (!started || !finished) return notReported()
  const seconds = Math.round((new Date(finished) - new Date(started)) / 1000)
  if (seconds < 60) return el('span', {}, seconds + 's')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return el('span', {}, minutes + 'm ' + (seconds % 60) + 's')
  return el('span', {}, Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm')
}

const howMany = (n) => typeof n === 'number' ? n + (n === 1 ? ' attempt' : ' attempts') : el('span', {}, 'attempts ', notReported())

// The two passes a run pays for, kept apart: the agent that did the work and
// the reviewer that read it. One number for both would hide the thing the
// acceptance pass exists to be judged on (ADR 0004) — what reading the work
// cost against what doing it cost.
function spending(run) {
  const node = el('table')
  const paid = run.acceptance ? run.acceptance.cost : null
  const implement = less(run.cost, paid)
  const models = run.models || {}
  table(node, [['Pass'], ['Cost', 'num'], ['Tokens', 'num'], ['Model']], [
    ['Implementation', dollars(implement), tokensOf(implement), ranOn(models.implement)],
    ['Acceptance', dollars(paid), tokensOf(paid), ranOn(models.accept)],
  ], 'nothing')
  return scrolled(node)
}

// Whether it landed, and on what. A merge is the end of a run that worked
// (§10); a branch with no merge on it is work still sitting there.
function landed(run) {
  return el('div', { class: 'facts' },
    run.merged
      ? el('span', { class: 'status passed' }, icon('✓'), 'merged')
      : el('span', { class: 'status info' }, icon('·'), 'not merged'),
    run.commit ? el('span', {}, 'commit ', el('code', {}, run.commit)) : null,
    run.branch ? el('span', {}, el('code', {}, run.branch)) : null)
}

// One run. The head is the row that answers "what happened": what became of
// it, how many attempts it took, how long it ran and when it stopped.
//
// **A resumed run says so.** A task that came back from \`hold/\` and finished is
// not the same story as one that passed first time, and the attempt count alone
// does not tell them apart — \`resumed\` is in the line, so it is on the screen.
function ran(run) {
  return el('div', { class: 'run-record' },
    el('div', { class: 'facts' },
      status(run.outcome),
      run.repo ? el('span', {}, run.repo) : null,
      el('span', {}, howMany(run.attempts)),
      el('span', {}, 'took ', took(run.started, run.finished)),
      el('span', {}, 'finished ', run.finished ? el('span', {}, when(run.finished)) : notReported()),
      run.resumed ? el('span', { class: 'status info' }, icon('↻'), 'resumed — it carried on what an earlier run left behind') : null),
    spending(run),
    el('div', { class: 'line' }, 'The run: ', dollars(run.cost), ' · ', tokensOf(run.cost),
      el('span', { class: 'muted' }, ' — the total the line recorded, which the two rows above come out of')),
    run.gauge && run.gauge.failedStage
      ? el('div', { class: 'line' }, el('span', { class: 'status look' }, icon('!'),
        'the ' + (run.gauge.profile || 'exit') + ' gauge stopped on ' + run.gauge.failedStage))
      : null,
    el('div', { class: 'line' }, landed(run)),
    el('div', { class: 'line' }, el('span', { class: 'muted' }, 'acceptance: '), verdict(run)),
    el('div', { class: 'line' }, el('span', { class: 'muted' }, 'links: '), checked(run.links)))
}

// Every run of this task, and no other task's, in the order they happened. A
// task nothing has run says that in a sentence: a block of dashes where the
// figures go reads like a run that cost nothing.
function history(runs) {
  if (!runs.length) return el('div', { class: 'muted' }, 'this task has not run — the journal has no line for it')
  return el('div', { class: 'runs' }, runs.map(ran))
}

function renderTask(d) {
  const panel = document.getElementById('task-detail')
  if (d.refused) {
    return panel.replaceChildren(...[
      el('div', { class: 'status error' }, icon('✕'), d.message),
      d.problems && d.problems.length ? el('ul', { class: 'problems' }, d.problems.map((p) => el('li', {}, el('code', {}, p)))) : null,
    ].filter(Boolean))
  }

  // A number and a name, not a file name: \`0043 · A task is something you can
  // open\`, off the slug by the same helper the queue's cards use. The folder and
  // the path are still here, small — the path is what somebody opens the file
  // with, and the line above it is not a file name any more.
  const parts = [el('div', { class: 'task-head' },
    el('strong', {}, el('span', { class: 'number' }, d.id), ' · ', el('span', { class: 'name' }, taskName(d.slug))),
    el('span', { class: 'chip' }, d.folder),
    el('span', { class: 'muted' }, el('code', {}, d.where)))]

  // What happened and what it cost, before the body it happened to (§12).
  parts.push(legend('What its attempts did', history(d.history)))

  if (d.unreadable) {
    parts.push(el('div', { class: 'status error' }, icon('✕'), 'this file could not be read as a task'),
      el('ul', { class: 'problems' }, d.unreadable.problems.map((p) => el('li', {}, p))),
      legend('What the file says', el('pre', { class: 'body' }, d.unreadable.text)))
  } else {
    parts.push(legend('Frontmatter', frontmatter(d.frontmatter)))
    parts.push(legend('Goal', asWritten(d.goal)))
    parts.push(legend('Acceptance criteria', d.criteria.length
      ? el('ul', { class: 'doubts' }, d.criteria.map((c) => el('li', {}, c)))
      : el('div', { class: 'muted' }, 'none')))
    parts.push(legend('Out of scope', asWritten(d.outOfScope)))
  }

  panel.replaceChildren(...parts)
}

async function loadTask(number) {
  const panel = document.getElementById('task-detail')
  // The section named with no task after it — the nav's own link, or digits
  // that are not digits. Whatever is open stays open rather than being emptied.
  if (number === null) {
    if (opened === null) panel.replaceChildren(el('div', { class: 'muted' }, 'no task open — open one from the queue or the recent runs'))
    return
  }
  if (number === opened) return
  opened = number
  panel.replaceChildren(el('div', { class: 'muted' }, 'reading task ' + number + '…'))
  try {
    const response = await fetch('task.json?task=' + encodeURIComponent(number), { cache: 'no-store' })
    const detail = await response.json()
    if (opened === number) renderTask(detail)
  } catch (error) {
    panel.replaceChildren(el('div', { class: 'status error' }, icon('✕'), 'cannot read task ' + number + ': ' + error.message))
  }
}
`
