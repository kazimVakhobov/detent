// The agents detent can run, behind one call (ADR 0010).
//
// Each adapter knows three things about its CLI: how to run it unattended and
// non-interactively, how to hand it a prompt, and how to read what it printed.
// Everything above this file sees the same result whichever agent ran.
//
// What a CLI does not report is null, never estimated: an invented model name
// or cost would quietly corrupt every comparison built on the journal.
//
// The table has one row in this version, and stays a table: an agent is added
// back as a row here and a name in the schema once it has run a real task and
// its adapter was written against what it printed (ADR 0018).

import { spawn } from 'node:child_process'
import process from 'node:process'

export const AGENTS = {
  // Claude Code: JSONL on stdout, one object per thing that happened, and the
  // result object last (ADR 0021).
  claude: {
    command: 'claude',
    // Plan mode is Claude Code's read-only mode: it reads and refuses to write.
    //
    // `stream-json` prints as the work happens instead of once at the end, and
    // needs `--verbose` to do it under `-p`. Its last line is the same result
    // object `json` printed on its own, so every number below is read from the
    // same place it was read from before: reading the last JSON object of a
    // stream rather than the only one costs nothing and lets somebody watch.
    args: ({ model, readOnly }) => ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', readOnly ? 'plan' : 'bypassPermissions', ...(model ? ['--model', model] : [])],
    parse(stdout) {
      const out = lastJson(stdout)
      if (!out) return null
      const usage = out.usage ?? {}
      const models = Object.entries(out.modelUsage ?? {}).map(([name, u]) => [name, u.outputTokens ?? 0])
      return {
        ok: out.is_error === false && out.subtype === 'success',
        message: typeof out.result === 'string' ? out.result : '',
        actual: busiest(models),
        usd: typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null,
        tokens: tokens(
          sum(usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens),
          usage.output_tokens,
        ),
        session: out.session_id ?? null,
        error: failure(out),
      }
    },
  },
}

// Why an errored result failed, in the CLI's own words with a word of detent's
// in front of it to say what kind of failure it was.
//
// `subtype` says how the turn ended and not whether it worked: a model the
// installed CLI cannot run comes back `is_error: true` with `subtype:
// "success"` and `api_error_status: 400`. The verdict was always right — `ok`
// requires both — but the sentence opened with the word `success`, and the
// first person to mistype a model name is the person who reads it (ADR 0019).
// So the subtype leads only when it is not that one word, and otherwise the
// status does: a 400 reads as a 400.
function failure(out) {
  if (!out.is_error) return null
  const status = out.api_error_status ?? null
  const subtype = typeof out.subtype === 'string' && out.subtype !== 'success' ? out.subtype : null
  const what = subtype ? `${subtype}${status ? ` (${status})` : ''}` : status ? String(status) : 'error'
  return `${what}: ${out.result ?? ''}`.trim()
}

