// Everything the page draws from `state.json`, and the few helpers it draws
// with. Every value is set as text — `createTextNode`, never markup — so a task
// title, a reviewer's doubt or a repository's name can never become an element.
// A status is an icon and a word; the colour only repeats them.

// How many of `todo/` the landing section lists before it sends somebody to
// Queue for the rest. "The next few" is what a person wants to see above the
// fold; the whole queue is a table, and there is already a section for it.
export const NEXT_UP = 5

export const VIEW = `const NEXT_UP = ${NEXT_UP}

const OUTCOME = {
  passed: ['✓', 'passed'], rejected: ['⚑', 'rejected'], escalated: ['▲', 'escalated'],
  error: ['✕', 'error'], skipped: ['–', 'skipped'], stale: ['▲', 'stale'],
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v)
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function status(outcome) {
  const [icon, label] = OUTCOME[outcome] || ['·', outcome || '—']
  return el('span', { class: 'status ' + (outcome || 'info') }, el('span', { class: 'icon', 'aria-hidden': 'true' }, icon), label)
}

function table(node, head, rows, empty) {
  node.replaceChildren()
  if (!rows.length) { node.append(el('tr', {}, el('td', { class: 'empty' }, empty))); return }
  node.append(el('thead', {}, el('tr', {}, head.map(([label, cls]) => el('th', cls ? { class: cls } : {}, label)))))
  node.append(el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((c, i) => el('td', head[i][1] ? { class: head[i][1] } : {}, c))))))
}

const pct = (x) => x === null || x === undefined ? '—' : Math.round(x * 100) + '%'
function cost(c) {
  if (!c) return '—'
  if (c.usd !== undefined) return '$' + c.usd.toFixed(2)
  return Math.round(c.tokens).toLocaleString('en-US') + ' tok'
}
function runCost(c) {
  if (!c) return '—'
  if (typeof c.usd === 'number') return '$' + c.usd.toFixed(2)
  if (c.tokens) return (c.tokens.input + c.tokens.output).toLocaleString('en-US') + ' tok'
  return '—'
}
const when = (iso) => iso ? new Date(iso).toLocaleString() : '—'
const agent = (r) => r ? r.agent + (r.model ? ' ' + r.model : '') : '—'

function tile(label, value, note, cls) {
  return el('div', { class: 'tile' + (cls ? ' ' + cls : '') }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), note ? el('div', { class: 'note' }, note) : null)
}

// The numbers table every grouping shares: by model, and by repository.
const NUMBERS = [['Runs', 'num'], ['Passed', 'num'], ['Pass rate', 'num'], ['Attempts/run', 'num'], ['Cost/pass', 'num']]
function numbersFor(id, head, groups) {
  table(document.getElementById(id), [[head], ...NUMBERS],
    groups.map((r) => [r.name || '—', r.runs, r.passed, pct(r.passRate), r.attemptsPerRun.toFixed(1), cost(r.costPerPass)]), 'no runs yet')
}

// Every table that lists a task opens it, **over the section the table is in**:
// the fragment carries both (ADR 0022), so a row is a link somebody can send
// and reload, and a task with no row in any table is still reachable by typing
// one (ADR 0020 part 3). The section is written at the call rather than read
// off the fragment — a row's link must not depend on what was on the screen
// when the page last drew it.
const opens = (section, id, slug) => el('a', { href: taskHash(section, id) }, id + (slug ? ' ' + slug : ''))

// A paused task, and why it stopped: the two cells "Waiting for you" is made
// of. Queue draws the same tasks as cards, because a folder there has a third
// of the width and a row that narrow hides what does not fit (\`queue.mjs\`);
// here the table is the width of the page and a row holds its two cells.
function queued(t) {
  return el('div', {}, el('strong', {}, opens('overview', t.id, t.slug)), el('div', { class: 'muted' }, t.branch ? el('code', {}, t.branch) : ''))
}
function because(t, parked) {
  return el('div', {}, t.outcome ? status(t.outcome) : el('span', { class: 'muted' }, parked),
    t.reason && !t.doubts.length ? el('div', { class: 'muted' }, t.reason) : null,
    t.doubts.length ? el('ul', { class: 'doubts' }, t.doubts.map((d) => el('li', {}, d))) : null)
}

// ——— What is happening and what is next: the landing section (§12).

// How long a run has been going, from two instants the snapshot already
// carries: the claim's \`started\` and the read's own \`generated\`. The browser's
// clock is never asked — a machine a minute out would otherwise be told a run
// started in the future — and nothing here says how much longer it has, or
// what it will cost, because both are predictions and this page says what is
// true.
function going(from, to) {
  if (!from) return 'started at an unknown time'
  const seconds = Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000))
  if (seconds < 60) return 'going for ' + seconds + 's'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return 'going for ' + minutes + 'm'
  return 'going for ' + Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
}

// Which repository, which task, which attempt, and how long. When nothing is
// running it is a sentence: an empty box reads the same whether nothing is
// running or the page failed to draw what is.
//
// Alive runs only. A run whose process is gone is not working on anything, and
// saying so is the strip's job above every section rather than this block's.
function nowRunning(s, live) {
  if (!live.length) {
    const waiting = s.queue.todo.length
    return [el('p', { class: 'muted' }, waiting
      ? 'Nothing is running. ' + (waiting === 1 ? 'One task is' : waiting + ' tasks are')
        + ' queued, and a run takes them in the order below.'
      : 'Nothing is running, and nothing is queued.')]
  }
  return live.map((a) => el('div', { class: 'run' },
    el('div', { class: 'run-head' },
      el('strong', {}, a.repo),
      el('span', { class: 'muted' }, 'task'),
      opens('overview', a.task, null),
      el('span', { class: 'muted' }, 'attempt ' + a.attempt),
      el('span', { class: 'muted' }, going(a.started, s.generated))),
    a.branch ? el('div', { class: 'muted' }, el('code', {}, a.branch)) : null))
}

// The next few, in the order a run would take them. \`schedule()\` sorts by
// Number(id), so this sorts the same way rather than trusting the order the
// snapshot happened to arrive in — and the line above the table says the order
// out loud, because a list that looks arbitrary teaches the wrong thing about
// how the queue works.
//
// A barrier is marked as one: it runs alone, and nothing queued past it starts
// until it has landed (§8). Everything behind it says which task it is behind.
function nextUp(s) {
  const todo = [...s.queue.todo].sort((a, b) => Number(a.id) - Number(b.id))
  const shown = todo.slice(0, NEXT_UP)
  const barrier = shown.findIndex((t) => t.touchesContract)
  // \`replaceChildren\` takes nodes or strings, and a null among them would be
  // drawn as the word — so the rest of the sentence is appended rather than
  // passed as an argument that may not be there.
  const order = document.getElementById('next-up-order')
  order.replaceChildren(el('span', {}, 'The order a run takes them: ascending task id, and a barrier alone.'))
  if (todo.length > shown.length) {
    order.append(
      el('span', {}, ' The next ' + shown.length + ' of ' + todo.length + ' — the rest are in '),
      el('a', { href: '#queue' }, SECTION_NAMES.queue),
      el('span', {}, '.'))
  }
  table(document.getElementById('next-up'), [['Order', 'num'], ['Task'], ['Repository'], ['Runs']],
    shown.map((t, i) => [i + 1, opens('overview', t.id, t.slug), t.repo || '—', runsWhen(t, i, barrier, shown)]),
    s.product.queue + '/todo/ is empty')
}

function runsWhen(task, index, barrier, shown) {
  if (task.touchesContract) {
    return el('span', { class: 'status look' }, el('span', { class: 'icon', 'aria-hidden': 'true' }, '!'),
      'barrier — alone, and nothing after it starts')
  }
  if (barrier !== -1 && index > barrier) return el('span', { class: 'muted' }, 'after task ' + shown[barrier].id)
  return el('span', { class: 'muted' }, '—')
}

function standing(r) {
  if (r.missing) return el('span', { class: 'status error' }, el('span', { class: 'icon' }, '✕'), 'not a git repository')
  if (!r.integration) return el('span', { class: 'status error' }, el('span', { class: 'icon' }, '✕'), 'no agent/dev — create it from ' + r.compare)
  if (!r.divergence) return el('span', { class: 'status look' }, el('span', { class: 'icon' }, '!'), r.compare + ' does not exist here')
  const d = r.divergence
  const parts = []
  if (d.ahead === 0 && d.behind === 0) return el('span', { class: 'status passed' }, el('span', { class: 'icon' }, '≡'), 'agent/dev ≡ ' + r.compare)
  if (d.tasksAhead > 0) parts.push(el('div', { class: 'status info' }, el('span', { class: 'icon' }, '→'), d.tasksAhead + (d.tasksAhead === 1 ? ' task' : ' tasks') + ' ahead of ' + r.compare + ' — waiting for your review'))
  else if (d.ahead > 0) parts.push(el('div', { class: 'status info' }, el('span', { class: 'icon' }, '→'), d.ahead + ' commits ahead of ' + r.compare))
  if (d.behind > 0) parts.push(el('div', { class: 'status look' }, el('span', { class: 'icon' }, '▲'), d.behind + (d.behind === 1 ? ' commit' : ' commits') + ' behind ' + r.compare + ' — agents cannot see your work'))
  return el('div', {}, parts)
}

// Which run is active, kept for the configuration panel: the same snapshot
// already being read, rather than a second request asking the same question.
// It is what refuses the editor and never the view (ADR 0020 part 2).
let running = []

function render(s) {
  document.title = 'detent — ' + s.product.name
  document.getElementById('name').textContent = s.product.name
  document.getElementById('summary').textContent = s.product.summary || ''
  const state = document.getElementById('state')
  state.className = 'chip' + (s.running ? ' running' : '')
  running = s.active.filter((a) => a.alive)
  document.getElementById('state-text').textContent = s.running
    ? 'running — ' + running.map((a) => a.repo + ' · task ' + a.task).join(', ') + ' (the configuration is written between runs)'
    : 'idle'

  renderWarnings(s)

  // How the runs have gone, first on the landing screen: these are the
  // figures somebody opens the page to see, and the heading over them says
  // what they are rather than asking whether they were worth it.
  const n = s.numbers
  const all = n.all
  const figures = document.getElementById('figures')
  figures.replaceChildren(
    tile('Pass rate', all ? pct(all.passRate) : '—', all ? all.passed + ' of ' + all.runs + ' runs passed' : 'no runs yet', 'hero'),
    tile('Cost per pass', all ? cost(all.costPerPass) : '—', 'every attempt of every run counted'),
    tile('Attempts per run', all ? all.attemptsPerRun.toFixed(1) : '—', 'the gauge sent the agent back'),
    tile('Green but not done', n.blindSpot.read ? pct(n.blindSpot.rejected / n.blindSpot.read) : '—', n.blindSpot.read ? n.blindSpot.rejected + ' of ' + n.blindSpot.read + ' green runs the reviewer read' : 'no run reviewed yet'),
    tile('Paused', String(s.queue.hold.length), s.queue.hold.length ? 'waiting for you' : 'nothing waiting'),
  )
  if (n.batches.checked) {
    figures.append(tile('Red batch', pct(n.batches.red / n.batches.checked), n.batches.red + ' of ' + n.batches.checked + ' batches red with every task green'))
  }

  // And under them, what is happening, what is next, and what is waiting for a
  // person — the three blocks in the order a person asks them in, which is the
  // order they have always been in (§12).
  document.getElementById('now').replaceChildren(...nowRunning(s, running))
  nextUp(s)
  table(document.getElementById('waiting'), [['Task'], ['Repository'], ['Why']],
    s.queue.hold.map((t) => [queued(t), t.repo || '—', because(t, 'parked by hand')]), 'nothing is waiting for you')

  // Where each repository stands, and no column for its models: which model it
  // uses is read in the configuration, which is the one place it is written
  // (ADR 0020 part 2).
  table(document.getElementById('repos'), [['Repository'], ['agent/dev'], ['Lock'], ['Now']], s.repos.map((r) => [
    el('strong', {}, r.name),
    standing(r),
    r.lock === 'enforced' ? el('span', {}, el('code', {}, r.gauge.join(' · '))) : el('span', { class: 'status look' }, el('span', { class: 'icon' }, '!'), 'no gauge'),
    r.active ? 'task ' + r.active.task + ', attempt ' + r.active.attempt + (r.active.alive ? '' : ' — run gone, detent recover') : el('span', { class: 'muted' }, r.clean === false ? 'tree not clean' : 'idle'),
  ]), 'no repositories')
  numbersFor('by-repo', 'Repository', n.byRepo)

  // The four folders, each task a card — and what the order of todo/ means,
  // and how to make a task and run one, because this page does neither
  // (\`queue.mjs\`).
  drawQueue(s)

  numbersFor('by-model', 'Agent and model', n.byModel)

  table(document.getElementById('recent'), [['Finished'], ['Task'], ['Repository'], ['Outcome'], ['Attempts', 'num'], ['Cost', 'num']],
    s.recent.map((r) => [when(r.finished), opens('runs', r.task, r.slug), r.repo, status(r.outcome), r.attempts, runCost(r.cost)]), 'no runs yet')

  const notes = ['read at ' + new Date(s.generated).toLocaleTimeString(), s.product.dir]
  if (n.skipped) notes.push(n.skipped + ' skipped runs not counted')
  if (n.unreadable) notes.push(n.unreadable + ' journal lines unreadable')
  if (s.queueProblems.length) notes.push('the queue has problems: ' + s.queueProblems.join('; '))
  document.getElementById('footer').textContent = notes.join(' · ')
  lockEditing()
}

async function refresh() {
  try {
    const response = await fetch('state.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(response.status + ' ' + (await response.text()))
    render(await response.json())
  } catch (error) {
    document.getElementById('state-text').textContent = 'cannot read the product: ' + error.message
  }
  // The page's one timer reads the configuration view too — a view may
  // refresh. An open editor is never re-read (ADR 0020 part 2). And the end of
  // what an open task's agent is printing, which is the one thing on this page
  // that is behind by design rather than by accident (ADR 0021).
  await refreshConfig()
  await refreshLog()
}
`
