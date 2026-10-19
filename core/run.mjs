// One task, from its file to agent/dev (build steps 4, 5 and 11).
//
//   the agent works → the gauge runs on its way out
//     green            → one commit on the task branch, the acceptance pass,
//                        then the merge into agent/dev behind the merge profile
//     a doubt          → rejected: the task paused with the doubts
//     red              → the agent is handed the failure and goes back in
//     red, last attempt, agent error, nothing changed
//                      → the work is parked, the task paused, a person told
//
// The result has the shape of a journal line (DESIGN.md §11) so that writing
// the journal (step 6) is appending it.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { formatGauge, runGauge } from './gauge.mjs'
import { abortMerge, beginMerge, concludeMerge, currentBranch, deleteBranch, forceCheckout, git, isClean, setRef, snapshotOnto, snapshotRefs, tip } from './git.mjs'
import { acceptancePrompt, parseVerdict, taskDiff } from './acceptance.mjs'
import { refreshContext, unpushedContext } from './context.mjs'
import { checkLinks } from './links.mjs'
import { judge } from './lock.mjs'
import { notify as defaultNotify } from './notify.mjs'
import { commitSubject, implementPrompt } from './prompt.mjs'
import { moveAndRecord, QueueRepositoryError } from './queue.mjs'
import { taskBranch } from './task.mjs'
import { withTask } from './workspace.mjs'
import { invoke as defaultInvoke } from './agents.mjs'
import { appendJournal, lastRun, watchJournal } from './journal.mjs'
import { openAttemptLog } from './log.mjs'
import { PRODUCT_FILE } from './product.mjs'

