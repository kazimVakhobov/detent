// The adapter against what its CLI really prints. The sample is taken from the
// CLI itself: Claude Code 2.1, run for real. That is the bar an agent has to
// clear to be in the table at all (ADR 0018) — the two adapters written from
// their source and never run left with this version, and their samples with
// them. A fake binary of the same name stands in for the CLI and records how it
// was called.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invoke, stopAgents } from '../core/agents.mjs'
import { openAttemptLog } from '../core/log.mjs'
import { MODEL_SUGGESTIONS } from '../core/product.mjs'

const CLAUDE = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Added the wallet endpoint.\nCommit: feat(wallet): balance endpoint',
  session_id: '6e5219f1-effe-5323-8188-8e5f9b94ac08',
  total_cost_usd: 0.0145338,
  usage: { input_tokens: 10, cache_creation_input_tokens: 5463, cache_read_input_tokens: 23998, output_tokens: 49 },
  modelUsage: {
    'claude-opus-5': { inputTokens: 908, outputTokens: 600, costUSD: 0.012 },
    'claude-haiku-4-5-20251001': { inputTokens: 300, outputTokens: 60, costUSD: 0.002 },
  },
}

// The same run as a stream: what `--output-format stream-json --verbose`
// prints, which is the events as they happen and that same result object on the
// last line (ADR 0021). Everything the journal records is read from the last
// line, so the lines before it may say anything at all.
const STREAM = [
  { type: 'system', subtype: 'init', session_id: CLAUDE.session_id, model: 'claude-opus-5', tools: ['Read', 'Edit'] },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at the wallet module.' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'wallet.js' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'export const balance = 0\n' }] } },
  { type: 'rate_limit_event', retry_after: 2 },
  CLAUDE,
].map((event) => JSON.stringify(event)).join('\n')

// A fake CLI: records argv and stdin, prints `output`, exits with `code`.
function fake(name, output, { code = 0, stderr = '' } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'detent-agent-'))
  const out = join(bin, 'output')
  writeFileSync(out, output)
  writeFileSync(
    join(bin, name),
    `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a"; done > "${bin}/argv"
cat > "${bin}/stdin"
pwd > "${bin}/cwd"
cat "${out}"
printf '%s' ${JSON.stringify(stderr)} >&2
exit ${code}
`,
  )
  chmodSync(join(bin, name), 0o755)
  return {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    argv: () => readFileSync(join(bin, 'argv'), 'utf8').trim().split('\n'),
    stdin: () => readFileSync(join(bin, 'stdin'), 'utf8'),
    cwd: () => readFileSync(join(bin, 'cwd'), 'utf8').trim(),
  }
}

// Resolved, because on macOS the temporary directory is a symlink and the
// fake CLI's `pwd` reports where it really stands, not the way in.
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'detent-agent-cwd-')))

test('claude: unattended print mode, the output as a stream, prompt on stdin, cost and model as reported', async () => {
  const cli = fake('claude', STREAM)
  const result = await invoke({ agent: 'claude', model: 'claude-opus-5' }, { cwd, prompt: '# Goal\n\nwallet', env: cli.env })
  assert.deepEqual(cli.argv(), ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--model', 'claude-opus-5'])
  assert.equal(cli.stdin(), '# Goal\n\nwallet')
  assert.equal(cli.cwd(), cwd)
  assert.equal(result.ok, true)
  assert.equal(result.agent, 'claude')
  assert.match(result.message, /^Commit: feat\(wallet\)/m)
  assert.deepEqual(result.model, { requested: 'claude-opus-5', actual: 'claude-opus-5' }, 'the subagent model is not the model that ran')
  assert.deepEqual(result.cost, { usd: 0.0145338, tokens: { input: 29471, output: 49 } })
  assert.equal(result.session, CLAUDE.session_id)
  assert.equal(result.error, null)
})

// The point of the change, held to its own claim: the stream's last line is the
// object the one-object format printed on its own, so every number the journal
// records is the number it recorded before (ADR 0021). Not "near enough" —
// the same object, field for field.
test('the result read from a stream is the result read from one object', async () => {
  const streamed = fake('claude', STREAM)
  const alone = fake('claude', JSON.stringify(CLAUDE))
  const one = await invoke({ agent: 'claude', model: 'claude-opus-5' }, { cwd, prompt: 'x', env: streamed.env })
  const two = await invoke({ agent: 'claude', model: 'claude-opus-5' }, { cwd, prompt: 'x', env: alone.env })
  assert.deepEqual({ ...one, ms: 0 }, { ...two, ms: 0 })
})

test('claude: no model requested passes no --model, and the actual one is still reported', async () => {
  const cli = fake('claude', JSON.stringify(CLAUDE))
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env })
  assert.ok(!cli.argv().includes('--model'))
  assert.deepEqual(result.model, { requested: null, actual: 'claude-opus-5' })
})

