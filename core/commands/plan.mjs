// detent plan — discuss a task with an agent; it writes the task files.

import process from 'node:process'
import { AGENTS } from '../agents.mjs'
import { INTERACTIVE, after, before, nextIds, openAgent, planPrompt } from '../plan.mjs'
import { UsageError } from './usage.mjs'

export const options = { agent: { type: 'string' } }

export async function run(product, words, values, { spawnAgent = openAgent } = {}) {
  // The agents are listed from the table rather than written out here, so the
  // one place a row is added stays the one place (ADR 0018).
  const offered = Object.keys(AGENTS)
  const role = values.agent ? { agent: values.agent } : product.models.implement
  if (!role) throw new UsageError(`no agent to plan with — set models.implement in product.json, or pass --agent ${offered.join('|')}`)
  if (!Object.hasOwn(AGENTS, role.agent)) {
    throw new UsageError(`"${role.agent}" is not an agent this version offers — it offers ${offered.join(', ')}; another is added once it has run a real task (ADR 0018)`)
  }

  const was = before(product)
  const prompt = planPrompt(product, { next: nextIds(product), brief: words.join(' ').trim() || null })
  const [command, args] = INTERACTIVE[role.agent]({ model: values.agent ? null : role.model, prompt })

  const code = await spawnAgent(command, args, product.dir)
  if (code === null) {
    process.stderr.write(`detent plan: ${command} is not installed, or not on PATH\n`)
    return 1
  }

  // The conversation is over; now what it left behind is checked, before
  // anything can run it.
  const result = after(product, was)
  const out = []
  if (result.added.length === 0 && result.changed.length === 0) out.push('no task was written')
  for (const file of result.added) out.push(`new      ${file}`)
  for (const file of result.changed) out.push(`changed  ${file}`)
  if (result.problems.length) {
    out.push('', 'the queue would not run — fix these before detent run:', ...result.problems.map((p) => `  ${p}`))
  } else if (result.added.length || result.changed.length) {
    out.push('', `the queue is valid: ${result.queued.length} ${result.queued.length === 1 ? 'task' : 'tasks'} in todo/ — read them, then detent run`)
  }
  if (result.breaches.length) {
    out.push('', 'plan writes only task files, and these changed as well — look at them:', ...result.breaches.map((b) => `  ${b}`))
  }
  process.stdout.write(`${out.join('\n')}\n`)
  return result.problems.length || result.breaches.length ? 1 : 0
}
