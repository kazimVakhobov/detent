// Everything the page draws from `state.json`, and the few helpers it draws
// with. Every value is set as text — `createTextNode`, never markup — so a task
// title, a reviewer's doubt or a repository's name can never become an element.
// A status is an icon and a word; the colour only repeats them.

export const VIEW = `const OUTCOME = {
  passed: ['✓', 'passed'], rejected: ['⚑', 'rejected'], escalated: ['▲', 'escalated'],
  error: ['✕', 'error'], skipped: ['–', 'skipped'],
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

// Every table that lists a task opens it: the fragment carries the number, so
// a row is a link somebody can send and reload, and a task with no row in any
// table is still reachable by typing one (ADR 0020 part 3).
const opens = (id, slug) => el('a', { href: '#' + TASK_SECTION + '/' + id }, id + (slug ? ' ' + slug : ''))

// A task in the queue, and why it is where it is. The same two cells serve
// hold/ and failed/: one is detent waiting for a person, the other is a person
// who has stopped waiting for detent.
function queued(t) {
  return el('div', {}, el('strong', {}, opens(t.id, t.slug)), el('div', { class: 'muted' }, t.branch ? el('code', {}, t.branch) : ''))
}
function because(t, parked) {
  return el('div', {}, t.outcome ? status(t.outcome) : el('span', { class: 'muted' }, parked),
    t.reason && !t.doubts.length ? el('div', { class: 'muted' }, t.reason) : null,
    t.doubts.length ? el('ul', { class: 'doubts' }, t.doubts.map((d) => el('li', {}, d))) : null)
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

  table(document.getElementById('todo'), [['Task'], ['Repository']], s.queue.todo.map((t) => [opens(t.id, t.slug), t.repo || '—']), s.product.queue + '/todo/ is empty')
  table(document.getElementById('hold'), [['Task'], ['Why']], s.queue.hold.map((t) => [queued(t), because(t, 'parked by hand')]), 'nothing paused')
  table(document.getElementById('done'), [['Task'], ['Repository'], ['Outcome']],
    s.queue.done.map((t) => [opens(t.id, t.slug), t.repo || '—', t.outcome ? status(t.outcome) : el('span', { class: 'muted' }, '—')]), s.product.queue + '/done/ is empty')
  table(document.getElementById('failed'), [['Task'], ['Repository'], ['Why']],
    s.queue.failed.map((t) => [queued(t), t.repo || '—', because(t, 'abandoned by hand')]), s.product.queue + '/failed/ is empty')

  numbersFor('by-model', 'Agent and model', n.byModel)

  table(document.getElementById('recent'), [['Finished'], ['Task'], ['Repository'], ['Outcome'], ['Attempts', 'num'], ['Cost', 'num']],
    s.recent.map((r) => [when(r.finished), opens(r.task, r.slug), r.repo, status(r.outcome), r.attempts, runCost(r.cost)]), 'no runs yet')

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
  // refresh. An open editor is never re-read (ADR 0020 part 2).
  await refreshConfig()
}
`
