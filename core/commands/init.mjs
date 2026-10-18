// detent init — scan the product folder and write product.json (DESIGN.md §12):
// the deterministic scan, two questions for what the scan cannot work out, a
// model pass for what it cannot see, and a check of the model's answer against
// the scan. Re-running it proposes a diff rather than overwriting what a
// person wrote.
//
// This is the one command that asks anything itself (ADR 0014). Everything
// about how it behaves when there is nobody to answer is in core/ask.mjs; what
// is here is the two questions, the flags that answer them, and the lines that
// say which answer was taken.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { ask as defaultAsk, askDocs, askQueue, NONE } from '../ask.mjs'
import { ConfigError, PRODUCT_FILE, productPath, queueOf, readConfig, validateProduct } from '../product.mjs'
import { diffLines, hunks, mergeProposal, proposeProduct } from '../propose.mjs'
import { invoke as defaultInvoke } from '../agents.mjs'
import { modelPass } from '../model-pass.mjs'
import { publishing } from '../queue.mjs'
import { scanProduct } from '../scan.mjs'
import { createQueue, QUEUE } from '../task.mjs'
import { UsageError } from './usage.mjs'

export const options = {
  'no-agent': { type: 'boolean', default: false },
  // The two questions, answerable without a terminal. No default: a flag that
  // was not given has to be told apart from one that was, since a flag is an
  // answer and silence is a question.
  queue: { type: 'string' },
  docs: { type: 'string' },
}
export const needsProduct = false

export const PROPOSED_FILE = join('.detent', 'product.proposed.json')

