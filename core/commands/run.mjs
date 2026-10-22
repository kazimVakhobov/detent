// detent run — work the queue: every task in todo/, in id order, up to
// `concurrency` at once under the scheduler's two rules (§8).
//
// Before any of that, `hold/` is read. The second of those rules outlives the
// run that paused a barrier, so a barrier that did not pass still bars what
// stands behind it, and a paused task is offered to whoever is there to
// decide about it (ADR 0024). The barring holds with no terminal; the
// question is the only part a terminal changes.

import process from 'node:process'
import { ask as defaultAsk } from '../ask.mjs'
import { failures } from '../doctor.mjs'
import { attemptLogPath } from '../log.mjs'
import { barring, elsewhere, lastRuns, offer, paused, PLAN, RESUME } from '../paused.mjs'
import { INTERACTIVE, amendPrompt, amended, before, openAgent } from '../plan.mjs'
import { moveAndRecord, QueueRepositoryError } from '../queue.mjs'
import { scanProduct } from '../scan.mjs'
import { readQueue, QueueError } from '../task.mjs'
import { runTask } from '../run.mjs'
import { schedule } from '../scheduler.mjs'
import { UsageError } from './usage.mjs'

// `--past` names the barrier it overrides rather than being a bare yes: a
// person who knows one contract landed another way has not said that about
// every paused barrier in the queue. Several may be named, one flag each.
export const options = { past: { type: 'string', multiple: true, default: [] } }

