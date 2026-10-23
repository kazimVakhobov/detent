// The configuration panel: read until a person says otherwise (ADR 0020
// part 2). Writing it is still the one thing this page does (ADR 0015).
//
// **Viewing is the default, and what the file says is shown as text.** Every
// value used to be a live `input` or `select` whether or not anybody meant to
// change one, so reading which model a repository uses meant reading the
// contents of form controls — and this is where a model is read: the
// repositories table stated the same fact in a format of its own, and two
// renderings of one fact are free to disagree.
//
// **Editing is entered deliberately, and leaving it discards.** Nothing is
// written but by the write the page already performed, and there is no prompt
// on the way out: a dialog that blocks the page is worse than losing an edit
// nobody had finished, and a queue of changes to apply later is the third
// state 0015 rejected.
//
// **It is entered from either panel it covers, and says so from both.** One
// editor spans this panel and Notifications, because they are one file — and
// the Notifications block is far enough down the page that the only way into it
// was to scroll back to a button that did not mention it, which made a panel
// that is read-only on purpose look like a panel whose controls had stopped
// working. So `PANELS` below is the two of them, each with the same three
// controls wired to the same three handlers, and while the editor is open each
// carries a line saying so. Still one mode: two editors over one `product.json`
// would be two sets of pending changes where the last Save wins silently.
//
// **The view refreshes; an open editor never does.** The rule this narrows was
// written as a comment rather than as an ADR: the configuration is fetched
// once and after a write and never polled, because "a form whose values move
// under the person filling it in would be a third state between what the file
// says and what the page shows". That argument is right and it is about a
// form. Opening the editor takes a read of its own, so what is edited is what
// the file currently says, and from then until it closes nothing moves under
// the person typing.
//
// **The model input is backed by a list and stays free text** (ADR 0019). The
// names come from `modelSuggestions` in `product.json`, the input offers them
// and accepts anything, and the line under it says where the list is and that
// any name may be typed — which is the question this panel could not answer
// before: there was nowhere to learn what a model name looks like. The list is
// shown and used here and edited in the file, like `repos` and `branches`.
//
// **Entering edit mode is refused while a run is active, and viewing is not.**
// The refusal carries the explanation 0015 made part of the feature — that a
// run is active, what it is working on, and that the server refuses whatever
// this page allows. Disabling the whole panel was correct for the writing and
// cost the reading with it: somebody who opens the page during a run to see
// which model is costing what found the answer greyed out.

// The keys with one value each, in the order they are drawn. Data rather than
// lines of the script, so what the page offers can be read off the module
// instead of out of its source: these are `EDITABLE` less `models`, which the
// fields above them cover, and less `notify`, which is a block of its own. The
// view and the editor both draw from this list, so a key cannot be readable and
// not editable, or the other way round.
//
// **`notify` left this list** (ADR 0025). Every row here is one value under one
// key, and `notify` is now which events and a list of channels — a row for it
// would have been a text input holding a shell command, labelled "run when a
// task finishes", which was never what the code did and is not what the key is
// any more.
export const LIMITS = [
  ['attempts', 'attempts — tries before a task pauses', { type: 'number', min: '1', step: '1' }],
  ['timeout', 'timeout — minutes an agent may run', { type: 'number', min: '0', step: 'any' }],
  ['concurrency', 'concurrency — tasks at once', { type: 'number', min: '1', step: '1' }],
]