export async function runTask(product, repo, task, { invoke = defaultInvoke, notify = defaultNotify, openLog = openAttemptLog, now = () => new Date() } = {}) {
  const role = repo.models.implement
  if (!role) throw new Error(`${repo.name} has no implementing agent — set models.implement in product.json`)

  const integration = product.branches.integration
  const limit = product.attempts
  const record = {
    kind: 'task',
    task: task.id,
    slug: task.slug,
    repo: repo.name,
    started: now().toISOString(),
    finished: null,
    outcome: null,
    reason: null,
    resumed: false,
    attempts: 0,
    lock: repo.gauge.exit.length > 0 ? 'enforced' : 'absent',
    gauge: { profile: 'exit', failedStage: null },
    models: { implement: { agent: role.agent, requested: role.model ?? null, actual: null } },
    cost: { usd: null, tokens: null },
    branch: taskBranch(product, task),
    acceptance: { verdict: repo.models.accept ? null : 'absent', doubts: [], cost: null },
    // Always present, like acceptance.doubts: a task with no links and a task
    // whose links all resolved are different records, and "nothing to check"
    // must not read as "checked and clean" (ADR 0014).
    links: { checked: 0, broken: [] },
    commit: null,
    merged: false,
  }
  // Why the task stopped last time, for an agent picking it up again.
  const previous = lastRun(product.dir, task.id)

  let ran
  try {
    ran = await withTask(product, repo, task, async ({ cwd, branch, resumed, tracked, setAttempt, parkWith }) => {
      record.resumed = resumed
      const start = tip(cwd, integration)
      const watched = humanRefs(cwd)
      const judges = fingerprints([join(product.dir, PRODUCT_FILE), task.file])
      // The journal is watched differently: other tasks append to it meanwhile.
      judges.journal = watchJournal(product.dir)
      const history = []
      let feedback = null

      const pause = (outcome, reason, gauge) => {
        record.outcome = outcome
        record.reason = reason
        parkWith(
          [
            `wip(${task.slug}): attempt ${record.attempts}, ${gauge && !gauge.green ? `gauge red on ${gauge.failed.stage}` : outcome}`,
            '',
            `Task: ${task.id}`,
            ...(gauge ? [`Gauge: ${formatGauge(gauge)}`] : []),
            `Outcome: ${outcome} — ${reason}`,
            agentTrailer(record),
          ].join('\n'),
        )
      }

      // Build step 5. The merge is staged on a detached HEAD and checked there,
      // so agent/dev only ever moves to a merged tree whose merge gauge is
      // green; red or a conflict leaves it exactly where it was.
      const land = async (subject, exitGauge) => {
        const merging = beginMerge(cwd, integration, branch)
        if (merging.conflicts) {
          record.conflicts = merging.conflicts
          return pause('escalated', `merging into ${integration} conflicts in ${merging.conflicts.join(', ')}`)
        }
        const gauge = await runGauge(repo.gauge.merge, { cwd, profile: 'merge' })
        if (gauge.lock === 'enforced' && !gauge.green) {
          abortMerge(cwd)
          record.gauge = { profile: 'merge', failedStage: gauge.failed.stage }
          return pause('escalated', `the merge gauge is red on ${gauge.failed.stage}`, gauge)
        }
        record.commit = concludeMerge(
          cwd,
          integration,
          start,
          [
            `merge: task ${task.id} — ${subject}`,
            '',
            `Task: ${task.id}`,
            `Gauge: ${formatGauge(exitGauge)} (exit) · ${formatGauge(gauge)} (merge)`,
            agentTrailer(record),
            acceptanceTrailer(record),
          ].join('\n'),
        )
        deleteBranch(cwd, branch)
        record.outcome = 'passed'
        record.merged = true
      }

      // Build step 11. The reviewer runs read-only on the committed branch and
      // may only demote: false means the task stops here, true means nothing
      // was raised and the machine-checked green stands.
      const review = async () => {
        const accept = repo.models.accept
        if (!accept) return true
        record.models.accept = { agent: accept.agent, requested: accept.model ?? null, actual: null }
        record.acceptance.cost = { usd: null, tokens: null }
        const committed = tip(cwd, branch)
        const { diff, truncated } = taskDiff(cwd, start, branch)
        const answer = await invoke(accept, {
          cwd,
          readOnly: true,
          timeoutMs: repo.timeout * 60_000,
          prompt: acceptancePrompt({ task, repo, branch, base: integration, diff, truncated, brokenLinks: record.links.broken }),
        })
        if (answer.model.actual) record.models.accept.actual = answer.model.actual
        addCost(record.acceptance.cost, answer, true)
        addCost(record.cost, answer, false)

        // Read-only is the CLI's promise; it is checked rather than trusted.
        // What a reviewer wrote is not work, so it is discarded, not parked.
        const breach = checkBoundary(cwd, { integration, start, branch, watched, judges, productDir: product.dir })
        const moved = tip(cwd, branch) !== committed
        if (moved) setRef(cwd, branch, committed, 'undo what the acceptance pass committed')
        if (moved || !isClean(cwd) || currentBranch(cwd) !== branch) forceCheckout(cwd, branch)
        if (breach || moved) {
          pause('error', `the acceptance pass changed the repository${breach ? ` — ${breach}` : ''}`)
          return false
        }
        if (!answer.ok) {
          pause('error', `the acceptance pass failed: ${answer.error}`)
          return false
        }

        const { verdict, doubts } = parseVerdict(answer.message)
        record.acceptance.verdict = verdict
        record.acceptance.doubts = doubts
        if (!verdict) {
          // Silence is not the absence of doubt.
          pause('error', 'the acceptance pass gave no verdict detent can read')
          return false
        }
        if (verdict === 'rejected') {
          record.outcome = 'rejected'
          record.reason = `the acceptance pass raised ${doubts.length === 1 ? 'a doubt' : `${doubts.length} doubts`}: ${doubts.join('; ')}`
          snapshotOnto(
            cwd,
            branch,
            [
              `wip(${task.slug}): rejected by the acceptance pass`,
              '',
              `Task: ${task.id}`,
              `Outcome: rejected — the gauge is green and the task is not done`,
              ...doubts.map((doubt) => `Doubt: ${doubt}`),
              agentTrailer(record),
              acceptanceTrailer(record),
            ].join('\n'),
            { allowEmpty: true },
          )
          return false
        }
        return true
      }

      // Before the first turn: the shared context is brought up to date, and
      // the journal records the commit each tracked submodule was at — so the
      // run's record says what the agent read (ADR 0012).
      if (tracked.length > 0) {
        const { commits, problem } = refreshContext(cwd, tracked)
        record.submodules = commits
        if (problem) return pause('escalated', problem)
      }

      // And then the documents the task links to, looked for from the root of
      // this repository — after the refresh, so the question is asked of the
      // revision the agent will actually read (ADR 0014). A broken link is
      // told to the agent, recorded here and shown to the reviewer; it is never
      // a reason to pause, fail or retry, so nothing below branches on it.
      record.links = checkLinks(cwd, task.body)

      for (let attempt = 1; attempt <= limit; attempt += 1) {
        setAttempt(attempt)
        record.attempts = attempt

        // What the agent says, in a file of its own, while it says it (ADR
        // 0021). The journal is unaffected either way: this run's numbers come
        // from the result object below, and nothing reads the log back.
        const log = openLog(product.dir, task.id, attempt)
        let answer
        try {
          answer = await invoke(role, {
            cwd,
            log,
            timeoutMs: repo.timeout * 60_000,
            prompt: implementPrompt({ task, repo, branch, attempt, limit, resumed, feedback, previous: resumed ? previous : null, tracked, brokenLinks: record.links.broken }),
          })
        } finally {
          log.close()
        }
        account(record, answer)

        // The agent has a shell, so the boundary is checked after it, not
        // assumed. agent/dev is detent's to put back; a human ref is not, and
        // is only named.
        const breach = checkBoundary(cwd, { integration, start, branch, watched, judges, productDir: product.dir })
        if (breach) return pause('error', breach)
        if (!answer.ok) return pause('error', `the agent failed: ${answer.error}`)

        const gauge = await runGauge(repo.gauge.exit, { cwd, profile: 'exit' })
        history.push(gauge)
        const verdict = judge(history, { limit })

        if (verdict.verdict === 'leave' || verdict.verdict === 'unlocked') {
          record.gauge.failedStage = null
          // The pointer about to be committed has to be reachable from the
          // submodule's own remote, or the commit would reference nowhere
          // (§13). Not reachable pauses the task and names it; nothing in this
          // run commits a pointer, here or in what is parked on the way out.
          const unpushed = tracked.length > 0 ? unpushedContext(cwd, tracked) : null
          if (unpushed) return pause('escalated', unpushed)
          const subject = commitSubject(answer.message, task)
          const message = [
            subject,
            '',
            `Task: ${task.id}`,
            `Gauge: ${formatGauge(gauge)} (${attempt} ${attempt === 1 ? 'attempt' : 'attempts'})`,
            agentTrailer(record),
          ].join('\n')
          const before = tip(cwd, branch)
          // Always a commit of detent's own, even when the agent committed
          // everything itself: the trailers are git's copy of the journal.
          snapshotOnto(cwd, branch, message, { exclude: repo.neverCommit, allowEmpty: true })
          // A pointer detent moved itself is not the agent's work: a run whose
          // only change is the shared context moving forward changed nothing.
          const changed = git(cwd, ['diff', '--name-only', start, `refs/heads/${branch}`]).split('\n').filter(Boolean)
          if (changed.every((path) => tracked.includes(path))) {
            setRef(cwd, branch, before, 'drop an empty commit')
            return pause('error', 'the gauge is green but the agent changed nothing')
          }
          record.commit = tip(cwd, branch)
          if (!(await review())) return
          return land(subject, gauge)
        }

        record.gauge.failedStage = verdict.stage
        if (verdict.verdict === 'escalate') return pause('escalated', verdict.reason, gauge)
        feedback = verdict.feedback
      }
    })
  } catch (error) {
    // The repository is already back; what is left is to say what happened.
    record.outcome = 'error'
    record.reason = `the run failed: ${error.message.split('\n')[0]}`
  }

  if (ran?.outcome === 'skipped') {
    record.outcome = 'skipped'
    record.reason = ran.reason
    record.branch = null
  }
  record.finished = now().toISOString()
  return settle(product, task, record, notify)
}