test('claude: an error result is not ok, and says why', async () => {
  const cli = fake('claude', JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Credit balance is too low', api_error_status: 400 }), { code: 1 })
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env })
  assert.equal(result.ok, false)
  // A subtype that says what went wrong still leads, with the status after it:
  // what is recorded as the failure is unchanged where it was already right.
  assert.equal(result.error, 'error_during_execution (400): Credit balance is too low')
})

// A model the installed binary will not run, as the CLI really answers it: the
// verdict was always right — `ok` requires `is_error: false` *and* a `success`
// subtype — but the sentence was composed from the subtype and so opened with
// the word `success`, and the first person to mistype a model name is the
// person who reads it (ADR 0019).
test('claude: an errored result whose subtype says "success" reads as the status it carries', async () => {
  const refused = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    api_error_status: 400,
    result: 'API Error: 400 Claude Code 2.1.220 does not support this model; version 2.1.280 or newer is required',
  }
  const cli = fake('claude', JSON.stringify(refused))
  const result = await invoke({ agent: 'claude', model: 'claude-opus-5-5' }, { cwd, prompt: 'x', env: cli.env })
  assert.equal(result.ok, false)
  assert.equal(result.error, `400: ${refused.result}`)
  assert.ok(!result.error.startsWith('success'), 'a 400 reads as a 400')
  // And the service's own sentence is carried whole: which version of the CLI
  // would have run it is the only thing that answers the question.
  assert.match(result.error, /version 2\.1\.280 or newer is required$/)
  assert.deepEqual(result.model, { requested: 'claude-opus-5-5', actual: null })
})

// An error with no status either: the leading word is detent's and says only
// that it failed, rather than borrowing a word that means the opposite.
test('claude: an errored result with nothing to lead with says error', async () => {
  const cli = fake('claude', JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'something went wrong' }))
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'error: something went wrong')
})

// The suggestions are a suggestion: a model that is on no list is passed to the
// CLI as written and the run is an ordinary one (ADR 0019).
test('a model name outside the shipped list is passed to the CLI and runs', async () => {
  assert.ok(!MODEL_SUGGESTIONS.includes('claude-sonnet-5-5'))
  const cli = fake('claude', STREAM)
  const result = await invoke({ agent: 'claude', model: 'claude-sonnet-5-5' }, { cwd, prompt: 'x', env: cli.env })
  const argv = cli.argv()
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'claude-sonnet-5-5'])
  assert.equal(result.ok, true)
  assert.equal(result.model.requested, 'claude-sonnet-5-5')
})

// And an alias costs the journal nothing: `requested` keeps what was asked for
// and `actual` keeps the model the CLI reported resolving it to, so the pair
// stays comparable across months in which the alias pointed at different
// things (ADR 0019).
test('an alias is requested and the model it resolved to is recorded', async () => {
  const cli = fake('claude', JSON.stringify({ ...CLAUDE, modelUsage: { 'claude-opus-5': { outputTokens: 600 } } }))
  const result = await invoke({ agent: 'claude', model: 'opus' }, { cwd, prompt: 'x', env: cli.env })
  assert.ok(MODEL_SUGGESTIONS.includes('opus'), 'the aliases lead the shipped list')
  assert.deepEqual(result.model, { requested: 'opus', actual: 'claude-opus-5' })
})

test('an agent that is not installed resolves with the reason, not a throw', async () => {
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: { ...process.env, PATH: mkdtempSync(join(tmpdir(), 'empty-')) } })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'claude is not installed, or not on PATH')
  assert.deepEqual(result.cost, { usd: null, tokens: null })
})

test('output nobody can read, or a non-zero exit, is not ok', async () => {
  const garbage = fake('claude', 'Segmentation fault', { code: 139, stderr: 'core dumped' })
  const one = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: garbage.env })
  assert.equal(one.ok, false)
  assert.match(one.error, /claude printed nothing detent can read \(exit code 139\): core dumped/)

  const exited = fake('claude', JSON.stringify(CLAUDE), { code: 2 })
  const two = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: exited.env })
  assert.equal(two.ok, false)
  assert.match(two.error, /claude finished with exit code 2/)
  assert.equal(two.cost.usd, 0.0145338, 'what it cost is kept even when it failed')
})