export async function run(dir, _positionals = [], values = {}, { invoke = defaultInvoke, ask = defaultAsk } = {}) {
  const root = resolve(dir)
  if (!existsSync(root)) throw new UsageError(`${root} does not exist`)

  const file = join(root, PRODUCT_FILE)
  // Read before anything is scanned or created, because where the queue goes
  // is one of the things it says (`queue`, ADR 0012). A file a person edited
  // by hand is expected input, so a comma in the wrong place is a message and
  // never a stack trace. `loadProduct` has always said this; init read the
  // same file and did not.
  const { raw: existing, error, found: exists } = readConfig(root)
  if (error) {
    if (!exists) throw error
    throw new ConfigError(file, [`is not valid JSON: ${error.message}`, 'fix it, or move it aside and let init write a new one'])
  }
  // --queue is a path like the one in the file, so it is held to the file's
  // rule, and here rather than there: a flag is wrong on the command line, and
  // the answer is a usage message, not a product that fails validation.
  if (values.queue !== undefined) {
    const { problem } = productPath(values.queue)
    if (problem) throw new UsageError(`--queue ${problem}`)
  }

  // A `queue` that is not usable is refused by the validation below rather
  // than acted on: nothing is created at a path the product cannot have.
  const queue = queueOf(existing)

  let scan = scanProduct(root, { queue: queue ?? QUEUE })
  if (scan.repos.length === 0) {
    process.stderr.write(`detent init: no git repository directly inside ${root} — a product is a folder of repositories side by side\n`)
    return 1
  }

  // The two questions (ADR 0014): after the scan, because they offer what it
  // found, and before anything is written, because the answers are two of the
  // things written. Each is announced the moment it is settled — by a flag, by
  // an answer, or by a default taken because nobody was there to ask.
  const say = (note) => process.stdout.write(`  ${note}\n`)

  // Nobody is nobody for both questions: an asker that says there is no one
  // there is not called again, so the second question is never printed to an
  // empty room and never asked of an input that has nothing left to give.
  let nobody = false
  const asker = async (text) => {
    if (nobody) return null
    const answer = await ask(text)
    if (answer === null) nobody = true
    return answer
  }

  let queuePath = queue
  let queueAnswer = existing?.queue
  if (queueAnswer !== undefined && values.queue === undefined) {
    // Already answered. A file is asked once, and the answer is the file's.
    say(`the queue: ${queueAnswer} — ${PRODUCT_FILE} already says so, so you were not asked`)
  } else {
    const answer = await askQueue({ ask: asker, repos: scan.repos.map((repo) => repo.name), flag: values.queue })
    queuePath = answer.value
    queueAnswer = answer.value
    say(answer.note)
  }

  // The scan skips the queue's own folder, because that folder is never a
  // repository of the product whatever it is called (ADR 0012) — and the scan
  // ran before the question, against the folder the file named. An answer that
  // moved the queue is read again: into a repository, and that repository is
  // the queue; out of one, and there is a repository nothing has looked at yet.
  const holder = (queuePath ?? QUEUE).split('/')[0]
  if (holder !== (queue ?? QUEUE).split('/')[0]) {
    scan = scanProduct(root, { queue: queuePath ?? QUEUE })
    if (scan.repos.length === 0) {
      process.stderr.write(`detent init: the queue went into ${holder}, the only repository in ${root} — a product needs one that is not the queue\n`)
      return 1
    }
  }

  const names = scan.repos.map((repo) => repo.name)
  if (values.docs !== undefined && values.docs !== NONE && !names.includes(values.docs)) {
    throw new UsageError(`--docs ${values.docs}: no repository called that here — ${names.join(', ')}, or ${NONE}`)
  }

  let docs = existing?.docs
  if (docs !== undefined && values.docs === undefined) {
    say(`the documents: ${docs ?? NONE} — ${PRODUCT_FILE} already says so, so you were not asked`)
  } else {
    const answer = await askDocs({ ask: asker, repos: names, flag: values.docs })
    docs = answer.value
    say(answer.note)
  }

  // The queue, before any model is asked: a product declared ready with
  // nowhere to put a task is the on-ramp broken. Deterministic, so --no-agent
  // creates it too, and at the answered path.
  const created = queuePath === null ? [] : createQueue(root, queuePath)
  if (created.length) {
    process.stdout.write(`created ${created.map((f) => `${queuePath}/${f}`).join(', ')} — the queue run reads and plan writes into\n`)
  }

  // What creating those folders did not create (ADR 0012). A queue somewhere
  // other than the default was configured so that two machines could share it,
  // and four folders in a plain directory are not that: the sentence that says
  // the queue was created has to say what it is, or the first thing that tells
  // anybody is a run that published nothing. Said whether or not the folders
  // were created a moment ago, because it is true either way — and said, not
  // acted on: init clones nothing, creates no repository and adds no remote.
  const publish = publishing(root, queuePath)
  if (publish) process.stdout.write(`${publish.text}\n`)

  // Pass 1, the scan; then passes 2 and 3 unless asked not to, or unless there
  // is no agent to ask — the tool has to work for someone without one.
  let pass = proposeProduct(scan, { queue: queueAnswer, docs })
  const role = existing?.models?.implement ?? pass.models?.implement
  const passNotes = []
  if (values['no-agent']) {
    passNotes.push('--no-agent: the scan only — roles and relations are left for you to fill')
  } else if (!role) {
    passNotes.push('no agent CLI to ask: the scan only — roles and relations are left for you to fill')
  } else {
    process.stdout.write(`scanned ${scan.repos.length} ${scan.repos.length === 1 ? 'repository' : 'repositories'}; asking ${role.agent} what the scan cannot see…\n`)
    const { proposal: enriched, report } = await modelPass(scan, pass, { invoke, role })
    pass = enriched
    if (report.error) passNotes.push(`the model pass gave nothing usable (${report.error}) — the scan alone was written`)
    for (const item of report.fromModel) passNotes.push(`from the model: ${item}`)
    for (const item of report.dropped) passNotes.push(`dropped, not written: ${item}`)
    const cost = report.cost.usd !== null ? `$${report.cost.usd.toFixed(2)}` : report.cost.tokens ? `${report.cost.tokens.input + report.cost.tokens.output} tokens` : null
    if (!report.error) passNotes.push(`model pass: ${role.agent}, ${report.attempts} ${report.attempts === 1 ? 'attempt' : 'attempts'}${cost ? `, ${cost}` : ''}`)
  }
  const proposal = existing ? mergeProposal(existing, pass) : pass
  // The two answers are the authority for their own keys, which is the one
  // place the merge's "what a person wrote wins" does not hold: a flag is an
  // answer and not a suggestion. Nothing a person wrote is overwritten by it —
  // a file that exists is proposed a diff, as always. Without a flag the
  // answer is what the file already said, and these two lines change nothing.
  proposal.queue = queueAnswer
  proposal.docs = docs ?? null
  const text = `${JSON.stringify(proposal, null, 2)}\n`

  const { problems } = validateProduct(proposal, root)

  if (!exists) {
    mkdirSync(join(root, '.detent'), { recursive: true })
    writeFileSync(file, text)
    process.stdout.write(`wrote ${PRODUCT_FILE} — ${scan.repos.length} ${scan.repos.length === 1 ? 'repository' : 'repositories'}: ${scan.repos.map((r) => r.name).join(', ')}\n`)
  } else {
    const before = `${JSON.stringify(existing, null, 2)}\n`
    // Nothing to propose is not nothing to report: the model pass may have
    // failed, the gauge may be empty, and returning here used to swallow both
    // behind a sentence that reads like success.
    if (before === text) {
      process.stdout.write(`${PRODUCT_FILE} already says everything the scan found\n`)
    } else {
      writeFileSync(join(root, PROPOSED_FILE), text)
      process.stdout.write(`${PRODUCT_FILE} exists, so nothing was overwritten. The scan proposes:\n\n`)
      process.stdout.write(`${hunks(diffLines(before.trimEnd(), text.trimEnd())).join('\n')}\n\n`)
      process.stdout.write(`The whole proposal is in ${PROPOSED_FILE}; move it over ${PRODUCT_FILE} to accept it.\n`)
    }
  }

  const notes = [...passNotes]
  if (!proposal.models?.implement) notes.push('no agent CLI found on PATH — set models.implement by hand (claude, codex or gemini)')
  // What is installed comes from the scan, never from what the file declares:
  // a product.json naming an agent nobody has would otherwise be reported as
  // that agent being the only one installed.
  else if (!proposal.models?.accept) {
    notes.push(scan.agents.length === 1
      ? `only ${scan.agents[0]} is installed — set models.accept to a different model, or there is no acceptance pass`
      : 'models.accept is not set — without it there is no acceptance pass')
  }
  for (const repo of proposal.repos) {
    if (!repo.gauge?.exit?.length) notes.push(`${repo.name}: no gauge stages — without them it has no lock`)
  }
  notes.push('read the gauge stages before an agent is held to them: detent gauge')
  process.stdout.write(`${notes.map((n) => `  ${n}`).join('\n')}\n`)
  return problems.length ? report(problems) : 0
}

function report(problems) {
  process.stdout.write(`\nthe file is not usable yet:\n${problems.map((p) => `  ${p}`).join('\n')}\n`)
  return 1
}
