import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { DEFAULT_EVENTS, EVENTS, KIND_NAMES, notify, notifyPlan, notifyProblems } from '../core/notify.mjs'

const details = {
  event: 'paused',
  task: '0042',
  repo: 'acme-api',
  outcome: 'escalated',
  branch: 'agent/task-0042-wallet',
  message: 'task 0042 is paused: 3 identical failures on test',
}

const dir = () => mkdtempSync(join(tmpdir(), 'detent-notify-'))

// A Bot API that is this process: the real `fetch`, a real POST, and the
// request written down so a test can say what was sent rather than what the
// module meant to send. `answer` is what it replies with.
async function botApi(answer) {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: request.method, path: request.url, type: request.headers['content-type'], body: JSON.parse(body) })
      const [status, payload] = answer(requests.length)
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { requests, api: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

// ——— A string is what it always was (ADR 0025).

test('notify is still a command on a pause, and every product.json already written keeps working', async () => {
  const cwd = dir()
  const result = await notify({ dir: cwd, notify: 'cat > message; env | grep ^DETENT_ | sort > env' }, details)

  assert.equal(result.asked, true)
  assert.deepEqual(result.channels, [{ kind: 'command', where: 'cat > message; env | grep ^DETENT_ | sort > env', sent: true, via: 'command' }])
  assert.equal(readFileSync(join(cwd, 'message'), 'utf8'), details.message)
  const env = readFileSync(join(cwd, 'env'), 'utf8')
  assert.match(env, /^DETENT_TASK=0042$/m)
  assert.match(env, /^DETENT_REPO=acme-api$/m)
  assert.match(env, /^DETENT_OUTCOME=escalated$/m)
  assert.match(env, /^DETENT_BRANCH=agent\/task-0042-wallet$/m)
  assert.match(env, /^DETENT_MESSAGE=task 0042 is paused/m)
  // The one addition, and additive: a command that does not read it is
  // unaffected, and one channel serving several events can tell them apart.
  assert.match(env, /^DETENT_EVENT=paused$/m)

  // And the string normalises to exactly one command channel on a pause, which
  // is the whole of the compatibility claim.
  assert.deepEqual(notifyPlan('say it'), { events: [...DEFAULT_EVENTS], channels: [{ kind: 'command', command: 'say it' }] })
})

test('the default is today’s behaviour: a pause, and nothing else', async () => {
  assert.deepEqual([...DEFAULT_EVENTS], ['paused'])
  const cwd = dir()
  const product = { dir: cwd, notify: 'echo $DETENT_EVENT >> called' }

  const paused = await notify(product, details)
  const passed = await notify(product, { ...details, event: 'passed', outcome: 'passed' })
  const promoted = await notify(product, { ...details, event: 'promoted', outcome: 'passed' })

  assert.equal(paused.asked, true)
  assert.equal(passed.asked, false, 'a task that passed tells nobody until somebody asks')
  assert.deepEqual(passed.channels, [], 'and no channel is even called')
  assert.equal(promoted.asked, false)
  assert.equal(readFileSync(join(cwd, 'called'), 'utf8'), 'paused\n')
})

test('events are named, and a raw outcome may be named on its own', async () => {
  assert.deepEqual([...EVENTS], ['paused', 'passed', 'promoted', 'escalated', 'rejected', 'error', 'red'])
  const cwd = dir()
  const asking = (events) => ({ dir: cwd, notify: { events, channels: [{ kind: 'command', command: 'true' }] } })

  assert.equal((await notify(asking(['passed']), { ...details, event: 'passed', outcome: 'passed' })).asked, true)
  assert.equal((await notify(asking(['passed']), details)).asked, false, 'asking for passed is not asking for a pause')
  assert.equal((await notify(asking(['promoted']), { ...details, event: 'promoted', outcome: 'passed' })).asked, true)

  // `error` alone: the pause whose outcome is an error, and neither of the two
  // other things that pause a task.
  const onlyErrors = asking(['error'])
  assert.equal((await notify(onlyErrors, { ...details, outcome: 'error' })).asked, true)
  assert.equal((await notify(onlyErrors, { ...details, outcome: 'escalated' })).asked, false)
  assert.equal((await notify(onlyErrors, { ...details, outcome: 'rejected' })).asked, false)

  // And an empty list is silence, said out loud: present means what it says.
  assert.equal((await notify({ dir: cwd, notify: { events: [] } }, details)).asked, false)
})

// ——— One channel failing is not the run failing, and holds per channel.

test('a channel that fails is reported, never thrown, and the others still send', async () => {
  const cwd = dir()
  const result = await notify({
    dir: cwd,
    notify: {
      channels: [
        { kind: 'command', command: 'echo "no route to chat" >&2; exit 4' },
        { kind: 'command', command: 'cat > arrived' },
      ],
    },
  }, details)

  assert.equal(result.channels.length, 2)
  assert.equal(result.channels[0].sent, false)
  assert.match(result.channels[0].error, /exit code 4: no route to chat/)
  assert.equal(result.channels[1].sent, true, 'the second channel was not stopped by the first')
  assert.equal(readFileSync(join(cwd, 'arrived'), 'utf8'), details.message)

  // What a terminal prints, from the result rather than from each command's
  // own idea of it: one line per channel that did not deliver.
  assert.deepEqual(notifyProblems(result).length, 1)
  assert.match(notifyProblems(result)[0], /^could not notify via command \(echo "no route to chat" >&2; exit 4\): exit code 4/)
  assert.deepEqual(notifyProblems({ channels: [] }), [])
  assert.deepEqual(notifyProblems(null), [])
})

test('without a command, a desktop notifier is tried, and its absence is reported', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'detent-bin-'))
  const env = process.env.PATH
  try {
    process.env.PATH = bin
    const name = process.platform === 'darwin' ? 'osascript' : 'notify-send'
    const none = await notify({ dir: tmpdir() }, details)
    assert.deepEqual(
      none.channels,
      [{
        kind: 'command',
        where: `the desktop notifier on ${process.platform}`,
        sent: false,
        error: `no notify command in product.json, and no desktop notifier answered on ${process.platform} (tried ${name})`,
      }],
      `the platform is named, and so is what it tried: ${process.platform}`,
    )

    writeFileSync(join(bin, name), `#!/bin/sh\necho "$@" > ${JSON.stringify(join(bin, 'called'))}\n`)
    chmodSync(join(bin, name), 0o755)
    const answered = await notify({ dir: tmpdir(), notify: null }, details)
    assert.deepEqual(answered.channels, [{ kind: 'command', where: `the desktop notifier on ${process.platform}`, sent: true, via: name }], `${process.platform} reaches for ${name}`)
    assert.match(readFileSync(join(bin, 'called'), 'utf8'), /3 identical failures on test/)
  } finally {
    process.env.PATH = env
  }
})