// An agent the table has no row for. A name the schema refuses never reaches
// here, so reaching here is a mistake in detent rather than in a product.
test('an unknown agent is a programming error', () => {
  assert.throws(() => invoke({ agent: 'cursor' }, { cwd, prompt: 'x' }), /unknown agent "cursor"/)
  assert.throws(() => invoke({ agent: 'codex' }, { cwd, prompt: 'x' }), /unknown agent "codex"/, 'withdrawn by 0018, and not a half-present row')
})

test('read-only runs the CLI in its own read-only mode — for a reviewer', async () => {
  const cli = fake('claude', JSON.stringify(CLAUDE))
  await invoke({ agent: 'claude' }, { cwd, prompt: 'review', readOnly: true, env: cli.env })
  const argv = cli.argv()
  const at = argv.indexOf('--permission-mode')
  assert.deepEqual(argv.slice(at, at + 2), ['--permission-mode', 'plan'])
  assert.ok(!argv.includes('bypassPermissions'))
})

// --- what the agent is saying, while it says it (ADR 0021) ---------------------

// A fake CLI that prints the first of the stream, waits to be let go, and then
// prints the rest: an agent in the middle of its turn, which is the only moment
// the claim below can be tested at.
function handOver(name) {
  const bin = mkdtempSync(join(tmpdir(), 'detent-stream-'))
  const lines = STREAM.split('\n')
  writeFileSync(join(bin, 'head'), `${lines.slice(0, 2).join('\n')}\n`)
  writeFileSync(join(bin, 'rest'), `${lines.slice(2).join('\n')}\n`)
  writeFileSync(
    join(bin, name),
    `#!/bin/sh
cat > /dev/null
cat "${bin}/head"
while [ ! -f "${bin}/go" ]; do sleep 0.05; done
cat "${bin}/rest"
`,
  )
  chmodSync(join(bin, name), 0o755)
  return { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, go: () => writeFileSync(join(bin, 'go'), '') }
}

const until = async (done) => {
  for (let i = 0; i < 200 && !done(); i += 1) await new Promise((r) => setTimeout(r, 25))
  return done()
}

test('the log appears and grows while the agent runs, and holds every byte it printed', async () => {
  const cli = handOver('claude')
  const log = openAttemptLog(mkdtempSync(join(tmpdir(), 'detent-log-')), '0042', 2)
  assert.match(log.path, /runs[/\\]logs[/\\]0042-attempt-2\.jsonl$/)
  const call = invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env, log })

  // The agent has not finished, and what it has said so far is already there.
  assert.ok(await until(() => existsSync(log.path) && readFileSync(log.path, 'utf8').includes('Looking at the wallet module')), 'the file appears and grows mid-turn')
  const early = readFileSync(log.path, 'utf8')
  assert.match(early, /"type":"system"/)
  assert.ok(!early.includes('"type":"result"'), 'it is not waiting for the end to write anything')

  cli.go()
  const result = await call
  log.close()
  assert.equal(result.ok, true)
  assert.equal(result.session, CLAUDE.session_id)
  assert.equal(readFileSync(log.path, 'utf8'), `${STREAM}\n`, 'byte for byte, as the agent printed it')
})

test('a log that cannot be written does not cost the task', async () => {
  const cli = fake('claude', STREAM)
  // A product folder that is a file: nothing can be created under it.
  const wall = join(mkdtempSync(join(tmpdir(), 'detent-log-')), 'wall')
  writeFileSync(wall, 'not a folder\n')
  const said = []
  const log = openAttemptLog(wall, '0042', 1, { warn: (text) => said.push(text) })

  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env, log })
  log.close()
  assert.equal(result.ok, true, 'a log is not the work')
  assert.deepEqual(result.cost, { usd: 0.0145338, tokens: { input: 29471, output: 49 } })
  assert.equal(result.session, CLAUDE.session_id)
  assert.equal(said.length, 1)
})

test('a sink that throws loses the log, not the run', async () => {
  const cli = fake('claude', STREAM)
  const thrown = { write() { throw new Error('the disk is somebody else\'s problem') }, close() {} }
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env, log: thrown })
  assert.equal(result.ok, true)
  assert.equal(result.session, CLAUDE.session_id)
})

