// Notifications: a block of its own, beside the configuration (ADR 0025).
//
// It was a row in `LIMITS` — one text input, labelled "a command run when a
// task finishes", which was neither what `notify` did nor one value. A list of
// channels is not one value, and which events reach a person is not a number,
// so this is a block: **the events as choices, and the channels as a list.**
//
// It is drawn from the same read and written by the same write as the
// configuration — one `config`, one editor, one Save — because it is the same
// file. **The editor is entered from either panel and says so from both**: this
// block is far enough down that the only way into it was to scroll back to a
// button that did not mention it, which made a panel that is read-only on
// purpose look like a panel whose controls had stopped working. Two editors
// over one `product.json` would be two sets of pending changes where the last
// Save wins silently, so there is still exactly one mode.
//
// **A channel is added and removed here, and that is new.** It used to be done
// by hand, and the reason given was that a form composing a list was a feature
// of its own — but the panel exists to answer how a telegram notification gets
// turned on, and it answered by naming a file and stopping: `kind`, `chat`,
// `thread` and `tokenEnv` were written down nowhere a person would look. A
// telegram channel names nothing on disk, which is the test `NOT_EDITABLE`
// applies, so the form is drawn whether or not the file declares one — and left
// empty it adds nothing, because a channel that exists only because a form was
// drawn would be a send with no chat, failing once per event.
//
// **Except the secret, which is the one control on this page that writes
// somewhere else.** A token must not be in `product.json` — the page serves
// that file's values to a browser and nothing gitignores it — so it goes to
// `.detent/secrets.json`, created `0600`, through a path of its own, and
// nothing ever reads it back. Which makes this the one place the page does not
// show what the file says: beside the name of the variable it says `set` or
// `not set` and where, and never what it found. The write happens *after* the
// configuration write, in that order and only if that one was accepted: until
// the file declares the channel, no channel asks for the name, and the server
// is right to refuse a value for a name nothing reads.

import { DEFAULT_EVENTS } from '../notify/plan.mjs'

