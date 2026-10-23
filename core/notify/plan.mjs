// `notify` in `product.json`: which events reach a person, and through which
// channels (ADR 0025).
//
// One function validates it and normalises it, because two would be two
// schemas: `validateProduct` passes a `fail` that collects problems by path, and
// everything that only wants the shape passes one that drops them.
//
// **A string still means what it has always meant** — one command, on a pause —
// so every `product.json` already written keeps working, and nothing has to be
// edited to go on being notified exactly as before.
//
//   "notify": "notify-send detent \"$DETENT_MESSAGE\""
//
//   "notify": {
//     "events": ["paused", "passed"],
//     "channels": [
//       { "kind": "command",  "command": "notify-send detent \"$DETENT_MESSAGE\"" },
//       { "kind": "telegram", "chat": "-1001234567890", "tokenEnv": "TELEGRAM_BOT_TOKEN" }
//     ]
//   }

import { KINDS, KIND_NAMES } from './kinds.mjs'

// What happened, as a person would say it. Three occasions, and then the raw
// outcomes — so somebody who wants to hear about `error` and nothing else can
// ask for `error` and nothing else.
export const OCCASIONS = Object.freeze(['paused', 'passed', 'promoted'])
export const OUTCOMES = Object.freeze(['escalated', 'rejected', 'error', 'red'])
export const EVENTS = Object.freeze([...OCCASIONS, ...OUTCOMES])

// **The default is today's behaviour.** A `notify` that does not say which
// events it wants notifies on a pause and nothing else — which is what
// `core/run.mjs` and `core/promote.mjs` have always done, and the reason no
// existing product folder changes behaviour by being loaded by this version.
export const DEFAULT_EVENTS = Object.freeze(['paused'])

// What each name reaches a person about, for the page and for `init`. Read off
// here rather than written on the page, so a name cannot be offered with one
// meaning and honoured with another.
export const EVENT_LABELS = Object.freeze({
  paused: 'a task paused, or a promotion did not happen — needs a person',
  passed: 'a task passed and landed on the integration branch',
  promoted: 'a batch was promoted',
  escalated: 'escalated alone — the gauge was red, or a merge conflicted',
  rejected: 'rejected alone — the acceptance pass raised doubts',
  error: 'error alone — the run or the agent broke',
  red: 'red alone — a promote gauge failed on a batch',
})

// The channel a product that names none gets: the command channel with no
// command, which is the desktop notifier. The same thing `notify: null` has
// always done, written down as a channel so there is one code path.
export const DESKTOP = Object.freeze({ kind: 'command', command: null })

const PLURAL = (list) => list.join(', ')

// The parsed value in, `{ events, channels }` out, with every problem named by
// path through `fail`. Absent is the default; a string is one command on a
// pause; an object says which events and which channels, and **present means
// exactly what it says** — `events: []` and `channels: []` are silence, not the
// default, exactly as an empty `modelSuggestions` is an empty list of names.
export function validateNotify(raw, path, fail) {
  if (raw === undefined || raw === null) return { events: [...DEFAULT_EVENTS], channels: [DESKTOP] }

  if (typeof raw === 'string') {
    if (raw.trim() === '') {
      fail(path, 'must be a non-empty string')
      return { events: [...DEFAULT_EVENTS], channels: [] }
    }
    return { events: [...DEFAULT_EVENTS], channels: [{ kind: 'command', command: raw }] }
  }

  if (!isObject(raw)) {
    fail(path, `must be a shell command, or { events, channels } — got ${Array.isArray(raw) ? 'an array' : JSON.stringify(raw)}`)
    return { events: [...DEFAULT_EVENTS], channels: [] }
  }

  for (const key of Object.keys(raw)) {
    if (key !== 'events' && key !== 'channels') fail(`${path}.${key}`, 'unknown key — expected one of events, channels')
  }

  let events = [...DEFAULT_EVENTS]
  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events)) {
      fail(`${path}.events`, `must be an array of event names — ${PLURAL(EVENTS)}`)
    } else {
      const named = []
      raw.events.forEach((name, index) => {
        if (typeof name !== 'string' || !EVENTS.includes(name)) {
          fail(`${path}.events[${index}]`, `${JSON.stringify(name)} is not an event — ${PLURAL(EVENTS)}`)
          return
        }
        if (!named.includes(name)) named.push(name)
      })
      events = named
    }
  }

  let channels = [DESKTOP]
  if (raw.channels !== undefined) {
    if (!Array.isArray(raw.channels)) {
      fail(`${path}.channels`, 'must be an array of channels, each with a kind')
      channels = []
    } else {
      channels = raw.channels.flatMap((entry, index) => {
        const at = `${path}.channels[${index}]`
        const channel = validateChannel(entry, at, fail)
        return channel ? [channel] : []
      })
    }
  }

  return { events, channels }
}

function validateChannel(entry, path, fail) {
  if (!isObject(entry)) {
    fail(path, `must be an object with a kind — ${PLURAL(KIND_NAMES)}`)
    return null
  }
  const kind = KINDS[entry.kind]
  if (!kind) {
    // The same sentence ADR 0018 taught: a name this version does not offer is
    // answered with the rule that admits one, not with "unknown kind".
    fail(
      `${path}.kind`,
      `${JSON.stringify(entry.kind)} is not a channel detent has — ${PLURAL(KIND_NAMES)}. A kind is added once it has delivered a real message: ${ADR_0025}`,
    )
    return null
  }
  // Every key the kind does not claim, before the kind sees it: a typo in a
  // channel is a message that silently never arrives.
  for (const key of Object.keys(entry)) {
    if (kind.keys.includes(key)) continue
    if (Object.hasOwn(kind.refused, key)) fail(`${path}.${key}`, kind.refused[key])
    else fail(`${path}.${key}`, `unknown key for a ${kind.kind} channel — expected one of ${PLURAL(kind.keys)}`)
  }
  return kind.validate(entry, path, fail)
}

const ADR_0025 = 'docs/adr/0025-a-channel-is-a-kind-and-the-secret-is-not-in-the-configuration.md'

// The shape only, with the problems dropped: for everything that reads a
// `notify` it is not validating — the dispatcher, and the dashboard reporting
// what the file says.
export function notifyPlan(raw) {
  return validateNotify(raw, 'notify', () => {})
}

// Whether this occasion is one somebody asked for. The event is the headline —
// a task paused, a task passed, a batch promoted — and the outcome is the raw
// word the journal records, so `["error"]` hears about an error and about
// neither of the other two pauses.
export function wanted(plan, { event, outcome }) {
  return plan.events.includes(event) || (outcome !== undefined && outcome !== null && plan.events.includes(outcome))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
