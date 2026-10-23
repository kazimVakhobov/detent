// The channels, one module per kind, dispatched by `kind` (ADR 0025).
//
// A kind exports how it validates itself and how it sends, so adding a third is
// one file and one line here. Nothing outside these modules knows what a
// telegram chat id or a shell command is: the validator asks the kind, the page
// shows what the kind describes, and the dispatcher calls what the kind sends.
//
// **The list is the list, here and in the ADR** — the discipline ADR 0018 put
// on agents, carried across: **a kind is added when it has delivered a real
// message**, not when its module compiles. A kind written against documentation
// and never run is a promise to reach somebody, which is the one promise this
// tool must not make falsely; the thing a notification exists for is the moment
// nobody is watching.
//
//   command   shipped in 0.1 and run on every pause since (ADR 0009)
//   telegram  added here, against the Bot API's `sendMessage`
//
// Each one exports:
//
//   kind       the name in `product.json`
//   keys       the keys it allows on a channel, `kind` included
//   refused    keys refused by name, each with why — where a mistake is likely
//   fields     what the dashboard draws for it: `{ key, label, type }`, so the
//              page has no opinion about what a chat id is
//   validate   (entry, path, fail) → the normalised channel, or null
//   describe   (channel) → the one line a report and the page show. Never a
//              secret: a channel says where it sends, not what it sends with
//   secret     (channel) → the name of the variable it needs, or null
//   send       (channel, details, { dir, secret, api }) → { sent, via, error? }

import { command } from './command.mjs'
import { telegram } from './telegram.mjs'

export const KINDS = Object.freeze({ command, telegram })

export const KIND_NAMES = Object.freeze(Object.keys(KINDS))
