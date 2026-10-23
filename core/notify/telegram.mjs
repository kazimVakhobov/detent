// The telegram channel: one POST, and no dependency (ADR 0025).
//
// The Bot API is `POST https://api.telegram.org/bot<token>/sendMessage` with a
// JSON body, and Node 22 has `fetch` — so the whole of a chat channel is the
// function below. Nothing is vendored and `scripts/check-no-deps.mjs` stays
// green, which is the condition ADR 0006 puts on every feature.
//
// **The token is never in the configuration.** The channel names the variable
// it is in, detent reads it at send time (`core/secret.mjs`), and it arrives
// here as an argument. Which makes this module the one place a secret is
// handled, so two rules hold inside it:
//
//   - **the token is in the URL, so the URL never leaves.** `response.url`,
//     `request.url` and whatever a failed `fetch` put in its own message all
//     carry it, and every one of them would end up in a journal line. So an
//     error here is built from the status and the API's own `description` and
//     from nothing else, and the dispatcher redacts what comes back anyway.
//   - **the body is read before it is believed.** The Bot API answers 200 with
//     `{ "ok": false, "description": … }` often enough that the status alone is
//     not the answer.
//
// `thread` is `message_thread_id`: a forum topic in a group that has them. It is
// optional, because most chats are not forums and sending the key as `null`
// is an error rather than a default.

const API = 'https://api.telegram.org'
const TIMEOUT = 15_000

// A chat is an id — `-1001234567890` for a group, a positive number for a
// person — or an `@name` for a public channel. Both arrive as text, because a
// group id is beyond what JSON guarantees about a number only by luck.
const CHAT = /^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{3,})$/

// The name of an environment variable, which is all the configuration ever
// holds of a secret. Held to the shape a shell will actually export, so a
// person who typed the token itself into the key is told something true.
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

export const telegram = {
  kind: 'telegram',

  keys: ['kind', 'chat', 'thread', 'tokenEnv'],
  // The one key that must never be written here, answered with why rather than
  // with "unknown key": whoever typed it was doing the obvious thing.
  refused: {
    token: 'is never written in product.json — the dashboard serves this file to a browser and nothing gitignores it. Name the variable instead: "tokenEnv": "TELEGRAM_BOT_TOKEN" (docs/adr/0025-a-channel-is-a-kind-and-the-secret-is-not-in-the-configuration.md)',
  },

  // What the page draws, and every one of them an address or a name: there is
  // no field here for the token, because there is nowhere for it to go.
  fields: Object.freeze([
    Object.freeze({ key: 'chat', label: 'chat — the id, or @name for a public channel', type: 'text' }),
    Object.freeze({ key: 'thread', label: 'thread — a forum topic, optional', type: 'number' }),
    Object.freeze({ key: 'tokenEnv', label: 'tokenEnv — the variable the bot token is in, never the token', type: 'text' }),
  ]),

  validate(entry, path, fail) {
    let chat = null
    if (entry.chat === undefined) {
      fail(`${path}.chat`, 'is required — the chat id to send to, or @name for a public channel')
    } else if (typeof entry.chat === 'number' && Number.isInteger(entry.chat)) {
      chat = String(entry.chat)
    } else if (typeof entry.chat === 'string' && CHAT.test(entry.chat.trim())) {
      chat = entry.chat.trim()
    } else {
      fail(`${path}.chat`, `must be a chat id or @name, got ${JSON.stringify(entry.chat)}`)
    }

    let thread = null
    if (entry.thread !== undefined && entry.thread !== null) {
      if (!Number.isInteger(entry.thread) || entry.thread < 1) {
        fail(`${path}.thread`, `must be a positive integer — the forum topic to send into, got ${JSON.stringify(entry.thread)}`)
      } else thread = entry.thread
    }

    let tokenEnv = null
    if (entry.tokenEnv === undefined) {
      fail(`${path}.tokenEnv`, 'is required — the name of the environment variable the bot token is in, never the token')
    } else if (typeof entry.tokenEnv !== 'string' || !VARIABLE.test(entry.tokenEnv)) {
      // Without echoing it: somebody who pasted the token where the name goes
      // must not have it printed back at them.
      fail(`${path}.tokenEnv`, 'must be the name of an environment variable — letters, digits and "_", not starting with a digit — and never the token itself')
    } else tokenEnv = entry.tokenEnv

    if (chat === null || tokenEnv === null) return null
    return { kind: 'telegram', chat, thread, tokenEnv }
  },

  // What a report and the page call this channel. The chat and the topic, which
  // are addresses rather than credentials; the variable's name is reported
  // beside its `set` / `not set` and is not repeated here.
  describe(channel) {
    return `chat ${channel.chat}${channel.thread === null ? '' : `, topic ${channel.thread}`}`
  },

  secret(channel) {
    return channel.tokenEnv
  },

  async send(channel, details, { secret, api = API }) {
    let response
    try {
      response = await fetch(`${api}/bot${secret}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: channel.chat,
          ...(channel.thread === null ? {} : { message_thread_id: channel.thread }),
          text: details.message,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      })
    } catch (error) {
      // Not `error.message`: a failure to parse or reach a URL names the URL,
      // and this one has the token in it. The name of the condition is what a
      // person needs — the address is in `describe`.
      return { sent: false, via: 'telegram', error: error.name === 'TimeoutError' ? `no answer from the Bot API in ${TIMEOUT / 1000}s` : `the Bot API could not be reached (${error.name})` }
    }

    // Read before it is believed, and `ok` is the API's word rather than the
    // status: a wrong chat id is a 400 with a sentence, a revoked token a 401
    // with another, and both of those sentences are the useful half.
    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (response.ok && body?.ok === true) return { sent: true, via: 'telegram' }
    const said = typeof body?.description === 'string' ? body.description : null
    return { sent: false, via: 'telegram', error: `${response.status}${said ? `: ${said}` : ' and nothing the Bot API explains'}` }
  },
}
