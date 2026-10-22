// Notifications: a block of its own, beside the configuration (ADR 0025).
//
// It was a row in `LIMITS` — one text input, labelled "a command run when a
// task finishes", which was neither what `notify` did nor one value. A list of
// channels is not one value, and which events reach a person is not a number,
// so this is a block: **the events as choices, and the channels as a list.**
//
// It is drawn from the same read and written by the same write as the
// configuration — one `config`, one editor, one Save — because it is the same
// file. Opening the editor above opens this, and discarding discards this.
// A block with its own edit button would be a second mode over one file, which
// is the third state ADR 0015 rejected.
//
// **Except the secret, which is the one control on this page that writes
// somewhere else.** A token must not be in `product.json` — the page serves
// that file's values to a browser and nothing gitignores it — so it goes to
// `.detent/secrets.json`, created `0600`, through a path of its own, and
// nothing ever reads it back. Which makes this the one place the page does not
// show what the file says: beside the name of the variable it says `set` or
// `not set`, and never what it found.
//
// A channel is added or removed in the file rather than here. The page edits
// the channels it was served: a form that composes a list of channels is a
// different feature, and the one in front of it — a token that cannot leak — is
// the one worth getting right first.

import { DEFAULT_EVENTS } from '../notify/plan.mjs'

export const NOTIFICATIONS = `const DEFAULT_EVENTS = ${JSON.stringify(DEFAULT_EVENTS)}

// Which kind a channel is, with the fields that kind declares: the page has no
// opinion about what a chat id or a shell command is, and asks the kind
// (\`core/notify/kinds.mjs\`). So a third kind draws itself with no change here.
const kindOf = (channel) => config.notify.kinds.find((k) => k.kind === channel.kind) || { kind: channel.kind, fields: [] }

// Set, and where — never what. The two halves of the sentence are the two
// places a secret may be (ADR 0025), and "named, and not set" is the one a
// person has to act on, so it says what to do.
function secretReads(secret) {
  if (secret.problem) return secret.name + ' — ' + secret.problem
  if (secret.set) return secret.name + ' — set, in ' + secret.where
  return secret.name + ' — named, and not set. Export it, or type it below.'
}

const valueReads = (channel, field) => {
  const value = channel[field.key]
  return value === null || value === undefined || value === '' ? 'not set' : String(value)
}

// ——— The view: what the file says about who hears what.

function viewNotify() {
  const notify = config.notify
  const groups = [
    legend('Which events reach you',
      ...notify.names.map((name) => reads(name + ' — ' + notify.labels[name], notify.events.effective.includes(name) ? 'on' : 'off'))),
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
  document.getElementById('notify-how').textContent =
    'Edited with the configuration above — Edit configuration opens both. A channel is added or removed in ' + config.file +
    '. A token is never in that file: the channel names the variable it is in, and detent reads it when it sends. ' +
    'What is typed below goes to ' + notify.secretFile + ' instead, created 0600 and gitignored, and is never read back to this page.'
  secretControl()
}

// The secret, and the one input whose contents this page does not keep. The
// select offers the variables the channels actually ask for, because a secret
// stored under a name no channel reads is a secret on disk doing nothing — and
// the server refuses one anyway.
function secretControl() {
  const named = config.notify.channels.map((c) => c.secret).filter(Boolean)
  const select = document.getElementById('notify-secret-name')
  select.replaceChildren(...named.map((secret) => el('option', { value: secret.name }, secret.name + (secret.set ? ' — set' : ' — not set'))))
  document.getElementById('notify-secret').hidden = named.length === 0
}

async function sendSecret() {
  const name = document.getElementById('notify-secret-name').value
  const input = document.getElementById('notify-secret-value')
  const say = (text) => { document.getElementById('notify-secret-note').textContent = text }
  if (!name) return say('no channel asks for a secret')
  const value = input.value
  // An empty field sets nothing: a stray click must not be how a working token
  // gets removed. Removing one is deleting the secrets file, which the line
  // above names.
  if (value === '') return say('type the token — an empty field sets nothing')
  say('setting ' + name + '…')
  try {
    const response = await fetch('secret.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, value: value }),
    })
    const result = await response.json()
    // Cleared whatever happened, and before anything else is done with the
    // answer: the page holds no secret for longer than the request.
    input.value = ''
    say(result.message || '')
    // The editor is not redrawn under the person typing in it (ADR 0020 part
    // 2); what was set is in the view, which they will come back to.
    if (response.ok && !editing) {
      config = result.configuration
      viewNotify()
    }
  } catch (error) {
    input.value = ''
    say('cannot set it: ' + error.message)
  }
}

// ——— The editor: the same values as controls, built from the same one read.

function notifyFields() {
  const notify = config.notify
  const node = document.getElementById('notify-fields')
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

  const readers = notify.channels.map((channel, index) => {
    const kind = kindOf(channel)
    const group = el('div', { class: 'group' }, el('div', { class: 'legend' }, 'Channel ' + (index + 1) + ' — ' + channel.kind))
    const inputs = kind.fields.map((field) => {
      const input = el('input', { type: field.type === 'number' ? 'number' : 'text' })
      input.value = channel[field.key] === null || channel[field.key] === undefined ? '' : String(channel[field.key])
      group.append(el('div', { class: 'field' }, el('label', {}, field.label), input))
      return [field, input]
    })
    // Beside the inputs, and not one of them: the name of the variable is
    // edited above, and whether it is set is not this file's to say.
    if (channel.secret) group.append(el('div', { class: 'field' }, el('span', { class: 'name' }, 'its secret'), el('span', {}, secretReads(channel.secret))))
    groups.push(group)
    return () => {
      const entry = { kind: channel.kind }
      for (const [field, input] of inputs) {
        const text = input.value.trim()
        if (text === '') continue
        entry[field.key] = field.type === 'number' ? Number(text) : text
      }
      return entry
    }
  })

  fields.push({ write: (patch) => { patch.notify = readNotify(chosen, readers) } })
  node.replaceChildren(...groups)
}

// What goes into the patch, in the smallest shape that says it — the same rule
// the limits follow, where an empty field leaves the key out of the file rather
// than writing the default into it.
//
//   the default events and the desktop notifier → null, and the key goes
//   the default events and one command           → the string, as it always was
//   anything else                                → { events, channels }
function readNotify(chosen, readers) {
  const events = chosen.filter(([, box]) => box.checked).map(([name]) => name)
  const channels = readers.map((read) => read())
  const byDefault = events.length === DEFAULT_EVENTS.length && DEFAULT_EVENTS.every((name) => events.includes(name))
  const only = channels.length === 1 && channels[0].kind === 'command' ? channels[0] : null
  if (byDefault && only && only.command === undefined) return null
  if (byDefault && only) return only.command
  return { events: events, channels: channels }
}
`