// Where the task file goes, who hears about it, and the one journal line every
// run leaves — skipped runs included, so the journal is the whole history.
//
// When the queue is a repository the move is committed and pushed there (ADR
// 0012). A push that fails ends the run, but not before this task's own record
// is complete: the journal line and the person's message are written first and
// the failure is raised after them.
function settle(product, task, record, notify) {
  let ending = null
  const move = (folder) => {
    try {
      moveAndRecord(product, task, folder)
    } catch (error) {
      if (!(error instanceof QueueRepositoryError)) throw error
      ending = error
      ending.record = record
    }
  }

  if (record.outcome === 'passed') {
    move('done')
  } else if (['escalated', 'rejected', 'error'].includes(record.outcome)) {
    move('hold')
    const file = `${product.queue}/hold/${task.id}-${task.slug}.md`
    // A conflict is the one pause a resume cannot get past by itself: detent
    // never resolves one, and the agent is not let into a merge. So the person
    // is told the step that is theirs.
    const next = record.conflicts
      ? `Resolve it on the task branch — git switch ${record.branch} && git merge ${product.branches.integration} — then move ${file} back to todo/.`
      : `The work is on ${record.branch}; move ${file} back to todo/ to resume.`
    const message = `task ${record.task} (${record.repo}) is paused — ${record.outcome}: ${record.reason}. ${next}`
    record.notified = notify(product, { task: record.task, repo: record.repo, outcome: record.outcome, branch: record.branch, message })
  }
  appendJournal(product.dir, record)
  if (ending) throw ending
  return record
}