// `readOnly` runs the agent in its CLI's read-only mode — for a reviewer, which
// has no business changing what it reviews. `timeoutMs` bounds the call: past
// it the agent gets SIGTERM, then SIGKILL after `graceMs` if it is still there.
//
// `log` is somewhere to put what the agent prints as it prints it — a sink from
// `log.mjs`, or nothing. It is written to and never read: the result below is
// parsed from the output in memory, exactly as it was before there was a file
// (ADR 0021). A sink that fails is a sink that stops working, not a call that
// fails, which is why nothing here looks at what writing returned.
export function invoke(role, { cwd, prompt, readOnly = false, timeoutMs = null, graceMs = 10_000, env = process.env, log = null }) {
  const adapter = AGENTS[role.agent]
  if (!adapter) throw new Error(`unknown agent "${role.agent}"`)
  const requested = role.model ?? null

  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    // Its own process group, so that stopping it stops what it started too: an
    // agent's shell commands outlive a SIGTERM to the agent alone, and keep its
    // output open. The price is that a terminal's Ctrl-C no longer reaches it,
    // so detent stops every live agent itself (stopAgents).
    const child = spawn(adapter.command, adapter.args({ model: role.model, readOnly }), {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
    if (child.pid) live.add(child.pid)
    // Decoded by the stream rather than by `+=`: a stream arrives in chunks cut
    // wherever the pipe filled, and a multi-byte character split across two of
    // them is two broken halves when each is turned into text on its own. One
    // object at the end survived that by luck; many lines would not.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      // A log is not the work: a sink that throws loses the log, never the run.
      try {
        log?.write(chunk)
      } catch {}
    })
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.stdin.on('error', () => {}) // an agent that exits without reading is reported below
    child.stdin.end(prompt)

    let settled = false
    let timedOut = false
    let killer = null
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            timedOut = true
            signalGroup(child, 'SIGTERM')
            killer = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs)
          }, timeoutMs)

    const finish = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killer)
      live.delete(child.pid)
      resolve({
        agent: role.agent,
        ok: r.ok ?? false,
        message: r.message ?? '',
        model: { requested, actual: r.actual ?? null },
        cost: { usd: r.usd ?? null, tokens: r.tokens ?? null },
        session: r.session ?? null,
        error: r.error ?? null,
        ms: Date.now() - started,
      })
    }

    child.on('error', (error) => {
      finish({ error: error.code === 'ENOENT' ? `${adapter.command} is not installed, or not on PATH` : error.message })
    })
    child.on('close', (code, signal) => {
      if (timedOut) {
        // What it cost up to the cut is kept if it was printed; the verdict is
        // that it did not finish, whatever it said before it was stopped.
        const partial = adapter.parse(stdout) ?? {}
        return finish({ ...partial, ok: false, error: `${adapter.command} ran past the ${minutes(timeoutMs)} limit and was stopped` })
      }
      const parsed = adapter.parse(stdout)
      const exit = signal ? `killed by ${signal}` : `exit code ${code}`
      if (!parsed) return finish({ error: `${adapter.command} printed nothing detent can read (${exit})${tail(stderr)}` })
      if (code !== 0 && parsed.ok) return finish({ ...parsed, ok: false, error: `${adapter.command} finished with ${exit}${tail(stderr)}` })
      finish(parsed)
    })
  })
}

// The last JSON object the agent printed. With a stream that is the result
// object on the last line; with one object on its own it is that object; with a
// line of the CLI's own before either, it is still the last one that reads as
// an object. A line that is half-printed, or output nobody can read, is null —
// the caller says so and does not guess.
function lastJson(text) {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line === '' || line[0] !== '{') continue
    const parsed = object(line)
    if (parsed) return parsed
  }
  // Pretty-printed, across lines, and therefore not a stream.
  return object(text.trim())
}

function object(text) {
  if (text === '' || text[0] !== '{') return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// The model that did most of the work, when a CLI used more than one — a
// subagent on a small model should not be reported as the model that ran.
function busiest(models) {
  if (models.length === 0) return null
  return models.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
}

function sum(...values) {
  return values.reduce((total, value) => total + (typeof value === 'number' ? value : 0), 0)
}

function tokens(input, output) {
  return { input: input ?? 0, output: output ?? 0 }
}

// Every agent process group still running, for stopAgents.
const live = new Set()

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {}
  }
}

// Stop every agent still running — on Ctrl-C, on SIGTERM, and on any exit, so
// no agent keeps writing into a repository detent has already put back.
export function stopAgents(signal = 'SIGTERM') {
  for (const pid of live) {
    try {
      process.kill(-pid, signal)
    } catch {}
  }
}
process.on('exit', () => stopAgents('SIGKILL'))

function minutes(ms) {
  const m = ms / 60_000
  return Number.isInteger(m) ? `${m}-minute` : `${(ms / 1000).toFixed(1)}-second`
}

function tail(stderr) {
  const text = stderr.trim()
  return text ? `: ${text.split('\n').slice(-5).join('\n')}` : ''
}
