# 0024. A barrier bars until it passes, and a resume is a decision rather than a move

- **Date:** 2026-10-22
- **Status:** accepted — narrows 0009

## Context

Two things, one place. Both are about `hold/`, and `run` read neither.

**The barrier.** `core/scheduler.mjs` holds the rule: a barrier runs alone and
nothing starts past it, because "a task queued behind a contract change must not
begin against the contract that change is about to replace" (§8). A barrier that
does not pass ends the run there and everything behind it stays in `todo/`. All
of that is true **of the list it was handed**, and `run` handed it `todo/` alone.
So:

```
$ detent run
0003  logist-api  who-may-act-on-whom  (barrier — runs alone)
0003  paused (rejected): …
stopped at barrier 0003: … 0004 … 0010 were queued behind a contract it did not
replace — not started

$ detent run
0004  logist-api  admin-action-journal  …
```

0003 moved to `hold/`. The second invocation saw no barrier in `todo/` and
started 0004 against exactly the contract the first had refused to start it
against. One run enforced the rule and the next did not know it existed. The
rule is about the queue, not about one process.

**The refusal.** `run` filtered to `todo/` before resolving names, so by the
time a number was looked up, a task in `hold/` could not be told from a number
nobody had ever used: `detent run: not in …/todo/: 0003`. Everything needed to
do better was already in hand — `readQueue` reads all four folders and puts the
folder on every task, and the journal's last line says why a run stopped.

**And then the question worth asking.** A paused task is resumed by moving its
file back to `todo/` ([0009](0009-three-attempts-then-pause.md)). The gesture is
a person's on purpose: it is their acknowledgement that they read why it
stopped. But the `mv` is not the acknowledgement — the decision is, and detent
can carry the file once the decision is made. The third answer matters as much
as the other two: a task that was rejected is very often a task whose criteria
were wrong, and what it needs is not another run but an edit.

## Decision

- **A paused barrier bars.** Before any task starts, `run` reads `hold/`. A
  paused task with `touches_contract: true` bars every task in `todo/` with a
  higher number, **in any repository** — the scheduler's second rule, applied
  to the queue the run inherits rather than only to the list it is handed.
  What is barred does not start, and the run names the barrier and says why.
- **The barring is not part of any question.** It is a correctness rule, so it
  holds with a terminal and without one: a run in a script, a pipeline or a
  cron line enforces it and reports it exactly as an interactive one does. A
  question only changes what a person can do about it.
- **A paused task that is not a barrier bars nothing.** It is named in one
  line and the queue runs. Only a contract change is a reason to hold other
  work; ids and `touches_contract` remain the only ordering detent knows (§8),
  and nothing here infers a dependency from anything else.
- **`detent run --past <id>` runs past a paused barrier,** for the person who
  knows the contract landed another way. It names the barrier it overrides
  rather than being a bare yes, a number that is not a paused barrier is a
  usage error, and what it did is on the screen: a run that went past a
  barrier is not an ordinary run and must not read like one.
- **A name outside `todo/` is reported by where it is,** one sentence per
  folder: `hold/` says it paused, with the outcome and the reason from its last
  journal line; `done/` says it already passed, with the commit; `failed/` says
  that folder is the person's and detent never moves a task there. A number in
  none of the four keeps the old sentence — it is the only one of the four that
  means "you typed a number that does not exist".
- **The question, when there is a terminal to ask it on.** `detent run <id>`
  naming a paused task, and a bare `detent run` that found anything in `hold/`,
  offer three answers per task in id order: leave it, resume it now, or open
  `plan` to change it first. **The default is to leave it** — a bare Enter must
  never start a run that costs money. The question is asked through
  `core/ask.mjs`, so the rule that arrived with `init`'s two questions holds
  here whole ([0014](0014-init-asks-where-the-queue-and-the-documents-are.md)):
  a question nobody is there to answer is not asked, the default is taken, and
  the default is announced. Leaving a barrier paused leaves it barring, and the
  run says so rather than quietly doing less than it was asked to.
- **A resume moves the file through `moveAndRecord`,** never a bare rename. A
  queue that is a repository of its own gets the commit and the push every
  other move gets, and a resume that cannot be published ends the run the same
  way those do
  ([0012](0012-the-queue-and-the-shared-context-may-be-repositories.md)). What
  follows is what follows a hand-moved file and nothing else: the branch is
  there, `resumed` is true, and the doubts reach the implementer.
