// Telling a person what happened (ADR 0009, narrowed by ADR 0025).
//
// One occasion in, a result per channel out. What this module owns is the three
// things a channel must not have to think about:
//
//   **Whether anybody asked.** The configuration names events; an occasion
//   carries its event and its raw outcome, and `wanted` decides. A `notify`
//   that names no events notifies on a pause and nothing else, which is what
//   detent has always done.
//
//   **That one channel failing is not the run failing.** It was never the run
//   failing — a task is already paused, and losing the run over a message about
//   it would be the worse outcome — and that now holds *per channel*: each is
//   attempted, each reports, and a channel that throws is a line in the result
//   rather than an exception out of it. Attempted once: detent is not a
//   notification router, so there is no retry and no queue (ADR 0025).
//
//   **That no secret comes back.** One function reads a secret
//   (`core/secret.mjs`), it is passed to the one channel that needs it, and
//   whatever that channel returns is redacted against it before it leaves here.
//   A send that fails is reported, and what comes back goes into the journal and
//   onto a terminal — so the token has to be unable to reach this return value
//   even if a kind is careless, which is why the scrub is here and not only
//   there.

import { KINDS } from './notify/kinds.mjs'
import { notifyPlan, wanted } from './notify/plan.mjs'
import { readSecret } from './secret.mjs'

export { EVENTS, EVENT_LABELS, OCCASIONS, OUTCOMES, DEFAULT_EVENTS, notifyPlan, validateNotify, wanted } from './notify/plan.mjs'
export { KINDS, KIND_NAMES } from './notify/kinds.mjs'

// `details` is the occasion: `event` is what happened in the words the
// configuration uses, `outcome` the word the journal records, and `message` the
// sentence a person reads. `api` is for a test that stands a Bot API up.
export async function notify(product, details, { api } = {}) {
  const plan = notifyPlan(product.notify)
  const result = { event: details.event, outcome: details.outcome ?? null, asked: wanted(plan, details), channels: [] }
  if (!result.asked) return result

  for (const channel of plan.channels) {
    const kind = KINDS[channel.kind]
    const where = kind.describe(channel)
    const name = kind.secret(channel)
    const secret = name === null ? null : readSecret(product.dir, name)

    // Named, and not set: reported as the condition it is, and never by
    // printing what was found there. The channel is not called — a request with
    // `undefined` where the token goes would reach the API and come back 404.
    if (name !== null && secret === null) {
      result.channels.push({ kind: channel.kind, where, sent: false, error: `${name} is named, and not set — export it, or set it on the dashboard` })
      continue
    }

    let sent
    try {
      sent = await kind.send(channel, details, { dir: product.dir, secret, api })
    } catch (error) {
      // A kind that throws is a kind with a bug, and a bug in a notifier is
      // still not worth the run.
      sent = { sent: false, via: channel.kind, error: `the ${channel.kind} channel failed: ${error.message}` }
    }
    result.channels.push({
      kind: channel.kind,
      where,
      sent: sent.sent === true,
      ...(sent.via === undefined || sent.via === null ? {} : { via: sent.via }),
      ...(sent.sent === true ? {} : { error: redact(String(sent.error ?? 'it did not say why'), secret) }),
    })
  }

  return result
}

// What a terminal says about a send that did not happen: one line per channel,
// naming the channel and where it was aimed. Here rather than in each command,
// because `run` and `promote` print the same thing and the shape of a result is
// this module's.
export function notifyProblems(notified) {
  if (!notified || !Array.isArray(notified.channels)) return []
  return notified.channels
    .filter((channel) => !channel.sent)
    .map((channel) => `could not notify via ${channel.kind}${channel.where ? ` (${channel.where})` : ''}: ${channel.error}`)
}

// The last guard. A secret is a string a kind had and this result must not: an
// API that echoes the URL it was called with, a stack message, a careless
// template — any of them would put the token in a journal line that is never
// rewritten. The lower bound is there so that a one- or two-character value in
// a variable cannot turn an error about a chat id into ellipses; nothing that
// short is a credential.
function redact(text, secret) {
  if (typeof secret !== 'string' || secret.length < 4) return text
  return text.replaceAll(secret, '…')
}
