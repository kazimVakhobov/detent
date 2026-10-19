// The configuration panel: the one thing this page writes (ADR 0015).
//
// What the file says, read once and again after a write — never polled: a form
// whose values move under the person filling it in would be a third state
// between what the file says and what the page shows. The inputs are disabled
// while a run is active, and the server refuses the write anyway, because a
// disabled input is a courtesy and the refusal is the rule.
//
// Moved into a section of its own by ADR 0020 part 1 and otherwise unchanged;
// part 2 is what separates reading it from writing it.

// The keys with one value each, in the order they are drawn. Data rather than
// lines of the script, so what the page offers can be read off the module
// instead of out of its source: these are `EDITABLE` less `models`, which the
// fields above them cover.
export const LIMITS = [
  ['attempts', 'attempts — tries before a task pauses', { type: 'number', min: '1', step: '1' }],
  ['timeout', 'timeout — minutes an agent may run', { type: 'number', min: '0', step: 'any' }],
  ['concurrency', 'concurrency — tasks at once', { type: 'number', min: '1', step: '1' }],
  ['notify', 'notify — a command run when a task finishes', { type: 'text' }],
]

export const CONFIGURATION = `// The configuration. What the file says, read once and again after a write;
// which run is active comes from the snapshot that is already being read.
let config = null
let fields = []

const LIMITS = ${JSON.stringify(LIMITS)}

const note = (text) => { document.getElementById('config-note').textContent = text }

function problems(list) {
  document.getElementById('config-problems').replaceChildren(...list.map((p) => el('li', {}, el('code', {}, p))))
}

// A role: which agent, and optionally which model of it. The empty option is
// not a blank — for a repository it means the product's setting, and it says
// which one that is, because a repository overrides a role and never "the
// model".
function modelField(label, current, inherited) {
  const select = el('select')
  select.append(el('option', { value: '' }, inherited ? 'the product setting — ' + agent(inherited) : 'not set'))
  for (const name of config.agents) {
    const option = el('option', { value: name }, name)
    if (current && current.agent === name) option.selected = true
    select.append(option)
  }
  const model = el('input', { type: 'text', placeholder: 'model — optional' })
  model.value = current && current.model ? current.model : ''
  const read = () => {
    if (select.value === '') return null
    const text = model.value.trim()
    return text === '' ? { agent: select.value } : { agent: select.value, model: text }
  }
  return { node: el('div', { class: 'field' }, el('label', {}, label), el('div', { class: 'pair' }, select, model)), read }
}

// One value, with the default it falls back to as the placeholder: an empty
// field leaves the key out of the file rather than writing the default into it.
function valueField(label, key, attrs) {
  const field = config[key]
  const input = el('input', attrs)
  input.placeholder = field.effective === null ? 'none' : field.effective + ' — the default'
  input.value = field.value === null ? '' : String(field.value)
  const read = () => {
    const text = input.value.trim()
    if (text === '') return null
    return attrs.type === 'number' ? Number(text) : text
  }
  return { node: el('div', { class: 'field' }, el('label', {}, label), input), read }
}

function renderConfig() {
  fields = []
  const groups = []

  const product = el('div', { class: 'group' }, el('div', { class: 'legend' }, 'Models for the product'))
  for (const name of config.roles) {
    const field = modelField(name, config.models[name], null)
    fields.push({ write: (patch) => { patch.models[name] = field.read() } })
    product.append(field.node)
  }
  groups.push(product)

  const limits = el('div', { class: 'group' }, el('div', { class: 'legend' }, 'Attempts, time, and how many at once'))
  for (const [key, label, attrs] of LIMITS) {
    const field = valueField(label, key, attrs)
    fields.push({ write: (patch) => { patch[key] = field.read() } })
    limits.append(field.node)
  }
  groups.push(limits)

  for (const repo of config.repos) {
    if (repo.name === null) continue
    const group = el('div', { class: 'group' }, el('div', { class: 'legend' }, 'Models for ' + repo.name))
    const reads = config.roles.map((name) => {
      const field = modelField(name, repo.models[name], repo.inherited[name])
      group.append(field.node)
      return [name, field.read]
    })
    fields.push({
      write: (patch) => {
        const models = {}
        for (const [name, read] of reads) models[name] = read()
        patch.repos.push({ name: repo.name, models })
      },
    })
    groups.push(group)
  }

  document.getElementById('config-fields').replaceChildren(...groups)
  table(document.getElementById('fixed'), [['Key'], ['Now'], ['Not editable here, because']],
    config.notEditable.map((k) => [el('code', {}, k.key), k.shown, k.why]), 'nothing')
  lock()
}

// A disabled input is a courtesy; the server refuses the write regardless, and
// the explanation is part of the feature rather than a nicety.
function lock() {
  const active = running.length > 0
  for (const node of document.querySelectorAll('#config input, #config select, #config button')) node.disabled = active
  const node = document.getElementById('config-lock')
  if (!active) return node.replaceChildren()
  const what = running.map((a) => a.repo + ' on task ' + a.task + ', attempt ' + a.attempt).join('; ')
  node.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, '▲'),
    'A run is active — ' + what + '. The configuration is written between runs, and the server refuses a write now whatever this page allows.')
}

async function loadConfig() {
  try {
    const response = await fetch('configuration.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(response.status + ' ' + (await response.text()))
    config = await response.json()
    renderConfig()
  } catch (error) {
    note('cannot read the configuration: ' + error.message)
  }
}

async function save() {
  if (!config) return
  const patch = { models: {}, repos: [] }
  for (const field of fields) field.write(patch)
  note('saving…')
  problems([])
  try {
    const response = await fetch('configuration.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const result = await response.json()
    note(result.message || '')
    if (response.ok) {
      config = result.configuration
      renderConfig()
      note('saved — this is what ' + config.file + ' now says')
    } else {
      problems(result.problems || [])
    }
  } catch (error) {
    note('cannot save: ' + error.message)
  }
  refresh()
}
`
