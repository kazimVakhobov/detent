// Whether a product is in the shape detent expects (DESIGN.md §3, §12): the
// nine conditions and the checks beyond them, from the same scan init uses.
// Every finding says what to change. Nothing is changed here — the product
// is not bent into shape by detent, it is told what does not match.

import { join } from 'node:path'
import { operationInProgress, remoteBranchesContaining, submoduleCheckedOut, submoduleCommit } from './git.mjs'
import { AGENT_NAMES, PRODUCT_FILE, queueOf, readConfig, validateProduct } from './product.mjs'
import { PLAIN, publishing } from './queue.mjs'
import { FOLDERS, missingQueue } from './task.mjs'

export const OK = 'ok'
export const FAIL = 'fail'
export const LOOK = 'look'
export const INFO = 'info'

// A finding about the queue rather than about the product's repositories. It is
// doctor's to report and `failures` leaves it there: a run reads the queue
// itself and says what it finds, and a queue that cannot be published is not a
// reason to refuse one.
const QUEUE_FINDING = 'queue'

// `repos`, when it is given, is the repositories to report on — every other
// one in `product.json` is left out of the report rather than judged. Nothing
// about a check changes; what changes is who is asked, which is what `failures`
// below needs and what a whole report never wants.
export function diagnose(dir, scan, { repos: only = null } = {}) {
  const product = []
  const repos = {}
  const say = (list, status, condition, text, fix, more = {}) => list.push({ status, condition, text, ...(fix ? { fix } : {}), ...more })

  // 9 — the machine
  const major = Number(scan.node.split('.')[0])
  const platformOk = scan.platform === 'darwin' || scan.platform === 'linux'
  say(product, platformOk && major >= 22 ? OK : FAIL, 9, `${scan.platform}, Node ${scan.node}`, platformOk ? (major >= 22 ? null : 'install Node 22 or newer') : 'detent runs on macOS or Linux')

  // The file everything else is read from, read before it is judged: where the
  // queue is is one of the things it says (ADR 0012), and the queue is looked
  // for whether the rest of the file is usable or not.
  const { raw, error, found } = readConfig(dir)
  const queue = queueOf(raw)

  // The queue (§11): a product with nowhere to put a task is not ready,
  // whatever the rest of the report says. Checked from the folder alone, and
  // never created here — doctor writes nothing. A `queue` that is not a usable
  // path has no folders to look for; that is a problem about the file, and the
  // check below names it.
  const missing = queue === null ? [] : missingQueue(dir, queue)
  if (missing.length) {
    say(
      product,
      FAIL,
      null,
      `${missing.map((f) => `${queue}/${f}`).join(', ')} ${missing.length === 1 ? 'does' : 'do'} not exist — run has no queue to read and plan nowhere to write`,
      `detent init --product ${dir}`,
      { about: QUEUE_FINDING },
    )
  } else if (queue !== null) {
    say(product, OK, null, `the queue is there: ${queue}/{${FOLDERS.join(',')}}`, null, { about: QUEUE_FINDING })
  }

  // Whether the queue can be published, which is the whole of what configuring
  // one was for (ADR 0012): the four folders existing is not the same as a
  // queue the next machine reads. A product that asked for a shared queue and
  // has a local one is not in the shape its own product.json describes, so the
  // first of the two is a failure — nothing a run does fixes it, and the run
  // that believed it published says nothing. The second is not wrong at all: a
  // queue nobody can fetch has no next machine to be stale for, and the person
  // is told which of the two they have. A queue at the default location says
  // nothing, as it never did.
  const publish = publishing(dir, queue)
  if (publish) say(product, publish.kind === PLAIN ? FAIL : LOOK, null, publish.text, null, { about: QUEUE_FINDING })

  if (!found) {
    if (error) say(product, FAIL, null, `${PRODUCT_FILE} cannot be read: ${error.message}`)
    else say(product, FAIL, null, `no ${PRODUCT_FILE}`, `detent init --product ${dir}`)
    return { product, repos, loaded: false }
  }
  if (error) {
    say(product, FAIL, null, `${PRODUCT_FILE} is not valid JSON: ${error.message}`)
    return { product, repos, loaded: false }
  }
  const { product: config, problems } = validateProduct(raw, dir)
  if (!config) {
    for (const problem of problems) say(product, FAIL, null, `${PRODUCT_FILE}: ${problem}`)
    return { product, repos, loaded: false }
  }
  say(product, OK, null, `${PRODUCT_FILE} is valid — every branch in it is under agent/`)

  // Who is asked. Everything below reads this rather than the file's whole
  // list, so a narrowed report is the same checks over fewer repositories —
  // including the ones that read as being about the product, since what they
  // are really about is what these repositories declare.
  const asked = only ? config.repos.filter((repo) => only.includes(repo.name)) : config.repos

  // 6 — an agent CLI installed (and authenticated, which only a call can show)
  const roles = new Map()
  for (const repo of asked) {
    for (const [role, value] of Object.entries(repo.models)) roles.set(`${role}:${value.agent}`, { role, agent: value.agent })
  }
  if (![...roles.values()].some((r) => r.role === 'implement')) {
    say(product, FAIL, 6, 'no implementing agent — models.implement is not set', `set models.implement to { "agent": ${AGENT_NAMES.map((a) => `"${a}"`).join(' | ')} }`)
  }
  for (const { role, agent } of roles.values()) {
    const installed = scan.agents.includes(agent)
    say(product, installed ? OK : FAIL, 6, `${agent} ${installed ? 'is installed' : 'is not on PATH'} (${role}) — whether it is signed in shows only when it runs`, installed ? null : `install ${agent} and sign in`)
  }
  for (const repo of asked) {
    if (repo.models.implement && !repo.models.accept) {
      say(product, LOOK, null, `${repo.name} has no acceptance pass — a green gauge will land without a second model reading the diff`, 'set models.accept to a different model')
    }
  }

  // 8 — one person per workspace: a convention, not a fact a scan can see
  say(product, INFO, 8, 'one person per workspace — detent cannot check this; it assumes it')

  // 2 — the repositories side by side in one folder
  const declared = new Set(config.repos.map((r) => r.path))
  for (const name of scan.repos.map((r) => r.name).filter((n) => !declared.has(n))) {
    say(product, LOOK, 2, `${name} is a repository in this folder and not in ${PRODUCT_FILE}`, `detent init --product ${dir} proposes it`)
  }

  for (const repo of asked) {
    const checks = (repos[repo.name] = [])
    const found = scan.repos.find((r) => r.path === repo.path)
    if (!found) {
      say(checks, FAIL, 2, `${repo.path} is not a git repository directly in the product folder`)
      continue
    }

    // 1 — git, not a shallow clone
    say(checks, found.shallow ? FAIL : OK, 1, found.shallow ? 'a shallow clone — history detent merges against is missing' : 'a full clone', found.shallow ? `git -C ${repo.dir} fetch --unshallow` : null)

    // The namespace (§2, §12)
    if (found.branches.includes('agent')) {
      say(checks, FAIL, null, 'a branch named exactly "agent" makes refs/heads/agent/ impossible to create', `git -C ${repo.dir} branch -m agent <another name>`)
    }
    const integration = config.branches.integration
    const staging = config.branches.staging
    if (repo.gauge.promote.length && !staging) {
      // A declared check that nothing ever runs is the same invented green as
      // a missing gauge (§6, §12).
      say(checks, FAIL, null, 'gauge.promote is declared but there is no branches.staging — nothing would ever run it', 'declare branches.staging, or remove gauge.promote')
    }
    if (staging && !found.branches.includes(staging)) {
      say(checks, FAIL, null, `${staging} does not exist — detent never creates it`, `git -C ${repo.dir} branch ${staging} ${integration}`)
    } else if (staging) {
      say(checks, repo.gauge.promote.length ? OK : LOOK, null, repo.gauge.promote.length ? `${staging} exists, promote: ${repo.gauge.promote.map((s) => s.stage).join(', ')}` : `${staging} exists but declares no promote stages — a promotion would check nothing the tasks did not`)
    }
    if (found.branches.includes(integration)) say(checks, OK, null, `${integration} exists`)
    else {
      // Creating it means naming a start point, and the start point is a
      // human branch: the command is printed, and that is as far as it goes.
      say(checks, FAIL, null, `${integration} does not exist — detent never creates it, because its start point is your branch`, `git -C ${repo.dir} branch ${integration} ${repo.compare}`)
    }

    // 3 — one human branch to be compared against
    say(checks, found.branches.includes(repo.compare) ? OK : LOOK, 3, found.branches.includes(repo.compare) ? `reported against ${repo.compare}` : `compare branch ${repo.compare} does not exist here`, found.branches.includes(repo.compare) ? null : 'set compare to a branch that exists')

    // 4 — the gauge, declared as stages
    if (repo.gauge.exit.length) say(checks, OK, 4, `gauge: ${repo.gauge.exit.map((s) => s.stage).join(', ')}${repo.gauge.merge.length ? `; merge: ${repo.gauge.merge.map((s) => s.stage).join(', ')}` : ''}`)
    else say(checks, LOOK, 4, 'no exit stages — no lock: the agent may stop whenever it likes, and the summary shows a dash', `declare gauge.exit stages, then try them with detent gauge ${repo.name}`)

    // 5 — a clean tree
    const operation = operationInProgress(repo.dir)
    if (operation) say(checks, FAIL, 5, `a ${operation} is in progress — a run skips this repository`, `finish or abort the ${operation}`)
    else say(checks, found.clean ? OK : FAIL, 5, found.clean ? 'clean tree' : 'the working tree is not clean — a run skips this repository', found.clean ? null : 'commit or discard your changes; detent never stashes them')

    // 7 — the integration branch is not deployed; pushing is by hand
    const remote = found.upstreams[integration]
    if (!found.branches.includes(integration)) {
      // Nothing to say about a branch that is not there yet.
    } else if (remote) say(checks, LOOK, 7, `${integration} tracks ${remote} — detent never pushes it, so make sure nothing deploys from it`)
    else say(checks, OK, 7, `${integration} tracks no remote`)

    // The shared context (§13, ADR 0012). One list read two ways: a submodule
    // in neverCommit is the one detent never touches, and has nothing to
    // report that it did not have before; one outside it is tracked, which is
    // a configuration rather than an oversight. What can go wrong with a
    // tracked one is what the run checks before the commit, so doctor asks the
    // same question — a submodule nobody else can see would pause a task.
    for (const path of found.submodules.map((s) => s.path).filter((p) => !repo.neverCommit.includes(p))) {
      const verified = !submoduleCheckedOut(repo.dir, path) || remoteBranchesContaining(repo.dir, path).length > 0
      if (verified) say(checks, OK, null, `submodule ${path} is tracked — detent brings it to its remote's tip, and its pointer is committed with the task once that commit is verified to be on a remote branch`)
      else say(checks, FAIL, null, `submodule ${path} is at ${submoduleCommit(repo.dir, path).slice(0, 7)}, which is in none of its remote branches — it has unpushed commits, and a run would pause on it rather than commit a pointer to nowhere`, `git -C ${join(repo.dir, path)} push`)
    }
  }

  return { product, repos, loaded: true }
}

export function failed(report) {
  return [report.product, ...Object.values(report.repos)].flat().filter((c) => c.status === FAIL).length
}

// What doctor calls a failure in `names`, each with the repository it is about
// (null for one about the product), and nothing else.
//
// This is what `run` asks before it creates a branch (§12). Not a second
// opinion before every run: a failure is by definition what would stop a run or
// make it skip a repository, so every one of these is something the run was
// going to hit anyway — an agent that is not installed, a tree somebody left
// dirty — and hitting it after the task branch exists and the workspace has
// been taken is the same answer, later and dearer. What doctor calls worth a
// look is left out, because a run going ahead with less than it could have is a
// run going ahead; so is the queue's own report, which doctor gives and a run
// does not need. And a repository no queued task mentions is never asked, since
// a run would not have touched it.
export function failures(dir, scan, names) {
  const report = diagnose(dir, scan, { repos: names })
  return [
    ...report.product.filter((check) => check.about !== QUEUE_FINDING).map((check) => ({ ...check, repo: null })),
    ...Object.entries(report.repos).flatMap(([repo, checks]) => checks.map((check) => ({ ...check, repo }))),
  ].filter((check) => check.status === FAIL)
}
