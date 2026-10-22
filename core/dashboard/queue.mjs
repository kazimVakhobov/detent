// The queue: four folders, and a card for each task in them.
//
// It was four tables of two or three columns, inside a grid that gives each
// folder about a third of the width, and a column that narrow cannot hold what
// the journal already knows about a task. What did not fit was not shown: the
// words **abandoned by hand** in `failed/` sat under the height of the row they
// were in and were never seen. A card is the other way round — the number and
// its name on one line, and every fact on a line of its own, so there is no
// fold inside a row for a word to fall through. A card's own rows do not wrap
// either: what is laid out in a row stays in one row, and anything longer than
// a row is a line.
//
// **A task being run right now is marked where it sits**, and comes first in
// its folder. Nothing moves the file until `settle`, so a running task sits in
// `todo/` among the ones nothing has touched — under the same line saying the
// journal had never seen it. The page knew otherwise all along: `active` is in
// the snapshot it has already read. No new read and no new endpoint, and no
// guess about what the run is doing (ADR 0017).
//
// **Nothing here writes.** detent has already read this queue and moves tasks
// between these folders by its own results; a second writer of those files is a
// bug that arrives later disguised as a mystery (§12). So the section says how
// to make a task and how to run one, with this product's own paths in it,
// rather than offering a button that would be that second writer.

// The readable name, from the slug. A task is
// `0043-a-task-is-something-you-can-open.md`, and `0043
// a-task-is-something-you-can-open` reads as a file name rather than as a name
// — so the dashes become spaces and the first letter is raised. Nothing is
// added to the frontmatter to hold this: the slug already *is* the name, and a
// second place to keep it is a second place to get it wrong.
//
// This is the function the page runs — it is serialised into the script below,
// so what a test calls and what a browser calls are the same code.
export function taskName(slug) {
  const words = String(slug || '').split('-').filter(Boolean).join(' ')
  return words === '' ? 'no name' : words[0].toUpperCase() + words.slice(1)
}

// The number a new task would take: one past the highest across all four
// folders, which is the counter `nextId` reads on disk — there is no counter
// file, and therefore nothing that can disagree with reality (§4).
export function nextNumber(folders) {
  const ids = Object.values(folders).flat().map((task) => Number(task.id))
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1).padStart(4, '0')
}

