# 0023. A doubt is an attempt, and every round is recorded

- **Date:** 2026-10-21
- **Status:** accepted — narrows 0009

## Context

`attempts` was a budget for the gauge and for nothing else. A task whose gauge
went red was handed the failure and asked again, up to `attempts` times
([0009](0009-three-attempts-then-pause.md)). A task whose gauge went **green**
and was then doubted by the acceptance pass was paused on the spot, after one
attempt, and waited for a person — even though the agent could have addressed
the doubt and the budget was untouched.

The asymmetry was one line. `review()` was a boolean: `true` merged, `false`
returned out of the run and the task moved to `hold/`. A red gauge in the same
position set `feedback` and went round again.

The feedback a doubted agent needs was already written: the prompt had a block
that hands the reviewer's doubts over with the right instruction — address each
one, or leave the work and say why it is wrong. It was reachable only when a
person moved the file back from `hold/`, so it fired between runs and never
inside one.

The second half is the record. A run carried one `attempts` count, one
`gauge.failedStage` and one `acceptance`. Once a single run can be red on the
gauge, then green-and-doubted, then green-and-doubted again, those three fields
describe only the last of three stories — and the difference matters more than
the feature does. The same doubt raised three times means the task's criteria
are wrong and no number of attempts will fix it; a different doubt each time
means the reviewer is wandering. 0009 kept exactly this distinction for the
gauge — identity of failures "is still computed and recorded" — and the
acceptance pass had nothing of the kind.

## Decision

- **One budget, spent on both.** A doubt costs an attempt exactly as a red
  gauge does. A doubt before the last attempt sets the next attempt's feedback
  from the doubts and the loop goes round; a doubt **on the last attempt**
  pauses the task as `rejected`, unchanged from before — the same reason
  counting the doubts, the empty commit carrying each one as a `Doubt:`
  trailer, the move to `hold/`, the notification. There is no second counter:
  `attempts` is still the answer to "how much is this task allowed to cost
  before a person looks".
- **This narrows 0009, and only there.** 0009 says `escalated`, `rejected` and
  `error` move the task file to `tasks/hold/`. `rejected` now does so **only
  once the budget is gone.** `escalated` and `error` are untouched.
- **ADR 0004 survives, and this is why.** The reviewer still may not approve.
  A round ends in a merge because the gauge was green and no doubt was raised,
  never because a model said yes. What changes is how many times the reviewer
  gets to speak before a person is called, not who grants green. The loop is:
  the machine checks pass, the reviewer raises a doubt, the agent addresses it,
  the machine checks pass again, the reviewer raises nothing. The obvious
  reading of 0004 — "send the task to a person" — is the line this narrows, and
  the demotion it describes is still the only thing a model's judgement can do.
- **`review()` answers with one of three outcomes, each with a name:** merge,
  doubts, stop. `stop` is the acceptance pass going wrong rather than the work
  — a breach, a pass that wrote, a pass that failed, a verdict detent cannot
  read — and it pauses the task without spending an attempt. A boolean carried
  two of those and smuggled the third in as a second meaning for `false`.
- **These still pause immediately, with no retry:** a merge conflict, a
  boundary breach, a verdict detent cannot read, the agent failing, and the
  gauge green with nothing changed. detent does not resolve conflicts and the
  agent is not let into a merge, so a budget spent on either would be a budget
  spent on nothing it can change.
- **The journal's task line gains `rounds`:** one entry per attempt, each
  carrying that attempt's gauge result and failed stage, its acceptance verdict
  and doubts if it reached the acceptance pass, and what that attempt cost. A
  round that never reached the acceptance pass has `null` there, which is not
  the same fact as a pass that raised nothing.
- **`attempts`, `gauge` and `acceptance` stay as they are, holding the last
  round.** The journal is appended and never rewritten, so no line already
  written has `rounds`: `summary`, the demotion rate and the dashboard go on
  reading the flat fields, and a line that has none is a run of one round — the
  shape the task detail already drew, drawn by the same lines in the same
  places, so the runs already in a journal look exactly as they did.
- **`summary` reports what the retry has to earn:** of the runs that passed,
  how many were accepted on a round after the first, having been doubted on an
  earlier one. If that stays near zero the retry is not worth what it costs,
  and the journal can say so without anyone reading lines by hand.

## Consequences

- A task the reviewer doubts can now land without a person, which is the point.
  A task the reviewer keeps doubting costs up to `attempts` implementations and
  `attempts` reviews before it pauses — the ceiling is higher than it was, and
  it is still a ceiling.
- The most expensive run is now "red, red, green and doubted" and the budget is
  gone with nothing accepted. That is the same bill 0009 already allowed, paid
  for a different mix of failures.
- The task branch grows a commit per rejected round rather than one at the end.
  That is the record: `git log` on the branch says what the reviewer said each
  time, and a doubt repeated three times is visible without opening the journal.
- Two fields now say the same thing in a journal line — `acceptance` and the
  last entry of `rounds`. The duplication is what keeps every line already
  written readable, and it is written down here so it does not read as an
  oversight later.
- `judge()` is unchanged: it decides on gauge history, a green gauge returns
  `leave`, and the acceptance budget is enforced by the loop that already knows
  the attempt number and the limit.

## Alternatives rejected

**A separate `acceptanceAttempts` budget.** Two numbers to configure for one
question, which is the argument 0009 already made against a second ceiling for
the gauge. One counter is simpler, and `rounds` will say whether a second is
needed: a journal full of runs that spent the whole budget on doubts and landed
nothing is the evidence that would re-open this, and nothing short of it is.

**Retry a doubt without recording the rounds.** The cheaper half of this change
and the one worth less. A run that can be doubted twice and still pass needs to
be able to say *what was doubted each time*, or the journal has stopped being
the record of what happened and become a record of how it ended.

**Let the reviewer approve once it has been satisfied.** The thing 0004 exists
to refuse. A reviewer that can end a round with a yes makes "proven" mean "a
second model agreed", and every number built on the journal would measure
agreement between models instead of behaviour of code.

**Pause on the first doubt and let the person resume.** What it did before. It
works — the prompt already hands the doubts over on a resume — but it spends a
person on something the agent can do, and it reports `rejected` for a task that
one more attempt would have landed. The number that justified this is now in
`summary`; if it comes out near zero, this was the wrong call and that is how
it will be known.
