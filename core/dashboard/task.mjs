// One task, opened by its number (ADR 0020 part 3).
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

// What the reviewer said and what it doubted, as the journal recorded it: this
// is a record of the acceptance pass and never a second one.
function verdict(run) {
  const acceptance = run.acceptance
  if (!acceptance) return el('span', { class: 'muted' }, '—')
  const doubts = acceptance.doubts || []
  return el('div', {},
    el('div', {}, acceptance.verdict || '—'),
    doubts.length ? el('ul', { class: 'doubts' }, doubts.map((d) => el('li', {}, d))) : null,
    run.reason && !doubts.length ? el('div', { class: 'muted' }, run.reason) : null)
}

// Whether its links checked, from the line the run wrote (ADR 0014). "0
// checked" is a task that named no documents, and must not read as a task
// whose documents were all found.
function checked(links) {
  if (!links) return el('span', { class: 'muted' }, '—')
  const broken = links.broken || []
  return el('div', {}, links.checked + ' checked',
    broken.length ? el('ul', { class: 'doubts' }, broken.map((p) => el('li', {}, el('code', {}, p)))) : null)
}

// Every attempt of every run of this task, and no other task's.
function history(runs) {
  const node = el('table')
  table(node, [['Finished'], ['Outcome'], ['Attempts', 'num'], ['Cost', 'num'], ['Acceptance'], ['Links']],
    runs.map((r) => [when(r.finished), status(r.outcome), r.attempts, runCost(r.cost), verdict(r), checked(r.links)]),
    'this task has not run')
  return scrolled(node)
}

function renderTask(d) {
  const panel = document.getElementById('task-detail')
  if (d.refused) {
    return panel.replaceChildren(...[
      el('div', { class: 'status error' }, icon('✕'), d.message),
      d.problems && d.problems.length ? el('ul', { class: 'problems' }, d.problems.map((p) => el('li', {}, el('code', {}, p)))) : null,
    ].filter(Boolean))
  }

  const parts = [el('div', { class: 'task-head' },
    el('strong', {}, d.id + ' ' + d.slug),
    el('span', { class: 'chip' }, d.folder),
    el('span', { class: 'muted' }, el('code', {}, d.where)))]

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

  parts.push(legend('What its attempts did', history(d.history)))
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