// ——— telegram: one POST, no dependency (ADR 0025).

test('telegram is one POST, and the token comes from the environment at send time', async () => {
  const cwd = dir()
  const bot = await botApi(() => [200, { ok: true, result: { message_id: 7 } }])
  const token = '123456789:AAHfake-bot-token-for-this-test'
  process.env.DETENT_TEST_TELEGRAM = token
  try {
    const result = await notify(
      { dir: cwd, notify: { channels: [{ kind: 'telegram', chat: '-1001234567890', thread: 12, tokenEnv: 'DETENT_TEST_TELEGRAM' }] } },
      details,
      { api: bot.api },
    )

    assert.deepEqual(result.channels, [{ kind: 'telegram', where: 'chat -1001234567890, topic 12', sent: true, via: 'telegram' }])
    assert.equal(bot.requests.length, 1, 'attempted once — detent is not a notification router')
    const [sent] = bot.requests
    assert.equal(sent.method, 'POST')
    assert.equal(sent.path, `/bot${token}/sendMessage`)
    assert.equal(sent.type, 'application/json')
    assert.deepEqual(sent.body, { chat_id: '-1001234567890', message_thread_id: 12, text: details.message })

    // A chat that is not a forum sends no topic, rather than sending null.
    const plain = await notify(
      { dir: cwd, notify: { channels: [{ kind: 'telegram', chat: '@acme_builds', tokenEnv: 'DETENT_TEST_TELEGRAM' }] } },
      details,
      { api: bot.api },
    )
    assert.equal(plain.channels[0].where, 'chat @acme_builds')
    assert.deepEqual(Object.keys(bot.requests[1].body).sort(), ['chat_id', 'text'])
  } finally {
    delete process.env.DETENT_TEST_TELEGRAM
    bot.close()
  }
})