export async function run(product, ids, values = {}, { runTask: runOne = runTask, ask = defaultAsk, spawnAgent = openAgent, out = process.stdout, err = process.stderr } = {}) {
  let queue = readQueue(product.dir, product)
  let held = paused(product, queue)
  let tasks = queue.filter((task) => task.folder === 'todo')
  const named = new Set(ids.map(Number))

  // Checked against what is paused now, before anything is asked or moved: a
  // flag that names nothing is a typo, and a typo must not read as consent.
  const past = new Set((values.past ?? []).map(Number))
  for (const typed of values.past ?? []) {
    const id = Number(typed)
    if (held.some((task) => Number(task.id) === id && task.touchesContract)) continue
    const quiet = held.find((task) => Number(task.id) === id)
    throw new UsageError(
      quiet
        ? `--past ${typed}: ${quiet.id} is paused but changes no contract, so nothing is queued behind it — there is nothing to run past`
        : `--past ${typed}: nothing in ${product.queue}/hold/ has that number${held.length ? ` — paused: ${held.map((t) => t.id).join(', ')}` : ', and nothing is paused'}`,
    )
  }

  // The question, when there is a terminal to ask it on: every paused task
  // for a bare run, and the ones a person named for `detent run <id>`. In id
  // order, one at a time, and `plan` ends the run wherever it is answered.
  const offered = ids.length > 0 ? held.filter((task) => named.has(Number(task.id))) : held
  const answers = await offer(offered, {
    ask,
    out,
    blocked: barring(held, tasks, past).blocked,
    // A named task's sentence is the usage message below, which says the same
    // thing in the place a person who named it will read it.
    announce: ids.length === 0,
  })

  // A resume and a `plan` can be answered in the same pass — 0003 back to
  // todo/, 0006 to the conversation — and the earlier answer is not undone by
  // the later one. So the moves happen first and the conversation opens after
  // them: the screen said "resuming", and a decision a person made about one
  // task is not withdrawn by what they then decided about another.
  const resuming = answers.filter((answer) => answer.answer === RESUME).map((answer) => answer.task)
  const amending = answers.find((answer) => answer.answer === PLAN)
  if (resuming.length > 0) {
    // Through `moveAndRecord`, never a bare rename: a queue that is a
    // repository of its own gets the commit and the push every other move
    // gets, and a resume that cannot be published ends the run exactly as a
    // move that cannot be published does (ADR 0012).
    for (const task of resuming) {
      let moved
      try {
        moved = moveAndRecord(product, task, 'todo')
      } catch (error) {
        if (!(error instanceof QueueRepositoryError)) throw error
        err.write(`stopped: ${error.message} — nothing was started\n`)
        return 1
      }
      const recorded = moved.commit ? ` — queue ${moved.commit.slice(0, 7)}${moved.pushed ? `, pushed to ${moved.pushed}` : ''}` : ''
      out.write(`${task.id}  resumed: ${product.queue}/todo/ (from hold/)${recorded}\n`)
    }
    // Read again, because what was resumed has to be a task a run can work:
    // the four fields `readQueue` only asks of todo/ are asked of it now.
    try {
      queue = readQueue(product.dir, product)
    } catch (error) {
      if (!(error instanceof QueueError)) throw error
      throw new UsageError(`${resuming.map((t) => t.id).join(', ')} came back to todo/, and the queue will not run:\n${error.problems.map((p) => `  ${p}`).join('\n')}`)
    }
    held = paused(product, queue)
    tasks = queue.filter((task) => task.folder === 'todo')
  }

  if (amending) return amend(product, amending.task, { spawnAgent, out, err, resumed: resuming })

  if (ids.length > 0) {
    // A name that is not in todo/ is reported by where it actually is: one
    // sentence per folder, because paused, finished and abandoned are three
    // different things to have typed.
    const last = lastRuns(product.dir)
    const left = new Set(answers.filter((answer) => answer.heard).map((answer) => Number(answer.task.id)))
    const missing = ids.filter((id) => !tasks.some((task) => Number(task.id) === Number(id)))
    if (missing.length > 0) {
      throw new UsageError(
        missing
          // Already said, and answered: the sentence that reports where a task
          // is would be telling a person what they have just read and decided.
          .map((id) => (left.has(Number(id)) ? `${id} is still paused, and nothing behind it started either` : elsewhere(product, id, queue, last)))
          .join('\n'),
      )
    }
    tasks = tasks.filter((task) => named.has(Number(task.id)))
  }

  if (tasks.length === 0) {
    // There is work, and it is paused: a different thing from having none,
    // and so a different sentence rather than that one with a clause on it.
    out.write(
      held.length === 0
        ? `nothing to run: ${product.queue}/todo/ is empty\n`
        : `${held.length === 1 ? 'one task is' : `${held.length} tasks are`} paused in ${product.queue}/hold/ (${held.map((t) => t.id).join(', ')}), and nothing is queued in ${product.queue}/todo/ — detent run ${held.length === 1 ? held[0].id : '<id>'} offers to resume ${held.length === 1 ? 'it' : 'one'}\n`,
    )
    return 0
  }

  // What a paused barrier does not let start. Said before anything begins and
  // whatever answered the question above: leaving a barrier paused leaves it
  // barring, and a run that does less than it was asked to says so.
  const { starting, blocked } = barring(held, tasks, past)
  for (const { barrier, tasks: behind } of blocked) {
    out.write(
      `${behind.map((t) => t.id).join(', ')} not started: ${barrier.id} (${barrier.repo ?? '?'}, ${barrier.slug}) is paused in ${barrier.where} and changes the contract ${behind.length === 1 ? 'it would' : 'they would'} run against — resume it, or detent run --past ${barrier.id}\n`,
    )
  }
  // A run that went past a barrier is not an ordinary run and must not read
  // like one: what it is doing, and whose say-so it is on.
  for (const id of past) {
    const barrier = held.find((task) => Number(task.id) === Number(id))
    if (!barrier) continue
    const behind = starting.filter((task) => Number(task.id) > Number(barrier.id)).map((task) => task.id)
    out.write(`past a paused barrier: ${barrier.id} (${barrier.repo ?? '?'}, ${barrier.slug}) is still paused in ${barrier.where}\n`)
    out.write(`      ${behind.length ? `${behind.join(', ')} ${behind.length === 1 ? 'starts' : 'start'}` : 'nothing behind it starts'} against a contract it did not replace, because --past ${barrier.id} said so\n`)
  }
  if (starting.length === 0) {
    out.write(`nothing started: everything this run would have taken stands behind a paused barrier\n`)
    return 1
  }
  tasks = starting

  // Refused before the first agent starts, like everything else a queue can
  // get wrong: three tasks in, a missing agent is a wasted run.
  const names = [...new Set(tasks.map((task) => task.repo))]
  const unarmed = names.filter((name) => !product.repos.find((repo) => repo.name === name).models.implement)
  if (unarmed.length > 0) {
    throw new UsageError(`no implementing agent for ${unarmed.join(', ')} — set models.implement in product.json`)
  }

  // And refused on what `doctor` would already fail, in the repositories these
  // tasks name: a declared agent nobody installed was found out when it was
  // invoked, which is after the branch exists and the workspace has been taken.
  // One check is one line — the report itself is a command away, and printing
  // it here would be answering a question nobody asked.
  const blocking = failures(product.dir, scanProduct(product.dir, { queue: product.queue }), names)
  if (blocking.length > 0) {
    throw new UsageError(
      [
        `nothing was started — detent doctor fails ${blocking.length === 1 ? 'a check' : `${blocking.length} checks`} on what ${tasks.length === 1 ? 'this task needs' : 'these tasks need'}:`,
        ...blocking.map((check) => `  ${check.repo ? `${check.repo}: ` : ''}${check.text}`),
        'detent doctor for the rest.',
      ].join('\n'),
    )
  }

  const { results, stoppedAt, ended } = await schedule(tasks, {
    concurrency: product.concurrency,
    runOne: (task) => runOne(product, product.repos.find((r) => r.name === task.repo), task),
    onStart: (task) => {
      out.write(`${task.id}  ${task.repo}  ${task.slug}${task.touchesContract ? '  (barrier — runs alone)' : ''}  …\n`)
      // Offered, never shown: several tasks may be running, and their output
      // interleaved in this terminal would be unreadable. So the path, and
      // `tail -f` is the person's choice — in another terminal, or on the
      // dashboard, which is where this is meant to be read (ADR 0021). The
      // name is derivable, so nothing has to be copied out of here: attempt 2
      // is the same path with -attempt-2.
      out.write(`      tail -f ${attemptLogPath(product.dir, task.id, 1)}${product.attempts > 1 ? `  (one per attempt, up to -attempt-${product.attempts})` : ''}\n`)
    },
    onFinish: (task, result) => {
      out.write(`${task.id}  ${line(result)}\n`)
      if (result.notified && !result.notified.sent) out.write(`      could not notify: ${result.notified.error}\n`)
    },
  })
  // The queue is how the next machine knows what has been done. A run that
  // cannot publish it says what failed and stops there (ADR 0012), rather than
  // working on and leaving that machine a queue it cannot see.
  if (ended) {
    const left = ended.left.map((t) => t.id).join(', ')
    err.write(`stopped: ${ended.error.message}${left ? ` — ${left} not started` : ''}\n`)
    return 1
  }
  if (stoppedAt) {
    const left = stoppedAt.left.map((t) => t.id).join(', ')
    out.write(
      `stopped at barrier ${stoppedAt.task.id}: it did not pass, and ${left ? `${left} ${stoppedAt.left.length === 1 ? 'was' : 'were'}` : 'nothing was'} queued behind a contract it did not replace${left ? ' — not started' : ''}\n`,
    )
  }
  return !stoppedAt && blocked.length === 0 && results.every(({ result }) => result.outcome === 'passed') ? 0 : 1
}

