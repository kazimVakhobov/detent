# 0026. The base of a resumed branch is re-asked before the work, and detent reports rather than resolves

- **Date:** 2026-10-23
- **Status:** accepted — narrows 0009

## Context

A fresh task branches from the integration branch as it is now. A resumed one
is checked out, and its fork point stays where it was
([0009](0009-three-attempts-then-pause.md)): the branch keeps the base it was
cut from. That base was right the day it was cut, and it is a claim about the
world that nothing re-asked.

Nothing in `core/` asked it. `merge-base`, `--is-ancestor` and `merge-tree`
appeared nowhere. The only merge detent performed was the one in `land()`, at
the end of the run — so a branch forked from a superseded base was discovered
there, after the agent had worked, after the gauge had gone green, and after
the acceptance pass had read the diff and accepted it.

**This happened.** Task 0004 in another product was cut from `agent/dev` at one
commit, sat in `hold/` while task 0003 landed over the same files, and resumed
on its old base. Three attempts, 36 minutes, $17.04 — and a merge conflicting
in ten files. The acceptance pass had diagnosed it in words on the first round:
the branch is forked from the wrong commit, and the criteria are met only
against a base that has been superseded. **The implementing agent could not act
on it.** Merging the integration branch into a task branch is not something the
territory rules let it do ([0013](0013-the-agent-gets-a-prompt-and-a-directory.md)),
so it did the only thing left to it and wrote more tests.

The window is also about to widen. Today a branch goes stale only while its
task sits in `hold/`. Raise `concurrency` above one and a sibling in another
repository can land over the same shared files between one run and the next,
with no pause in between.

And the question is cheap. A trial merge answers whether the branch would
conflict without touching the working tree, without a commit, in milliseconds
— the same argument 0014 makes about a task's links, which are looked for
before the first attempt rather than after the last.

## Decision

- **A run whose task branch already exists tries the merge before the first
  attempt.** `wouldConflict(cwd, integration, branch)` in `core/git.mjs`:
  `git merge-tree --write-tree`, which computes the merge in the object
  database and reports it. No ref moves, HEAD stays where it is, and the index
  and the working tree are exactly as they were. `beginMerge` answers the same
  question by checking out a detached HEAD, and that is a write — which is why
  this is a second function rather than a reuse of the first.
- **A conflict pauses the task before the agent is asked for anything.** The
  outcome is `stale`, the task moves to `hold/`, the conflicting paths are
  named, and the person is notified through whatever `notify` declares, exactly
  as for any other pause.
- **The step is the person's, and it is the one `land()` already names:** merge
  the integration branch into the task branch, resolve, commit, and move the
  file back to `todo/`. One sentence serves both, because it is the same step
  whichever end of the run found the conflict.
- **detent does not resolve, and does not merge the integration branch into the
  task branch.** Not automatically, not behind a flag, not "when it is clean".
  The agent's branch is the agent's work, and what is on the integration branch
  arrives there by a person's hand — §13's rule, unchanged.
- **Only a conflict is said out loud.** A branch that is merely behind the
  integration branch — the ordinary state of nearly every resumed branch —
  says nothing and runs.
- **`stale` is its own outcome,** distinguishable in the journal from a merge
  that conflicted after three attempts: `attempts` is `0`, `rounds` is empty,
  and `cost` is zero rather than `null`, because no model was asked for
  anything. The number worth having is what this check saves, and a line that
  looked like an ordinary escalation could not answer it.
- **The late check stays.** `land()` goes on merging and goes on pausing on a
  conflict. Early is cheaper; it is not instead. A branch can also go stale
  between the start of a run and its merge, and the agent's own commits can
  conflict with something that was clean when the run began.
- **A fresh task is unaffected** — it has just been cut from the integration
  tip, and there is nothing to ask.
- **Never a conflict that is not there.** No commit in common, nothing on the
  integration branch this branch does not already have, or a git that will not
  answer the question all come back clean. The merge at the end asks for real,
  so saying nothing here costs one run; a false alarm costs a person a trip to
  resolve a conflict that does not exist, and after the second one nobody reads
  the message.

## Consequences

- A resumed run can now end having spent nothing, which no outcome described
  before. `summarise` counts it among the runs, so the pass rate does not
  improve merely by detecting earlier what used to be an `escalated` run; it
  does pull `attemptsPerRun` down, truthfully.
- `stale` joins the raw outcome names `notify.events` may ask for, so somebody
  can hear about this one alone.
- `lastRun` skips a `stale` line when it tells the next attempt why the task
  stopped. Nothing was worked, so there is nothing to report — and its reason
  names the integration branch and a merge, which is what the agent is never
  told about (0013). What the agent hears is the run before it.
- One more git invocation per resumed run, and two for a branch that is behind:
  a `merge-base`, an `--is-ancestor`, and the `merge-tree` only when there is
  something to bring in. It writes one unreferenced tree object, which git
  collects.
- A git too old for `merge-tree --write-tree` answers nothing and every run
  behaves exactly as it did before this existed.

## Alternatives rejected

**Rebase or merge the integration branch in for the person.** It is what a
developer would do by hand, and it is the one thing detent must not do:
resolving two pieces of work is a judgement about both, one of which detent has
not read and the agent has never seen. §13 already says never resolve a
conflict, and merging a moving branch into the agent's own work would make
detent the author of a commit nobody reviewed. "Only when it is clean" is the
same decision with a smaller blast radius: it still rewrites the agent's branch
on detent's initiative, and the clean case is precisely the case that costs
nothing to leave alone.

**Warn on staleness instead of on conflict.** `merge-base --is-ancestor` is one
command and would fire on every resumed branch that is behind — which is nearly
all of them, since anything landing meanwhile moves the integration branch.
A check that fires almost every time is learned as noise within a week, and
then the one that mattered is skimmed past with the rest. The expensive thing
is not being behind; it is conflicting.

**A flag that runs anyway.** `--ignore-stale` would buy exactly the $17 this
exists to save. A conflicting merge at the end of the run is the outcome being
avoided, and there is no version of "I know, run it anyway" that ends anywhere
else: the conflict is still there at `land()`, and the person still has to
resolve it, having now paid for three attempts first.

**Tell the agent about the conflict and let it deal with it.** It was told, in
effect, the day this cost $17: the acceptance pass named the wrong fork point
in its doubts, and the agent could do nothing with that but write more tests.
The agent gets a prompt and a directory (0013); a conflict with a branch it has
never seen is not its problem, and naming the integration branch in its prompt
would invite it to try the merge the rules forbid.

**Check it in the gate, with the dirty tree and the half-finished rebase.** The
gate refuses a repository and the run moves on to the next one; this needs the
task paused, moved to `hold/` and a person told, which is a task outcome and
not a skip. It also needs the task branch, and the gate runs before anything
knows which branch that is.

**Ask it in `withTask`, where the branch is checked out.** That is the gate,
the unconditional return and recover, and it is the only place detent can
destroy work that is not its own — it holds no journal line, no notifier and no
queue, and the answer here is all three. `withTask` says which branch the work
happens on and that is all it says (0009); the question is asked by the run,
before the first attempt.
