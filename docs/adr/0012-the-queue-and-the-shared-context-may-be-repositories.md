# 0012. The queue and the shared context may be repositories

- **Date:** 2026-10-15
- **Status:** accepted

## Context

A way of working brought from outside this repository, and the first one that
did not fit.

A product carries up to three optional repositories that are the agents'
shared context: documentation, a kit, and the queue. They are mounted as
submodules in the product's own repositories, so a dispatched agent reads them
without leaving the working copy it was given. A **session** — a person and an
agent together — writes there: decisions into the documentation, tasks into
the queue, each task carrying links to the documents whose context it needs.
The session commits and pushes. The dispatched agent only ever reads.

Three of detent's assumptions collide with that, and all three were assumed
for reasons this way of working removes.

**The queue is not versioned (0005).** It sits at the product root and churns
there, which is right when one person runs one workspace. Here a session
writes tasks on one machine and a run reads them on another, so the queue is a
repository and has to be.

**A submodule pointer is never committed (§13).** The reason given is exact:
moving a pointer without pushing the submodule leaves a reference to nowhere.
Here the session pushes before the run starts, so the premise is not true —
and the pointer is the only place that can record *which revision of the
documents a task was done against*, which is what linking documents from a
task body was for.

**detent never pushes.** But the queue's state is detent's own bookkeeping
rather than an agent's output, and a queue in a repository that is never
pushed is a queue the next machine reads stale.

There is also a mechanical collision, measured rather than assumed. A
submodule is pinned by a commit, so keeping one at its latest means the pin is
always behind: `git submodule update --remote` alone makes the superproject
report ` M <path>`, with nothing written by anybody. Against condition 5 that
skips the repository, and it does so on the update, not on any change. While
the pointer is never committed there is no way out of that.

## Decision

Three parts, each narrowing a rule rather than dropping it.

**1. The queue's location is configurable.** `queue` in `product.json` names a
path relative to the product folder; it defaults to `tasks`, which is what
0005 chose and what every product that says nothing continues to get. Nothing
else about the queue changes: four folders, the same file shape, the same
counter.

**2. A submodule pointer may be committed, and only when it is verified to be
reachable from the remote.** The prohibition becomes a check. Before a task's
commit, every submodule **not** listed in `neverCommit` has its checked-out
commit tested against its own remote — `git fetch`, then
`git branch -r --contains HEAD`, which is empty exactly when the commit was
never pushed. Empty means the task pauses and says which submodule and why; it
does not mean the pointer is quietly dropped. A submodule that stays in
`neverCommit` behaves exactly as it does today, down to the sentence the agent
is given about not touching it.

**3. detent pushes the queue, and nothing else.** When the queue lives in a
repository, a task moving from `todo/` to `done/` is committed and pushed
there. Not a product repository, not `agent/dev`, not a tag. `assertAgentRef`
goes on guarding every other ref in every other repository, unchanged.

## Consequences

- A task's commit records the revision of the shared documents the agent
  actually read. Six months later "which version of that ADR was this built
  against" has an answer in the history rather than in somebody's memory.
- Keeping submodules current stops fighting the clean-tree condition, because
  the pointer that moved is now committed instead of being permanent dirt.
- **detent writes to a branch outside `refs/heads/agent/` for the first time**,
  and pushes it. The sentence "detent never pushes" becomes "detent pushes the
  queue and nothing else", and the README, `DESIGN.md` §13 and `doctor` have to
  say the narrower thing rather than the clean one. A rule with an exception is
  worth less than a rule without one; this one is paid for by a queue two
  machines can share.
- A queue in a repository produces commits — one or two a task. That is the
  churn 0005 refused, now chosen deliberately and only by a product that asks
  for it.
- A run whose queue remote is unreachable cannot record its own progress. It
  stops rather than working on and diverging quietly, which makes the network
  a dependency of a run for the first time.
- The check costs a fetch per tracked submodule per task.
- A product that configures none of this is bit-for-bit unaffected: queue at
  the root, every submodule in `neverCommit`, no pushes, no fetches.

## Alternatives rejected

**Keep the pointer in `neverCommit` and teach the clean-tree check to ignore
those paths instead.** This was the first design and it very nearly won:
`neverCommit` already means "never committed", so "and not dirt either" is the
same sentence finished, it costs a pathspec exclusion, and it needs no ADR at
all. It was dropped because of what it leaves out. The commit then records that
the agent read revision X when it read Y, and no amount of green says
otherwise — the exact shape of unchecked claim this project exists to refuse,
and in the one place the methodology was built to make checkable.

**Commit the pointer without verifying it.** Cheaper, and it turns a rule with
a reason into a rule with none. The reference-to-nowhere that §13 names stops
being impossible and starts being unlikely, which is a different thing: the
first unpushed submodule produces a product history that cannot be rebuilt,
and the failure appears on the machine that clones it rather than the one that
caused it.

**Let a person push the queue.** Keeps "detent never pushes" intact, and makes
the queue's state depend on somebody remembering between tasks. A run works a
queue for hours; the first forgotten push gives the next machine a stale todo
and a task that runs twice.

**The queue in the documentation repository**, which 0005 already rejected and
which this does not revive. The queue gets its own repository precisely so
that a file moving between folders forty times a day does not churn the
repository where decisions are written.