export const NOTIFICATIONS = `const DEFAULT_EVENTS = ${JSON.stringify(DEFAULT_EVENTS)}

// The editor's channel blocks, while it is open: what Save reads the channels
// off, and what it asks for the one write that does not go into the file
// (ADR 0025). Emptied with the editor, like \`fields\`.
let notifyBlocks = []

// Which kind a channel is, with the fields that kind declares, which of them
// names its secret, and the form it offers for one nothing has declared: the
// page has no opinion about what a chat id or a shell command is, and asks the
// kind (\`core/notify/kinds.mjs\`). So a third kind draws itself with no change
// here — and composes itself here too, if it says it can be composed.
const NO_KIND = { fields: [], secretKey: null, offer: null }
const kindOf = (channel) => config.notify.kinds.find((k) => k.kind === channel.kind) || { ...NO_KIND, kind: channel.kind }

// Set, and where — never what. The two halves of the sentence are the two
// places a secret may be (ADR 0025), and "named, and not set" is the one a
// person has to act on, so it says what to do.
//
// **And the environment winning is said out loud.** A variable exported in a
// shell beats the file (\`core/secret.mjs\`), so somebody who typed a token into
// this page while one was exported is having a different one sent than the one
// they typed — which is a mystery a failed send explains badly and this
// sentence explains exactly. \`shadowed\` is a boolean about where, not a value.
function secretReads(secret) {
  if (secret.problem) return secret.name + ' — ' + secret.problem
  if (!secret.set) return secret.name + ' — named, and not set. Export it, or type it below.'
  if (secret.where !== config.notify.environment) return secret.name + ' — set, in ' + secret.where + '.'
  return secret.name + ' — set, in ' + secret.where + ', which is what a send uses'
    + (secret.shadowed
      ? '. ' + config.notify.secretFile + ' holds one under that name too and the variable wins over it, so a token typed here is not the one being sent'
      : '')
    + '.'
}

// What removing a channel does to its secret, as one question and two
// sentences — in one place, because the line beside the checkbox and the line
// Save says afterwards are the same claim. Computed apart, one of them promised
// a token would be deleted and the other then declined to delete it, which is a
// worse answer than neither: two chats may be the same bot, and the token
// belongs to the bot rather than to one chat.
//
// \`asks()\` of a block that is being removed is null, so the question is always
// "does anything *else* ask for this name" — asked of the blocks as they stand
// now, including one typed into the add-a-channel form and not yet saved.
function askedElsewhere(self) {
  return notifyBlocks.filter((block) => block !== self).map((block) => block.asks()).filter(Boolean)
}

const secretGoes = (name) => name + ' goes from ' + config.notify.secretFile
  + ' with it — a value left under a name no channel reads is one nothing here could remove afterwards'
const secretStays = (name) => name + ' stays in ' + config.notify.secretFile
  + ' — another channel still asks for that name; a token belongs to the bot rather than to one chat'

// And said again, in every block, whenever anything in any of them changes:
// whether a removal takes a token with it is a fact about the other blocks, so
// a name typed into one changes the sentence under another.
function retellRemovals() {
  for (const block of notifyBlocks) block.retell(askedElsewhere(block))
}

const valueReads = (channel, field) => {
  const value = channel[field.key]
  return value === null || value === undefined || value === '' ? 'not set' : String(value)
}

// ——— The view: what the file says about who hears what.

// On and off as a status rather than as a bare word. Seven rows reading
// \`on\`, \`off\`, \`off\`… are values being shown, and in a column of form-shaped
// rows that is exactly what a set of controls that have stopped working looks
// like — so each one is an icon and a word, which is this page's rule for a
// status everywhere else, and the colour only repeats them.
function onOff(on) {
  return el('span', { class: 'status ' + (on ? 'passed' : 'skipped') },
    el('span', { class: 'icon', 'aria-hidden': 'true' }, on ? '✓' : '–'),
    on ? 'on — you are told' : 'off — you are not told')
}

function viewNotify() {
  const notify = config.notify

  // The sentence that explains the panel, above what it explains. It was
  // underneath everything it was about, where somebody who had already decided
  // the rows were broken controls had no reason left to read it.
  document.getElementById('notify-how').textContent =
    'This is what ' + config.file + ' says, as text — nothing below is a control. Which events reach you, and the channels they go through, are changed in the editor either Edit button opens: one editor over this block and the Configuration above it, entered from either and saved once. A channel is added and removed there too. A token is never in that file — a channel names the variable its token is in — and what is typed into Its secret below goes to ' + notify.secretFile + ' instead, created 0600 and gitignored, and is never read back to this page.'

  const groups = [
    legend('Which events reach you',
      ...notify.names.map((name) => reads(name + ' — ' + notify.labels[name], onOff(notify.events.effective.includes(name))))),
  ]

  if (notify.channels.length === 0) {
    groups.push(legend('Channels', reads('none', 'nothing is sent — ' + config.file + ' lists no channels')))
  }
  notify.channels.forEach((channel, index) => {
    const kind = kindOf(channel)
    groups.push(legend('Channel ' + (index + 1) + ' — ' + channel.kind,
      reads('sends to', channel.where),
      ...kind.fields.map((field) => reads(field.label, valueReads(channel, field))),
      channel.secret ? reads('its secret', secretReads(channel.secret)) : null))
  })

  document.getElementById('notify-view').replaceChildren(...groups)
  document.getElementById('notify-problems').replaceChildren(
    ...notify.problems.map((problem) => el('li', {}, el('code', {}, problem))))
  secretControl()
}

// The secret, and the one input whose contents this page does not keep. The
// select offers the variables the channels actually ask for, because a secret
// stored under a name no channel reads is a secret on disk doing nothing — and
// the server refuses a value for one anyway.
//
// **And when they ask for none, there is no control.** It was a select with no
// options, beside a placeholder cut off mid-sentence at the width the row gave
// it — a control that could do nothing next to a label that did not finish,
// with no sentence saying which of those was the reason. Now the sentence is
// the control's absence explained, and the placeholder is three words.
function secretControl() {
  const named = config.notify.channels.map((c) => c.secret).filter(Boolean)
  const select = document.getElementById('notify-secret-name')
  select.replaceChildren(...named.map((secret) => el('option', { value: secret.name },
    secret.name + (secret.set ? ' — set, in ' + secret.where : ' — not set'))))
  document.getElementById('notify-secret-field').hidden = named.length === 0
  document.getElementById('notify-secret-how').textContent = named.length === 0
    ? 'Nothing to set: no channel here asks detent for a secret. A command channel runs a command of yours and keeps its own credentials wherever they are. A telegram channel names the variable its token is in — add one in the editor above and the token is typed here.'
    : 'The token for the variable named beside it. It goes to ' + config.notify.secretFile + ', created 0600 and gitignored, never into ' + config.file + ', and is never read back to this page. A variable exported in your shell wins over that file. This is the one write that is not refused during a run — a run whose channel has no token is when one is needed.'
}

async function sendSecret() {
  const name = document.getElementById('notify-secret-name').value
  const input = document.getElementById('notify-secret-value')
  const say = (text) => { document.getElementById('notify-secret-note').textContent = text }
  if (!name) return say('no channel asks for a secret')
  const value = input.value
  // An empty field sets nothing: a stray click must not be how a working token
  // gets removed. Removing one is removing its channel in the editor, which
  // takes the secret with it, or deleting the file the line above names.
  if (value === '') return say('type the token — an empty field sets nothing')
  say('setting ' + name + '…')
  try {
    const result = await putSecret(name, value)
    // Cleared whatever happened, and before anything else is done with the
    // answer: the page holds no secret for longer than the request.
    input.value = ''
    say(result.message)
    // The editor is not redrawn under the person typing in it (ADR 0020 part
    // 2); what was set is in the view, which they will come back to.
    if (result.ok && !editing) viewNotify()
  } catch (error) {
    input.value = ''
    say('cannot set it: ' + error.message)
  }
}

// The one request that carries a token, and the only one. \`config\` is replaced
// from what comes back, because the answer carries the configuration read off
// disk — with whether the secret is set in it, and no value anywhere.
async function putSecret(name, value) {
  const response = await fetch('secret.json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name, value: value }),
  })
  const result = await response.json()
  if (response.ok && result.configuration) config = result.configuration
  return { ok: response.ok, message: result.message || (response.ok ? name + ' is set' : 'cannot set ' + name) }
}

// ——— The editor: the same values as controls, built from the same one read.

// A control with what it takes under it rather than inside it. The sentence was
// in the label, where it competed with the key it was explaining, and in a
// placeholder, where every width narrower than the sentence cut it in half.
//
// A sentence, or the element holding one that gets said again — the line under
// the remove box is about the other blocks and changes while the editor is open.
const stacked = (label, control, hint) => el('div', { class: 'field' },
  el('label', {}, label),
  el('div', { class: 'stack' }, control,
    typeof hint === 'string' ? el('span', { class: 'muted hint' }, hint) : hint || null))

function notifyFields() {
  const notify = config.notify
  const node = document.getElementById('notify-fields')
  notifyBlocks = []
  // A notify detent cannot read is not edited here. Saving it would be saving
  // the page's idea of it, and the page's idea drops whatever the validator
  // dropped — a channel with a typo in it would disappear on the next Save
  // rather than be fixed.
  if (notify.problems.length > 0) {
    node.replaceChildren(el('p', { class: 'muted' },
      'notify in ' + config.file + ' has ' + (notify.problems.length === 1 ? 'a problem' : notify.problems.length + ' problems') +
      ', listed below the view — it is edited in the file until they are fixed, so that saving cannot quietly drop a channel.'))
    return
  }

  const groups = []
  const events = el('div', { class: 'group' }, el('div', { class: 'legend' }, 'Which events reach you'))
  const chosen = notify.names.map((name) => {
    const box = el('input', { type: 'checkbox' })
    box.checked = notify.events.effective.includes(name)
    events.append(el('div', { class: 'field' }, el('label', {}, name + ' — ' + notify.labels[name]), box))
    return [name, box]
  })
  groups.push(events)

  const blocks = notify.channels.map((channel, index) => {
    const block = channelBlock(kindOf(channel), 'Channel ' + (index + 1) + ' — ' + channel.kind, channel)
    groups.push(block.node)
    return block
  })

  // And the block for a kind that says it can be composed, declared or not.
  // **This is the question the panel exists to answer.** A product declaring no
  // channel got \`Channel 1 — command\` and nothing else, and the way to a
  // telegram notification was a sentence naming a file — so the keys were
  // discoverable only by reading \`core/notify/telegram.mjs\`.
  for (const kind of notify.kinds) {
    if (kind.offer === null) continue
    const another = notify.channels.some((channel) => channel.kind === kind.kind)
    const block = channelBlock(kind, (another ? 'Another ' : 'A ') + kind.offer.what, null)
    groups.push(block.node)
    blocks.push(block)
  }

  notifyBlocks = blocks
  // Once they all exist, because each one's removal sentence is about the
  // others — and this is the same call their controls make from then on.
  retellRemovals()
  fields.push({ write: (patch) => { patch.notify = readNotify(chosen, blocks) } })
  node.replaceChildren(...groups)
}

// One channel as controls: the keys its kind declares, the token beside them
// when the kind names a variable, and the way to take the channel away.
// \`channel\` is one the file declares, or null for the block that would add one.
function channelBlock(kind, legendText, channel) {
  const group = el('div', { class: 'group' }, el('div', { class: 'legend' }, legendText))
  if (channel === null) group.append(el('p', { class: 'muted hint' }, kind.offer.how))

  const inputs = kind.fields.map((field) => {
    const input = el('input', { type: field.type === 'number' ? 'number' : 'text', placeholder: field.placeholder || '' })
    // What the file says, or — for a block adding one — what the kind fills in
    // so that nobody is asked a question they have no reason to have an answer
    // to. The name of a variable is defaulted, not demanded.
    const start = channel === null ? (kind.offer.defaults || {})[field.key] : channel[field.key]
    input.value = start === null || start === undefined ? '' : String(start)
    group.append(stacked(field.label, input, field.help))
    return [field, input]
  })

  // The name of the variable as this block now declares it — not as the file
  // declared it when the editor opened. A token goes under the name the channel
  // will ask for, which is the one being saved beside it.
  const asked = () => {
    const found = inputs.find(([field]) => field.key === kind.secretKey)
    return found ? found[1].value.trim() : ''
  }

  let token = null
  if (kind.secretKey !== null) {
    token = el('input', { type: 'password', placeholder: 'the bot token' })
    group.append(stacked('the token', token,
      'typed here it goes to ' + config.notify.secretFile + ' under the name above, created 0600 and gitignored — never into ' + config.file + ', and never read back to this page.'))
    // Beside it, and not in it: whether it is set is not this file's to say,
    // and this is the one value the page is never shown.
    if (channel !== null && channel.secret) {
      group.append(el('div', { class: 'field' }, el('span', { class: 'name' }, 'now'), el('span', {}, secretReads(channel.secret))))
    }
  }

  // Removed on Save like every other change, rather than by a button of its
  // own: a control that writes the moment it is clicked would be a second
  // write over one file, which is the thing this block does not have.
  let remove = null
  let removeHint = null
  if (channel !== null) {
    remove = el('input', { type: 'checkbox' })
    // Empty here and filled by \`retell\` below, which is also what says it
    // again later: what this removal does to the secret depends on the blocks
    // beside it, and those are still being built.
    removeHint = el('span', { class: 'muted hint' })
    group.append(stacked('remove', remove, removeHint))
  }

  // What removing this channel would do, as the editor currently stands, in the
  // words \`applyNotifySecrets\` will use for what it did.
  //
  // A \`notify\` the file does not mention is the desktop notifier, which is one
  // channel and not one the file lists — so removing it is not a key going from
  // the file, it is an empty list of channels being written, and an empty list
  // is silence. Said as what it is rather than as what the other case is.
  const retell = (asked) => {
    if (removeHint === null) return
    removeHint.textContent = config.notify.shape === 'absent'
      ? 'nothing is sent at all after you Save: this is the channel a product that configures nothing gets, and taking it away writes an empty list of channels.'
      : 'this channel goes from ' + config.file + ' when you Save'
        + (channel.secret
          ? ', and ' + (asked.includes(channel.secret.name) ? secretStays(channel.secret.name) : secretGoes(channel.secret.name))
          : '')
        + '.'
  }

  // Which is why every control in the block asks for all of them to be said
  // again: a variable renamed here, a chat filled in that makes this block a
  // channel, a box ticked — each changes what some other block's removal does.
  for (const [, input] of inputs) input.addEventListener('input', retellRemovals)
  if (remove !== null) remove.addEventListener('change', retellRemovals)

  const read = () => {
    if (remove !== null && remove.checked) return null
    const entry = { kind: kind.kind }
    for (const [field, input] of inputs) {
      const text = input.value.trim()
      if (text === '') continue
      entry[field.key] = field.type === 'number' ? Number(text) : text
    }
    // An empty form adds nothing. A telegram channel that existed only because
    // the page drew a form would be a send with no chat and no token, failing
    // once per event and reported every time — worse than no form at all.
    if (channel === null && entry[kind.offer.requires] === undefined) return null
    return entry
  }

  return {
    node: group,
    channel: read,
    retell: retell,
    // The name this block's channel will ask for once the file is written, or
    // null. What keeps one block's removal from taking a token another block
    // still needs.
    asks: () => (kind.secretKey === null || read() === null ? null : asked() || null),
    // What this block has to write that does not go into \`product.json\`
    // (ADR 0025), or null: a token typed into it, or the removal of the secret
    // of a channel that is going.
    secret: () => {
      if (kind.secretKey === null) return null
      if (remove !== null && remove.checked) {
        return channel !== null && channel.secret ? { name: channel.secret.name, value: null, input: null } : null
      }
      if (token === null || token.value === '') return null
      if (read() === null) return null
      const name = asked()
      return name === '' ? null : { name: name, value: token.value, input: token }
    },
  }
}

// The writes that are not \`product.json\`, after \`product.json\` has been
// written and only if it was (ADR 0025). The order is the whole of it: the
// configuration write puts the name of the variable in the file, and until it
// is there no channel asks for the name and the server refuses a value for it.
// What comes back is a sentence per write, which Save says beside its own.
async function applyNotifySecrets() {
  const said = []
  const removed = []
  for (const block of notifyBlocks) {
    const write = block.secret()
    if (write === null) continue
    if (write.value === null) {
      // A removal whose name a surviving channel still asks for is not one —
      // the same question the line beside the checkbox answered, asked the same
      // way and answered in the same words, so that what was promised is what
      // is reported.
      if (askedElsewhere(block).includes(write.name)) {
        said.push(secretStays(write.name) + '.')
        continue
      }
      // And two channels of one bot, both going, are one removal and one
      // sentence rather than two of each under the same name.
      if (removed.includes(write.name)) continue
      removed.push(write.name)
    }
    try {
      const result = await putSecret(write.name, write.value)
      if (write.input !== null) write.input.value = ''
      said.push(result.message)
    } catch (error) {
      if (write.input !== null) write.input.value = ''
      said.push('cannot set ' + write.name + ': ' + error.message)
    }
  }
  return said
}

// What goes into the patch, in the smallest shape that says it — the same rule
// the limits follow, where an empty field leaves the key out of the file rather
// than writing the default into it.
//
//   the default events and the desktop notifier → null, and the key goes
//   the default events and one command           → the string, as it always was
//   anything else                                → { events, channels }
function readNotify(chosen, blocks) {
  const events = chosen.filter(([, box]) => box.checked).map(([name]) => name)
  const channels = blocks.map((block) => block.channel()).filter((entry) => entry !== null)
  const byDefault = events.length === DEFAULT_EVENTS.length && DEFAULT_EVENTS.every((name) => events.includes(name))
  const only = channels.length === 1 && channels[0].kind === 'command' ? channels[0] : null
  if (byDefault && only && only.command === undefined) return null
  if (byDefault && only) return only.command
  return { events: events, channels: channels }
}
`