export const CONFIGURATION = `// The configuration: a view that refreshes, and an editor that does not
// (ADR 0020 part 2). \`config\` is what the file said at the last read — the
// view's, or the one that opened the editor — and \`fields\` exists only while
// the editor is open.
let config = null
let editing = false
let fields = []

const LIMITS = ${JSON.stringify(LIMITS)}

// The two panels one editor covers, and the three controls each of them
// carries: \`<panel>-edit\`, \`-save\`, \`-discard\`, plus the line that says a
// run is active and the line that says this is being edited. Entering and
// leaving is visible from either, because the Notifications block is far enough
// down the page that the only way into it was to scroll back to a button that
// did not say it came here too (ADR 0025).
const PANELS = ['config', 'notify']

// Said in both, because a note about a write that covers both panels belongs
// wherever the person who asked for it is looking.
function note(text) {
  for (const panel of PANELS) document.getElementById(panel + '-note').textContent = text
}

function problems(list) {
  const items = () => list.map((p) => el('li', {}, el('code', {}, p)))
  document.getElementById('config-problems').replaceChildren(...items())
  document.getElementById('notify-save-problems').replaceChildren(...items())
}

// A repository overrides a role and never "the model" (§11), so a role it does
// not set is the product's — and the page says which one that is. From here,
// so the view and the editor's empty option cannot come to disagree.
const inherited = (from) => from ? 'the product setting — ' + agent(from) : 'not set'

// One value as the file has it, or the default it falls back to, said as a
// default: a key the file leaves out is not the same fact as a key that says
// the default out loud, and the editor's placeholder says the same thing.
function limit(field) {
  if (field.value !== null) return String(field.value)
  return field.effective === null ? 'none' : field.effective + ' — the default'
}

// ——— The view: what the file says, as text.

const reads = (label, value) => el('div', { class: 'field' }, el('span', { class: 'name' }, label), el('span', {}, value))

function viewConfig() {
  const groups = [
    legend('Models for the product', ...config.roles.map((role) => reads(role, config.models[role] ? agent(config.models[role]) : 'not set'))),
    legend('Attempts, time, and how many at once', ...LIMITS.map(([key, label]) => reads(label, limit(config[key])))),
  ]
  for (const repo of config.repos) {
    if (repo.name === null) continue
    groups.push(legend('Models for ' + repo.name,
      ...config.roles.map((role) => reads(role, repo.models[role] ? agent(repo.models[role]) : inherited(repo.inherited[role])))))
  }
  document.getElementById('config-view').replaceChildren(...groups)
  // The same read draws the block beside this one: notifications are this file
  // too, and two reads of one file are two states free to disagree (ADR 0025).
  viewNotify()
}

// Shown here and changed on disk, each with the reason it is not editable
// here: a disabled input nobody explains is worse than no input.
function renderFixed() {
  table(document.getElementById('fixed'), [['Key'], ['Now'], ['Not editable here, because']],
    config.notEditable.map((k) => [el('code', {}, k.key), k.shown, k.why]), 'nothing')
}

// ——— The editor: the same values as controls, built once from one read.

// The names on offer where a model is typed, and the one list every model
// input points at (ADR 0019).
//
// The list is a suggestion and the input stays free text: picking a name and
// typing one that is not there are both ordinary, and nothing on this page or
// behind it checks a model against the list. \`modelSuggestions\` is what the
// file says, or the list detent ships when it says nothing.
const MODEL_LIST = 'model-names'

// And the sentence the whole thing exists for. There was nowhere to learn what
// a model name looks like — no keys anywhere, no list — so this says where the
// names come from, where to add one, and that any name may be typed. It does
// not claim the list is what the account can run, because nothing this page
// has access to knows that.
function suggestions() {
  document.getElementById(MODEL_LIST).replaceChildren(...config.modelSuggestions.map((name) => el('option', { value: name })))
  document.getElementById('config-models-note').textContent =
    'The model names offered are modelSuggestions in ' + config.file + ', and yours to extend there. Any model name may be typed: the list is what detent has watched run, not what your account and your installed CLI can run between them, and nothing checks a model against it.'
}

// A role: which agent, and optionally which model of it. The empty option is
// not a blank — for a repository it means the product's setting, and it says
// which one that is.
function modelField(label, current, from) {
  const select = el('select')
  select.append(el('option', { value: '' }, inherited(from)))
  for (const name of config.agents) {
    const option = el('option', { value: name }, name)
    if (current && current.agent === name) option.selected = true
    select.append(option)
  }
  const model = el('input', { type: 'text', list: MODEL_LIST, placeholder: 'model — optional, a suggestion or any name' })
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

function renderEditor() {
  fields = []
  const groups = []
  suggestions()

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
    const roles = config.roles.map((name) => {
      const field = modelField(name, repo.models[name], repo.inherited[name])
      group.append(field.node)
      return [name, field.read]
    })
    fields.push({
      write: (patch) => {
        const models = {}
        for (const [name, read] of roles) models[name] = read()
        patch.repos.push({ name: repo.name, models })
      },
    })
    groups.push(group)
  }

  document.getElementById('config-fields').replaceChildren(...groups)
  // And the block beside it, into the same \`fields\`: one Save writes the whole
  // file, so the events and the channels go in the same patch as the limits.
  notifyFields()
}

// ——— Which half is shown, and what a run stops.

function mode() {
  document.getElementById('config-view').hidden = editing
  document.getElementById('config-fields').hidden = !editing
  // Both halves of the Notifications block swap with it: one editor over one
  // file, entered and left in one place (ADR 0025).
  document.getElementById('notify-view').hidden = editing
  document.getElementById('notify-fields').hidden = !editing
  // The sentence about the view, with the view: it says nothing below it is a
  // control, which stops being true the moment the editor is open.
  document.getElementById('notify-how').hidden = editing
  // And the secret control, which belongs to the view: while the editor is
  // open the token is typed in the block it belongs to, and two inputs for one
  // value would be two places to type it and one of them ignored (ADR 0025).
  document.getElementById('notify-secret').hidden = editing
  // With the inputs it is about, and only while they are there: the view has
  // no model to type into.
  document.getElementById('config-models-note').hidden = !editing
  for (const panel of PANELS) {
    document.getElementById(panel + '-edit').hidden = editing
    document.getElementById(panel + '-save').hidden = !editing
    document.getElementById(panel + '-discard').hidden = !editing
    // **And while editing, the page says it is editing** — in both panels,
    // because one editor spanning two of them is not obvious from a form
    // appearing where text was.
    const says = document.getElementById(panel + '-editing')
    says.hidden = !editing
    says.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, '✎'),
      'Editing — Configuration and Notifications are one editor over ' + (config ? config.file : 'the configuration') +
      ', and one Save writes both. Nothing is written until then, and Discard writes nothing.')
  }
  lockEditing()
}

// A run is active: the edit button is disabled and says why, and the view
// beside it stays readable — reading the configuration during a run was never
// the thing that had to be stopped. The explanation is part of the feature
// rather than a nicety, and the server refuses the write regardless.
//
// In both panels, like the button: a refusal shown next to one of two ways in
// is a refusal half the people who meet it do not see.
function lockEditing() {
  const active = running.length > 0
  const what = running.map((a) => a.repo + ' on task ' + a.task + ', attempt ' + a.attempt).join('; ')
  for (const panel of PANELS) {
    document.getElementById(panel + '-edit').disabled = active
    const node = document.getElementById(panel + '-lock')
    if (!active) {
      node.replaceChildren()
      continue
    }
    node.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, '▲'),
      'A run is active — ' + what + '. The configuration is read while a run is active and written between runs, and the server refuses a write now whatever this page allows.')
  }
}

// ——— Reading, opening, leaving, writing.

// The view, read now: on the page's one timer, when the page loads, after a
// write, and once more to open the editor. A read that lands while the editor
// is open is dropped rather than drawn — the editor was built from a read of
// its own, and nothing is allowed to move under the person typing.
async function loadConfig() {
  let read
  try {
    const response = await fetch('configuration.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(response.status + ' ' + (await response.text()))
    read = await response.json()
  } catch (error) {
    note('cannot read the configuration: ' + error.message)
    return false
  }
  if (editing) return true
  config = read
  viewConfig()
  renderFixed()
  return true
}

// The one timer reads the view and leaves the editor alone: from the read that
// opened it until it closes, nothing moves under the person typing.
async function refreshConfig() {
  if (editing) return
  await loadConfig()
}

// Entered deliberately, and on a read of its own, so what is edited is what
// the file currently says rather than what the view last showed. Refused while
// a run is active: the button is disabled as a courtesy and this is the rule.
async function openEditor() {
  if (running.length > 0) {
    lockEditing()
    return note('a run is active — the configuration is written between runs, and the editor does not open now')
  }
  problems([])
  note('reading the configuration…')
  if (!await loadConfig()) return
  editing = true
  renderEditor()
  mode()
  note('')
}

function closeEditor() {
  editing = false
  fields = []
  notifyBlocks = []
  document.getElementById('config-fields').replaceChildren()
  document.getElementById('notify-fields').replaceChildren()
  problems([])
  mode()
}

// Leaving discards, and discarding writes nothing: there is no prompt and no
// change held back to be applied later (ADR 0015). The view it comes back to
// is read again, because by then it is a view.
async function discard() {
  closeEditor()
  note('')
  await loadConfig()
}

async function save() {
  if (!config || !editing) return
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
      // And then the one write that does not go into this file: a channel's
      // token, under the name the file now declares (ADR 0025). In that order
      // and only now — until the channel is in the file, nothing asks for the
      // name and the server is right to refuse a value for it. It replaces
      // \`config\` with what it is answered, so the view says what is set.
      const also = await applyNotifySecrets()
      closeEditor()
      viewConfig()
      renderFixed()
      note(['saved — this is what ' + config.file + ' now says', ...also].join(' '))
    } else {
      // Refused — by the run, by the validator, or by the origin. The editor
      // stays open with what was typed still in it and the problems against
      // their paths: losing somebody's edits to a validation error would make
      // this mode worse than the one it replaced.
      problems(result.problems || [])
    }
  } catch (error) {
    note('cannot save: ' + error.message)
  }
  refresh()
}
`
