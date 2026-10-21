// What the implementing agent is told. The task body is the spec, written
// before the work, and it is the prompt (DESIGN.md §4); around it go only the
// rules of the territory and, on a retry, what the gauge said or what the
// reviewer doubted.

export function implementPrompt({ task, repo, branch, attempt, limit, resumed, feedback, doubts = [], previous = null, tracked = [], brokenLinks = [] }) {
  const parts = []

  parts.push(
    [
      `You are working on task ${task.id} in the repository "${repo.name}"${repo.role ? ` — ${repo.role}` : ''}.`,
      `The branch ${branch} is checked out in this directory.`,
    ].join('\n'),
  )

  const gauge = repo.gauge.exit
  const rules = [
    'Work only in this directory, on this branch. Do not switch branches, commit, merge, rebase, stash or push: detent commits your work when the gauge is green.',
    gauge.length > 0
      ? `You are done when the gauge is green, not when you say so. The gauge runs these commands in order, and every one must exit 0:\n${gauge.map((s) => `    ${s.stage}: ${s.command}`).join('\n')}\n  Run them yourself before you finish.`
      : 'This repository declares no gauge, so nothing checks your work automatically. Check it yourself against the acceptance criteria.',
  ]
  if (repo.neverCommit.length > 0) {
    rules.push(`Do not change ${repo.neverCommit.map((p) => `"${p}"`).join(', ')}: changes there are never committed and will be lost.`)
  }
  // The shared context (ADR 0012). An agent that finds a submodule it may read
  // and may not write has been told nothing by the sentence above, because
  // that sentence is about the other list. This is the other half.
  if (tracked.length > 0) {
    rules.push(
      `Read ${tracked.map((p) => `"${p}"`).join(', ')} and do not write there: ${tracked.length === 1 ? 'it is' : 'they are'} the shared context, brought up to date before you started, and detent records which revision you read.`,
    )
  }
  rules.push(
    'End your last message with one line describing the change as a conventional commit subject, for example:\n    Commit: feat(wallet): driver wallet balance endpoint',
  )
  parts.push(`Rules:\n${rules.map((r) => `- ${r}`).join('\n')}`)

  parts.push(`---\n\n${task.body.trim()}\n\n---`)

  // A document the task links to that is not in the repository (ADR 0014). The
  // agent is told because it is the only one who can tell whether it needed it.
  // The links that resolved are not mentioned: a check that reports its own
  // success spends a line of the most load-bearing text in the product on
  // nothing, and silence is the normal case.
  if (brokenLinks.length > 0) {
    const one = brokenLinks.length === 1
    parts.push(
      [
        one
          ? 'The task links to a document that is not in this repository:'
          : `The task links to ${brokenLinks.length} documents that are not in this repository:`,
        ...brokenLinks.map((path) => `- ${path}`),
        `${one ? 'It was' : 'They were'} looked for from the root of this repository at the start of this task, once everything mounted here was up to date, so ${one ? 'it is' : 'they are'} not there to read. Decide whether you needed ${one ? 'it' : 'them'}; if you did, say so in your last message rather than guessing what ${one ? 'it said' : 'they said'}.`,
      ].join('\n'),
    )
  }

  if (resumed && attempt === 1) {
    parts.push(
      'This task was paused and is being resumed. Earlier work on it is already on this branch — build on it rather than starting again. Read the task above again: the developer may have changed it.',
    )
    if (previous?.outcome === 'rejected' && previous.acceptance?.doubts?.length) {
      parts.push(
        raisedDoubts(
          'It was paused because a reviewer read the change and doubted the task was done, although the gauge was green.',
          previous.acceptance.doubts,
        ),
      )
    } else if (previous?.reason) {
      parts.push(`It was paused because: ${previous.reason}.`)
    }
  }

  // A doubt inside this run (ADR 0023). The gauge was green, so the sentence
  // the retry below writes would be a lie here — and it is the sentence a
  // reader trusts. What this one has to say instead is that passing the gauge
  // was not the problem: doing the same thing again, more carefully, ends in
  // the same place.
  if (doubts.length > 0) {
    parts.push(
      raisedDoubts(
        `Attempt ${attempt} of ${limit}. Your previous attempt left the gauge green and a reviewer read it and still did not accept the work: it doubted the task was done. Turning the gauge green again is not what is missing — take a different approach rather than repairing the same one.`,
        doubts,
      ),
    )
  }

  if (feedback) {
    parts.push(`Attempt ${attempt} of ${limit}. Your previous attempt did not leave the gauge green.\n\n${feedback}`)
  }

  return `${parts.join('\n\n')}\n`
}

// The reviewer's doubts, handed to the implementer. Two callers want this: a
// task a person moved back from hold/, and the attempt that follows a doubt
// inside a run. What came before differs, so each writes its own first
// sentence; the instruction and the list are the same either way, and getting
// that instruction right is most of what makes a doubt addressable — a doubt
// can be wrong, and an agent told to satisfy every one of them would rewrite
// working code to agree with a mistake.
function raisedDoubts(opening, doubts) {
  return `${opening} Address each doubt; where one is wrong, leave the work as it is and say why in your last message:\n${doubts.map((d) => `- ${d}`).join('\n')}`
}

const SUBJECT = /^[a-z]+(?:\([^()\s]+\))?!?: \S.{0,98}$/

// The agent's own description of its change, if it gave a usable one; detent's
// otherwise. The subject is the only part the agent writes.
export function commitSubject(message, task) {
  const lines = (message ?? '').split('\n').map((line) => line.trim())
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^\**commit:\**\s*`?(.+?)`?$/i.exec(lines[i])
    if (match && SUBJECT.test(match[1])) return match[1]
  }
  return `feat: task ${task.id}, ${task.slug.replaceAll('-', ' ')}`
}