- **`plan` is opened with the task in hand.** The pre-prompt says which file is
  being amended and where, carries the outcome and the doubts the last run
  recorded, and says the job is to change that one file in place — not to write
  a new task, not to write code. The file stays in `hold/` while it is edited: a
  task whose criteria are being rewritten is not ready to run. **Afterwards the
  run stops** and says what to type next. It does not chain into a run: the
  person has just finished a conversation and has not read what came out of it,
  and starting an unattended agent on the strength of that is the one thing this
  command is careful about everywhere else.
- **And what that conversation left is checked, not assumed.** `plan` already
  wraps its own session in a before-and-after and names everything it was not
  supposed to touch; the amending session is wrapped in the same one, with the
  narrower boundary it was given: that one file, changed where it is. A ref
  moved, a working tree touched, `product.json` written, another task rewritten,
  a new task in `todo/` nobody asked for, or the file itself moved out of
  `hold/` is named, and the run exits non-zero. The pre-prompt says "write no
  code… change nothing else", and a prompt is an instruction rather than a
  guarantee — the one person who could catch it is the one who has not read the
  conversation yet. Whether the file changed at all is said too: a conversation
  that decided to change nothing is a conversation, not a breach, but it is not
  something to leave a person guessing about either.
- **An answer is not withdrawn by a later one.** `plan` ends the run, but a
  task resumed earlier in the same pass has still been decided about: the move
  happens, with its commit and its push, before the conversation opens, and the
  closing line says it is queued in `todo/` and was not started. The screen said
  "resuming" when it was answered, and a run that then did nothing about it
  would have been lying about the one thing a person cannot check from the
  screen.
- **This narrows 0009 in one place.** 0009 says a paused task is resumed by
  moving its file back to `todo/`. The move may now be detent's, on a person's
  answer; the decision is still theirs, and `failed/` is still untouchable in
  both directions.

## Consequences

- `detent run` can now refuse to start work that `todo/` says is ready, which
  is new: until now the queue was the whole answer. The sentence names the
  barrier, its file and the flag that overrides it, because a refusal nobody can
  act on is worse than the start it prevented.
- A run that is barred exits 1, like one that stopped at a barrier inside
  itself. A cron line that watched for a zero sees the barring the same way it
  would have seen the original failure, which is the point.
- `run` is now the second command that reads detent's own stdin. It is still
  interactive about exactly one thing — a paused task — and nothing else about
  it asks anything: no confirmation before a normal queue, no prompt on a dirty
  tree.
- The answer is never remembered. There is no `alwaysResume`, no stored
  preference: the question is asked because the answer depends on what the
  person has just read.
- A paused task's barrier flag is read from its own file rather than from
  `readQueue`, which holds only `todo/` to the full shape. A file whose
  frontmatter cannot be read bars nothing — a task being rewritten in `hold/`
  still bars, and a task that is not a task does not.

## Alternatives rejected

**Resume paused tasks automatically.** The cheapest thing that makes the queue
move again, and the most expensive thing to be wrong about. A task rejected for
its criteria would run again unchanged and bill for it — three attempts and
three acceptance passes to arrive at the same doubt, because nothing about the
task had changed. 0009 made the pause a call for a person, and a resume that
needs no person is that call withdrawn.

**Treat a paused barrier as a warning and start the work anyway.** It would
keep every existing run green and print a line. But the first run already
refused to start that work, for a reason the second run has no new information
about: the contract is still the old one. A warning is what the first run's
`stopped at barrier` line already was, and a second run that merely repeats it
while doing the opposite is a report nobody can trust.

**Make the barring part of the question.** Then a pipeline, a cron line and a
script — exactly the places `run` is most likely to be started and walked away
from — would take the default and start the barred work. A question may decide
what a person can do about a rule; it may not decide whether the rule holds.

**A `--resume <id>` flag instead of the question.** It is the `mv` with a nicer
spelling, and it answers only one of the three things a person wants: it cannot
offer the edit, which is what a rejected task most often needs. The flag that
does exist, `--past`, is for the one case where there is nothing to decide —
the contract landed elsewhere and the person knows it.

**Infer order from which repository a task names, or let a task declare
`depends_on`.** The ordering detent knows is ids and `touches_contract` (§8).
Everything here is an application of that rule to a folder it was not being
applied to, and nothing here is a second ordering.