// `plan`, opened on a task that is already written: the pre-prompt says which
// file is being amended and what the last run said about it, and the run ends
// there. It does not chain into a run — the person has just finished a
// conversation and has not read what came out of it, and starting an
// unattended agent on the strength of that is the one thing this command is
// careful about everywhere else.
//
// Which is also why what the conversation left is checked, the way `plan`
// checks its own: the prompt says to change one file and write no code, and a
// prompt is an instruction rather than a guarantee. The person it is handed
// back to is the only one who can catch that, and they have not read the
// conversation yet — so what it did outside the one file it was given is named
// here rather than found later.
async function amend(product, task, { spawnAgent, out, err, resumed = [] }) {
  const role = product.models?.implement
  if (!role || !Object.hasOwn(INTERACTIVE, role.agent)) {
    throw new UsageError(`no agent to change ${task.id} with — set models.implement in product.json to ${Object.keys(INTERACTIVE).join(' or ')}, or edit ${task.where} by hand`)
  }
  const was = before(product)
  const [command, args] = INTERACTIVE[role.agent]({ model: role.model, prompt: amendPrompt(product, task) })
  const code = await spawnAgent(command, args, product.dir)
  if (code === null) {
    err.write(`detent run: ${command} is not installed, or not on PATH\n`)
    return 1
  }
  const { changed, gone, breaches } = amended(product, was, task)
  out.write(
    [
      // Said here because it is the one thing the resume lines above do not:
      // the file moved, and then this conversation ended the run, so what was
      // resumed is queued and waiting rather than running.
      ...(resumed.length > 0
        ? [`${resumed.map((t) => t.id).join(', ')} ${resumed.length === 1 ? 'is' : 'are'} back in ${product.queue}/todo/ and ${resumed.length === 1 ? 'was' : 'were'} not started: this run ended with the conversation.`]
        : []),
      ...(gone ? [] : [changed ? `changed  ${task.where}` : `unchanged  ${task.where} — the conversation left the task file as it was.`]),
      ...(breaches.length > 0 ? ['', `changing a task changes that one file, and ${breaches.length === 1 ? 'this changed as well' : 'these changed as well'} — look at ${breaches.length === 1 ? 'it' : 'them'}:`, ...breaches.map((b) => `  ${b}`), ''] : []),
      gone
        ? `${task.id} is not in ${task.where} any more — put its file back there before anything can run it.`
        : `${task.id} is still paused, in ${task.where} — read what the conversation left there.`,
      `Then: detent run ${task.id}   (it offers to resume it; nothing has started)`,
      '',
    ].join('\n'),
  )
  return breaches.length > 0 ? 1 : 0
}

function line(r) {
  const tries = `${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}`
  const cost = r.cost.usd !== null ? `, $${r.cost.usd.toFixed(2)}` : r.cost.tokens ? `, ${r.cost.tokens.input + r.cost.tokens.output} tokens` : ''
  switch (r.outcome) {
    case 'passed':
      return `passed — merged into agent/dev (${r.commit.slice(0, 7)}), ${tries}${cost}${r.lock === 'absent' ? ' — no gauge, so nothing was checked' : ''}`
    case 'skipped':
      return `skipped: ${r.reason}`
    default:
      return `paused (${r.outcome}): ${r.reason} — ${tries}${cost}`
  }
}