export const QUEUE = `// The queue as cards, the sort a click chooses, and how to make a task (§12).
${taskName}

${nextNumber}

// What a card can be sorted by: the key a click names, the heading it shows,
// which way it reads first, and the value it compares. Four headings for all
// four folders, because a person comparing them should not have to learn a
// different control in each.
const COLUMNS = [
  { key: 'id', label: 'Task', down: false, of: (t) => Number(t.id) },
  { key: 'name', label: 'Name', down: false, of: (t) => taskName(t.slug) },
  { key: 'repo', label: 'Repository', down: false, of: (t) => t.repo || '' },
  { key: 'finished', label: 'Finished', down: true, of: (t) => t.finished ? Date.parse(t.finished) : 0 },
]

// How each folder is sorted. A click leaves its choice here rather than in the
// markup, because the markup is replaced every three seconds and the choice
// must not be: a list that reordered itself under a reader would be worse than
// no sort at all.
//
// todo/ opens in the order a run takes it — ascending id, which is what
// \`schedule()\` sorts by — and done/ and failed/ open newest first, because the
// oldest thing you finished is not what a list of finished work is for.
const SORTS = {
  todo: { by: 'id', down: false },
  hold: { by: 'id', down: false },
  done: { by: 'finished', down: true },
  failed: { by: 'finished', down: true },
}

const column = (key) => COLUMNS.find((c) => c.key === key) || COLUMNS[0]

const compareValues = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))

// The id is the last word in every comparison, so an order is never left to
// whichever order the folder happened to be read in — and the direction
// carries that tiebreak with it, so a task the journal never dated sorts by its
// number and "newest first" puts the highest of those first.
function sortTasks(tasks, sort) {
  const by = column(sort.by)
  const way = sort.down ? -1 : 1
  return [...tasks].sort((a, b) => way * (compareValues(by.of(a), by.of(b)) || Number(a.id) - Number(b.id)))
}

// The headings, each a button, with the arrow on the one in force: which column
// and which way, so the order on the screen is never a mystery. Clicking the
// one already in force turns it round; clicking another takes that column the
// way it reads first.
function sortBar(folder) {
  const sort = SORTS[folder]
  return el('div', { class: 'sort', role: 'group', 'aria-label': 'Sort' }, COLUMNS.map((c) => {
    const chosen = c.key === sort.by
    const button = el('button', { type: 'button', class: 'quiet sort-by' + (chosen ? ' chosen' : ''), 'aria-pressed': chosen ? 'true' : 'false' },
      c.label, chosen ? el('span', { class: 'arrow', 'aria-hidden': 'true' }, sort.down ? ' ▼' : ' ▲') : null)
    button.addEventListener('click', () => {
      SORTS[folder] = chosen ? { by: c.key, down: !sort.down } : { by: c.key, down: c.down }
      drawQueue()
    })
    return button
  }))
}

// Which tasks are being run right now, by number: the claims in \`active\`,
// which the page has already read, and nothing else. A claim is a repository, a
// task, an attempt and a pid (ADR 0017) — **a claim whose process is gone is
// not a running task** and is not one of these, which is the same rule the
// landing section's Running now and the strip above every section follow.
//
// The folder the file is in is not part of a claim, and nothing moves the file
// until \`settle\`: so a task with a live claim is marked wherever its card is,
// which during a run is todo/.
function beingRun(s) {
  const live = new Map()
  for (const a of s.active) if (a.alive) live.set(Number(a.task), a)
  return live
}

// What a card says about a task being run right now: that it is running, and
// which attempt it is on. **Nothing about a phase** — which of the gauge, the
// link check, the acceptance pass or the merge is under way is recorded
// nowhere, so the page does not guess at it. An icon and a word like every
// other status on this page, so it is told apart by more than colour.
function runningLine(live) {
  return el('div', { class: 'line' }, el('span', { class: 'status running' },
    el('span', { class: 'icon', 'aria-hidden': 'true' }, '▶'), 'running, attempt ' + live.attempt))
}

// One task. The head is the one row that has to read like a title — the number
// and the name — and everything else is a line or a fact under it. The path is
// on the card too, small: it is what somebody opens the file with, and the name
// above it is not a file name any more.
function card(task, folder, s, parked, live) {
  // Whether the journal has a line for this task at all. Three nulls drawn as
  // dashes read like zeros — no attempts, no cost — and a task nothing has run
  // is a different thing from a task that ran and cost nothing.
  const seen = task.outcome !== null || task.attempts !== null || task.finished !== null
  const name = taskName(task.slug)
  const facts = []
  if (task.outcome) facts.push(status(task.outcome))
  if (task.repo) facts.push(el('span', {}, task.repo))
  if (typeof task.attempts === 'number') facts.push(el('span', {}, task.attempts + (task.attempts === 1 ? ' attempt' : ' attempts')))
  if (task.cost) facts.push(el('span', {}, runCost(task.cost)))
  if (task.finished) facts.push(el('span', {}, 'finished ' + when(task.finished)))
  if (task.verdict) facts.push(el('span', {}, 'acceptance: ' + task.verdict))

  return el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('a', { href: taskHash('queue', task.id), title: task.id + ' · ' + name },
        el('strong', { class: 'number' }, task.id), ' · ', el('span', { class: 'name' }, name))),
    // Under the head, because it is the one thing about this task that is true
    // now rather than something the journal said about it afterwards.
    live ? runningLine(live) : null,
    el('div', { class: 'line path' }, el('code', {}, s.product.queue + '/' + folder + '/' + task.id + '-' + task.slug + '.md')),
    facts.length ? el('div', { class: 'facts' }, facts) : null,
    // It runs alone, and nothing queued past it starts until it has landed (§8).
    task.touchesContract
      ? el('div', { class: 'line' }, el('span', { class: 'status look' },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, '!'), 'barrier — runs alone, and nothing queued after it starts'))
      : null,
    // Who put it in this folder, when the journal did not: hold/ is detent
    // waiting for a person, failed/ is a person who has stopped waiting for
    // detent. On a line of its own, which is the whole point of a card.
    parked && !task.outcome ? el('div', { class: 'line muted' }, parked) : null,
    // And never about a task something is running right now: the journal line
    // is written when the run ends, so "nothing has run it" was the page
    // saying nothing had touched a task it was watching an agent work on.
    seen || live ? null : el('div', { class: 'line muted' }, 'the journal has not seen this task — nothing has run it'),
    task.reason && !task.doubts.length ? el('div', { class: 'line muted' }, task.reason) : null,
    task.doubts.length ? el('ul', { class: 'doubts' }, task.doubts.map((d) => el('li', {}, d))) : null,
    task.branch ? el('div', { class: 'line muted' }, el('code', {}, task.branch)) : null)
}

// One folder's cards, with the sort above them — and **what is running
// first**, whatever the sort is: a task being worked on right now is not one
// entry in an ordering of things that have not started. The sort still decides
// everything else, and turning it round turns both halves round.
function cards(folder, tasks, s, parked) {
  const node = document.getElementById(folder)
  if (!tasks.length) {
    return node.replaceChildren(el('div', { class: 'empty' }, s.product.queue + '/' + folder + '/ is empty'))
  }
  const live = beingRun(s)
  const at = (task) => live.get(Number(task.id)) || null
  const sorted = sortTasks(tasks, SORTS[folder])
  const order = [...sorted.filter(at), ...sorted.filter((t) => !at(t))]
  node.replaceChildren(sortBar(folder), ...order.map((t) => card(t, folder, s, parked, at(t))))
}

// What the order of todo/ means, said out loud whatever the sort is. A control
// that lets a person reorder this view must not suggest the queue will run in
// the order shown: \`schedule()\` sorts by Number(id) and nothing on this page
// changes that.
function runOrder() {
  const sort = SORTS.todo
  const node = document.getElementById('todo-order')
  node.replaceChildren(el('span', {}, 'A run takes these in ascending task id, and a barrier alone.'))
  if (sort.by !== 'id' || sort.down) {
    node.append(el('span', { class: 'look' }, ' Sorted here by ' + column(sort.by).label.toLowerCase()
      + (sort.down ? ', the other way round' : '') + ' — the order a run takes them is unchanged.'))
  }
}

// How to make a task and how to run one, because the page cannot do either.
// The number is one past the highest across the four folders, the file is in
// this product's own queue, and the commands name this product's own directory,
// so what is on the screen is what somebody copies rather than a shape they
// have to translate.
function howTo(s) {
  const next = nextNumber(s.queue)
  const repo = s.repos.length ? s.repos[0].name : 'your-repo'
  const shape = [
    '---',
    'id: ' + next,
    'repo: ' + repo,
    'touches_contract: false',
    '---',
    '',
    '# Goal',
    '',
    'One paragraph: what must work when this is done.',
    '',
    '# Acceptance criteria',
    '',
    '- [ ] a checkable statement',
    '',
    '# Out of scope',
    '',
    'What not to do while you are in there.',
  ].join('\\n')
  const at = ' --product ' + s.product.dir

  document.getElementById('queue-how').replaceChildren(
    el('div', { class: 'group' },
      el('div', { class: 'legend' }, 'Make one'),
      el('p', { class: 'muted' }, 'The next number is ' + next + ', one past the highest in all four folders. Write the file, and a run takes it from there:'),
      el('pre', { class: 'body' }, s.product.queue + '/todo/' + next + '-<slug>.md\\n\\n' + shape),
      el('p', { class: 'muted' }, 'Or let an agent talk you through it — it writes the file:'),
      el('pre', { class: 'body' }, 'detent plan' + at)),
    el('div', { class: 'group' },
      el('div', { class: 'legend' }, 'Run one'),
      el('pre', { class: 'body' }, 'detent run' + at + '\\ndetent run ' + next + at),
      el('p', { class: 'muted' }, 'The first works the whole queue in ascending id; the second runs the one task you name.')),
    el('div', { class: 'status look' }, el('span', { class: 'icon', 'aria-hidden': 'true' }, '!'),
      'This page does not run or move tasks.'),
    el('p', { class: 'muted' }, 'detent has already read this queue and moves these files between the four folders by its own results. A second writer of them is a bug that arrives later disguised as a mystery, so making a task is a file you write and running one is a command you type.'))
}

// The snapshot the queue is drawn from, kept so that a click on a heading
// reorders what is already on the screen and reads nothing.
let shown = null

function drawQueue(s) {
  if (s) shown = s
  if (!shown) return
  cards('todo', shown.queue.todo, shown, null)
  cards('hold', shown.queue.hold, shown, 'parked by hand')
  cards('done', shown.queue.done, shown, null)
  cards('failed', shown.queue.failed, shown, 'abandoned by hand')
  runOrder()
  howTo(shown)
}
`
