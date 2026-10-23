// The command channel: a shell command, which is what `notify` has always been
// (ADR 0009). Moved here unchanged when the channel became one kind among
// several (ADR 0025) — the behaviour below is the behaviour that shipped.
//
// It is the kind that needs nothing of detent: every team already has a command
// that reaches them, and a command holds its own credentials wherever it keeps
// them. So `secret` answers `null`, and this kind never asks detent for one.
//
// A command channel with no command is the desktop notifier, which is what a
// product that configures nothing gets.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const command = {
  kind: 'command',

  // `command` is optional, and its absence is the desktop notifier rather than
  // a problem: the normalised form of a `product.json` that says nothing about
  // notification at all is one of these with `command: null`.
  keys: ['kind', 'command'],
  refused: {},

  // What the page draws for this kind, declared here rather than there: the
  // page has no opinion about what a shell command is, and a third kind draws
  // itself without the dashboard being touched.
  fields: Object.freeze([
    Object.freeze({
      key: 'command',
      label: 'command',
      type: 'text',
      placeholder: 'notify-send detent "$DETENT_MESSAGE"',
      help: 'run with the message on stdin and the details in its environment. Left empty it is the desktop notifier.',
    }),
  ]),

  // Nothing of detent's, so there is no name for the page to offer an input
  // against: a command carries its own credentials wherever it keeps them.
  secretKey: null,

  // And no form for adding one. A product that declares no channel already has
  // this kind — the desktop notifier is a command channel with no command — and
  // a *second* one is a shell command typed into a page and run by detent,
  // which is a decision of its own and not this feature's.
  offer: null,

  validate(entry, path, fail) {
    if (entry.command === undefined || entry.command === null) return { kind: 'command', command: null }
    if (typeof entry.command !== 'string' || entry.command.trim() === '') {
      fail(`${path}.command`, 'must be a non-empty string — the shell command that reaches a person')
      return null
    }
    return { kind: 'command', command: entry.command }
  },

  // What a report and the page call this channel. A command is not a secret —
  // it is the one a person wrote — but it can be long, so the line names the
  // first of it and the desktop case says which notifier it would reach for.
  describe(channel) {
    if (channel.command === null) return `the desktop notifier on ${process.platform}`
    const text = channel.command.replaceAll('\n', ' ')
    return text.length > 60 ? `${text.slice(0, 57)}…` : text
  },

  // Nothing of detent's: a command carries its own credentials.
  secret() {
    return null
  },

  // The message on stdin and the details in the environment — the interface
  // 0009 specified and that every existing `notify` command is written against.
  send(channel, details, { dir }) {
    const env = {
      ...process.env,
      DETENT_EVENT: details.event,
      DETENT_TASK: details.task,
      DETENT_REPO: details.repo,
      DETENT_OUTCOME: details.outcome,
      DETENT_BRANCH: details.branch ?? '',
      DETENT_MESSAGE: details.message,
    }

    if (channel.command) {
      const result = spawnSync('sh', ['-c', channel.command], { cwd: dir, env, input: details.message, encoding: 'utf8', timeout: 30_000 })
      if (result.status === 0) return { sent: true, via: 'command' }
      // The exit status first: a command that never reads stdin makes the write
      // fail with EPIPE, which is noise beside what the command itself said.
      const why =
        result.status !== null
          ? `exit code ${result.status}: ${result.stderr.trim()}`
          : result.signal
            ? `killed by ${result.signal}`
            : result.error.message
      return { sent: false, via: 'command', error: why }
    }

    const tried = desktop(details.message)
    for (const [program, args] of tried) {
      const result = spawnSync(program, args, { env, stdio: 'ignore', timeout: 10_000 })
      if (result.status === 0) return { sent: true, via: program }
    }
    // Which notifier was even tried is decided by the platform, so the platform
    // is in the message. The same sentence on macOS and on Linux would leave the
    // reader to guess which machine is missing which program.
    return { sent: false, via: null, error: `no notify command in product.json, and no desktop notifier answered on ${process.platform} (tried ${tried.map(([program]) => program).join(', ')})` }
  },
}

function desktop(message) {
  const title = 'detent'
  if (process.platform === 'darwin') {
    return [['osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]]]
  }
  return [['notify-send', [title, message]]]
}