// --- the time limit ------------------------------------------------------------

function hanging(name, script) {
  const bin = mkdtempSync(join(tmpdir(), 'detent-hang-'))
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, name), 0o755)
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
}

// The limit and what it reaches are two tests rather than one, because they
// want opposite things from the clock. A limit starts when detent spawns the
// agent, so a test that also reads what the fixture recorded has to out-wait
// process startup — and under the whole suite `sh` can take seconds to reach
// its first line, which no limit short enough to keep this test quick will
// clear. Nothing is lost by separating them: a limit and `stopAgents` differ
// in what starts them, not in what they signal, and both go through
// signalGroup. So the limit is checked on its own below, and what the signal
// reaches is checked where the test can wait for the fixture to be ready
// before anything is stopped.
test('a call past its limit is stopped, and says which limit', async () => {
  const env = hanging('claude', 'cat > /dev/null; sleep 30')
  const started = Date.now()
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env, timeoutMs: 500 })
  assert.ok(Date.now() - started < 5000, 'it did not wait for the agent')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'claude ran past the 0.5-second limit and was stopped')
})

test('stopping an agent stops what the agent started', async () => {
  const pidfile = join(mkdtempSync(join(tmpdir(), 'detent-pid-')), 'pid')
  // The way an agent runs a command: a child that holds the output open. The
  // pid is written first, and nothing is stopped until the test has read it,
  // so how long the shell took to start does not decide the outcome.
  const env = hanging('claude', `sleep 30 & echo $! > ${pidfile}; cat > /dev/null; wait`)
  const call = invoke({ agent: 'claude' }, { cwd, prompt: 'x', env })
  // A file can exist before it has been written to, so the number is what is
  // waited for, not the path.
  const written = () => {
    try {
      return Number(readFileSync(pidfile, 'utf8').trim())
    } catch {
      return 0
    }
  }
  for (let i = 0; i < 200 && !written(); i += 1) await new Promise((r) => setTimeout(r, 50))
  const child = written()
  assert.ok(child > 0, 'the fixture started, and said what it started')

  stopAgents('SIGTERM')
  const result = await call
  assert.equal(result.ok, false)
  assert.match(result.error, /SIGTERM/)
  // Signal 0 asks whether a pid can be signalled, and a process that has
  // exited and not been reaped still can. Its parent is the shell detent just
  // stopped, so nothing here can wait for it, and how long it lingers belongs
  // to whatever adopts it rather than to detent: an init that reaps at once on
  // one machine, a container's shell that never does on another. Linux answers
  // the question in /proc, where state Z is exited; macOS has no /proc and
  // reaps an orphan promptly enough that signal 0 is the whole answer there.
  const alive = () => {
    try {
      process.kill(child, 0)
    } catch {
      return false
    }
    try {
      const stat = readFileSync(`/proc/${child}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[0] !== 'Z'
    } catch {
      return true
    }
  }
  // A signal is delivered, not executed on the spot: give it a moment.
  for (let i = 0; i < 40 && alive(); i += 1) await new Promise((r) => setTimeout(r, 50))
  assert.equal(alive(), false, `the command the agent started is gone too (on ${process.platform})`)
})

test('stopAgents stops a live agent that has no limit', async () => {
  const env = hanging('claude', 'cat > /dev/null; sleep 30')
  const call = invoke({ agent: 'claude' }, { cwd, prompt: 'x', env })
  await new Promise((r) => setTimeout(r, 200))
  const started = Date.now()
  stopAgents('SIGKILL')
  const result = await call
  assert.ok(Date.now() - started < 5000)
  assert.equal(result.ok, false)
  assert.match(result.error, /killed by SIGKILL/)
})

test('an agent that ignores SIGTERM is killed after the grace period', async () => {
  const env = hanging('claude', "trap '' TERM; cat > /dev/null; while :; do sleep 1; done")
  const started = Date.now()
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env, timeoutMs: 200, graceMs: 300 })
  assert.ok(Date.now() - started < 5000)
  assert.equal(result.ok, false)
  assert.match(result.error, /ran past the 0\.2-second limit/)
})

test('a limit in whole minutes reads as minutes', async () => {
  const cli = fake('claude', JSON.stringify(CLAUDE))
  const result = await invoke({ agent: 'claude' }, { cwd, prompt: 'x', env: cli.env, timeoutMs: 30 * 60_000 })
  assert.equal(result.ok, true, 'a call inside its limit is untouched')
})