function account(record, answer) {
  if (answer.model.actual) record.models.implement.actual = answer.model.actual
  addCost(record.cost, answer, record.attempts === 1)
}

// Dollars only if every call reported them: a partial sum would read as a
// total and be smaller than the truth.
function addCost(cost, answer, first) {
  cost.usd = answer.cost.usd === null || (!first && cost.usd === null) ? null : round((cost.usd ?? 0) + answer.cost.usd)
  if (answer.cost.tokens) {
    cost.tokens = {
      input: (cost.tokens?.input ?? 0) + answer.cost.tokens.input,
      output: (cost.tokens?.output ?? 0) + answer.cost.tokens.output,
    }
  }
}

function agentTrailer(record) {
  const { agent, requested, actual } = record.models.implement
  const model = actual ?? requested
  return `Agent: ${agent}${model ? ` (${model})` : ''}`
}

function acceptanceTrailer(record) {
  const accept = record.models.accept
  if (!accept) return 'Acceptance: none declared'
  const model = accept.actual ?? accept.requested
  return `Acceptance: ${accept.agent}${model ? ` (${model})` : ''} — ${record.acceptance.verdict === 'accepted' ? 'no doubts' : record.acceptance.verdict}`
}

// Branches and tags outside the namespace: what an agent with a shell could
// move and detent must never write.
function humanRefs(cwd) {
  const refs = new Map()
  for (const [ref, object] of snapshotRefs(cwd)) {
    if (ref.startsWith('refs/heads/agent/')) continue
    if (ref.startsWith('refs/heads/') || ref.startsWith('refs/tags/')) refs.set(ref, object)
  }
  return refs
}

function checkBoundary(cwd, { integration, start, branch, watched, judges, productDir }) {
  const problems = []

  // The files that judge the agent live outside its repository, within reach
  // of a shell. They are the person's, so a change is named, not undone — and
  // this run goes on using the product it loaded before the agent started.
  const edited = [...judges].filter(([file, hash]) => digest(file) !== hash).map(([file]) => relative(productDir, file))
  if (judges.journal.changed()) edited.push(relative(productDir, judges.journal.file))
  if (edited.length > 0) {
    problems.push(`the agent changed ${edited.join(', ')} — the files that judge it are not its to edit; look at them before resuming`)
    for (const file of judges.keys()) judges.set(file, digest(file))
    judges.journal.reset()
  }

  const now = humanRefs(cwd)
  const moved = [...new Set([...watched.keys(), ...now.keys()])].filter((ref) => watched.get(ref) !== now.get(ref))
  if (moved.length > 0) {
    problems.push(`the agent moved ${moved.join(', ')} — detent does not write outside agent/, so this is left for you`)
    for (const ref of moved) watched.set(ref, now.get(ref))
  }

  const current = tip(cwd, integration)
  if (current !== start) {
    // Failed work never reaches agent/dev: put it back, and keep what the
    // agent put there on a branch of its own.
    const stray = `${branch}-stray`
    setRef(cwd, stray, current, `keep commits the agent made on ${integration}`)
    setRef(cwd, integration, start, `restore ${integration} after the agent moved it`)
    problems.push(`the agent committed to ${integration}; it is restored, and those commits are kept on ${stray}`)
  }

  return problems.length > 0 ? problems.join('; ') : null
}

function fingerprints(files) {
  return new Map(files.map((file) => [file, digest(file)]))
}

function digest(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function round(usd) {
  return Math.round(usd * 1e6) / 1e6
}