test('a channel whose variable is unset is reported as named and not set, and nothing is sent', async () => {
  const cwd = dir()
  const bot = await botApi(() => [200, { ok: true, result: {} }])
  try {
    delete process.env.DETENT_TEST_UNSET
    const result = await notify(
      { dir: cwd, notify: { channels: [{ kind: 'telegram', chat: '42', tokenEnv: 'DETENT_TEST_UNSET' }] } },
      details,
      { api: bot.api },
    )
    assert.equal(result.channels[0].sent, false)
    assert.equal(result.channels[0].error, 'DETENT_TEST_UNSET is named, and not set — export it, or set it on the dashboard')
    assert.equal(bot.requests.length, 0, 'a request with nothing where the token goes is not sent')
  } finally {
    bot.close()
  }
})

test('a token given to a failing channel does not appear in what comes back', async () => {
  const cwd = dir()
  const token = '987654321:AAH-this-must-not-be-anywhere-in-the-result'
  // The adversarial answer: an API that quotes the token back in its own error,
  // which is how a secret reaches a journal line that is never rewritten.
  const bot = await botApi(() => [401, { ok: false, error_code: 401, description: `Unauthorized: bot ${token} is not valid` }])
  process.env.DETENT_TEST_TELEGRAM = token
  try {
    const result = await notify(
      { dir: cwd, notify: { channels: [{ kind: 'telegram', chat: '42', tokenEnv: 'DETENT_TEST_TELEGRAM' }] } },
      details,
      { api: bot.api },
    )

    assert.equal(result.channels[0].sent, false)
    assert.match(result.channels[0].error, /^401: Unauthorized: bot …/)
    const everything = JSON.stringify(result) + notifyProblems(result).join('\n')
    assert.ok(!everything.includes(token), `the token is in what comes back:\n${everything}`)
    assert.ok(!everything.includes(bot.api), 'and so is the URL it was in')
  } finally {
    delete process.env.DETENT_TEST_TELEGRAM
    bot.close()
  }
})

test('a kind that throws is a line in the result rather than an exception out of it', async () => {
  const cwd = dir()
  const token = 'a-token-long-enough-to-redact'
  process.env.DETENT_TEST_TELEGRAM = token
  try {
    // Nothing is listening there, so `fetch` fails — the condition, not the
    // URL, because the URL has the token in it.
    const result = await notify(
      { dir: cwd, notify: { channels: [{ kind: 'telegram', chat: '42', tokenEnv: 'DETENT_TEST_TELEGRAM' }] } },
      details,
      { api: 'http://127.0.0.1:1' },
    )
    assert.equal(result.channels[0].sent, false)
    assert.match(result.channels[0].error, /could not be reached/)
    assert.ok(!JSON.stringify(result).includes(token))
  } finally {
    delete process.env.DETENT_TEST_TELEGRAM
  }
})

test('the kinds are the kinds, and a third is one file and one line', () => {
  // Two, and each one has delivered a message rather than merely compiled
  // (ADR 0025, carrying ADR 0018's rule across).
  assert.deepEqual([...KIND_NAMES], ['command', 'telegram'])
})
