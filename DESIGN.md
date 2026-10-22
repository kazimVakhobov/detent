# Design

What detent is, written down before it is built. Decisions are recorded with
the reason that produced them: in six months the reason is worth more than the
decision.

> **Status: being built.** This is the specification the code is written
> against, not a description of working software. [PROGRESS.md](PROGRESS.md)
> says which steps of the build order exist.

---

## 1. Four invariants

detent is opinionated about how a product is laid out. It is worth separating
what it actually *requires* from how that requirement happens to be met, because
only the first kind of deviation is fatal.

| | Invariant | How detent meets it |
|---|---|---|
| **I1** | A unit of work is **isolable** — a task gets a clean, private place to work | one task at a time per repository, on its own branch |
| **I2** | Done is **machine-checkable locally**, in seconds | the gauge: declared stages, run on the agent's way out |
| **I3** | Work lands **somewhere that is not the human's branch** | `agent/dev`, optionally a second stop on `agent/staging`, and the human merges from it |
| **I4** | A task's blast radius is **declarable** | the exclusion key is the repository |

Repositories side by side in one folder, a documentation submodule, the names
`dev` and `agent/dev`, how many stops the work makes before the human gate —
none of that is an invariant. It is one implementation of the four above, and it
is the one detent implements.

---

## 2. The territory

```
       human                   │                     agents
  ─────────────────────────────┼──────────────────────────────────────────
  dev → staging → main         │   agent/task-<id>-<slug>
  feature/*, hotfix/*          │         │ merge, when the gauge is green
                               │         ▼
                               │   agent/dev
                               │         │ promote, when the batch is green
                               │         ▼   (optional, §7)
                               │   agent/staging
                               │
  dev → agent/dev  ────────────┼──→  here is my work, take it into account
  agent/staging → dev  ←───────┼───  I accept yours
```

detent reads and writes refs under **`refs/heads/agent/`** and nothing else. It
does not check out, commit to, merge into, or create a branch outside that
namespace — including the starting point of `agent/dev` itself.

The namespace is a single predicate rather than a convention spread across
string comparisons: a ref about to be written either begins with `agent/` or the
write is a bug. Everything detent owns is also one glob —
`git for-each-ref refs/heads/agent/` — which is what makes the invariant below
testable in one assertion instead of a list of branch names somebody has to
remember to extend.

One git detail travels with the slash: **a branch named exactly `agent` cannot
coexist with the namespace.** Refs are stored as paths, and a path cannot be
both a file and a directory — `'refs/heads/agent' exists; cannot create
'refs/heads/agent/dev'`, and the same error in the other direction. `detent
doctor` checks for it, because encountered mid-run it reads as a mystery rather
than a naming clash.

**Both gates are human operations, in both directions.** detent does not offer
to run them, because the point of the boundary is that crossing it is a
decision, not a step.

Two consequences, stated so they are not mistaken for oversights:

- **You create `agent/dev` yourself** — and `agent/staging`, if you declare one.
  Creating a branch means naming a start point, and the start point is a human
  branch. `detent doctor` prints the command and stops there.
- **A repository rests on `agent/dev`, not on your branch.** detent does not put
  you back where you were, because putting you back means naming your branch.
  You switch back yourself.

### The invariant that gets tested first

> Every exit from a task — success, red gauge, rejection, exception, Ctrl-C —
> leaves the repository **on `agent/dev` with a clean tree**, and every ref that
> moved lives under `refs/heads/agent/`.

This is the only place detent can destroy work that is not its own, so it is the
first thing covered by tests and the thing `detent recover` exists to restore.

The test is a snapshot of *every* ref before a run and after it, asserting that
the difference falls entirely inside the namespace. One assertion, and it fails
on a branch nobody thought to enumerate.

### Divergence is reported, never acted on

A human branch may be read to report how far `agent/dev` has drifted from it:

```
acme-api      agent/dev  ≡ dev
acme-web      agent/dev  12 commits behind dev   ⚠ agents cannot see your work
acme-admin    agent/dev  3 tasks ahead of dev    waiting for your review
```

Reading a ref is not touching a branch. Nothing follows from this report
automatically — stale `agent/dev` turns the gauge red for reasons that are not
the agent's fault, and knowing that is the point.

---

## 3. What detent expects of a product

Nine conditions. `detent doctor` checks all of them and names what to change.

1. git, not a shallow clone
2. the product's repositories sit side by side in one folder — one per unit of ownership
3. each repository names **one** human branch as the point `agent/dev` is
   reported against — a release train behind it is not detent's business
4. the gauge is declared as stages: a name and a command, runnable locally — the
   per-attempt profile in seconds
5. a clean tree when a run starts
6. an agent CLI installed and authenticated — Claude Code, the one agent this
   version offers ([ADR 0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md))
7. the integration branch is not deployed; pushing is done by hand
8. one person per workspace
9. macOS or Linux, Node 22

A product that does not match is not bent into shape by detent. It is told what
does not match.

---

## 4. Tasks

### Identity

A task has a number, assigned when it is created. The number is the key; the
slug is for people.

```
tasks/todo/0042-wallet-endpoint.md   →   agent/task-0042-wallet-endpoint
```

The number appears in the filename and in the frontmatter, so it is visible
whichever one you opened. It never changes — the file moves between folders, the
number does not. The counter is the highest number across all four folders:
there is no separate counter file, and therefore nothing that can disagree with
reality.

The four folders sit wherever `queue` in `product.json` says, relative to the
product folder, and at `tasks/` for a product that says nothing (§11,
[ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).
Everything detent reads, writes and prints uses that path, so a product whose
queue is elsewhere is never told about a folder it has not got.

### Shape

```markdown
---
id: 0042
repo: acme-api
touches_contract: false
---

# Goal

One paragraph: what must work when this is done.

# Acceptance criteria

- [ ] a checkable statement
- [ ] another one

# Out of scope

What not to do while you are in there.
```

The frontmatter is bookkeeping. **Only the body reaches the agent** — the spec
written before the work *is* the prompt, not a second document that drifts away
from it.

`touches_contract: true` makes the task a barrier (§8).

### A link in a task body

```markdown
Follow [the decision about idempotency](shared-docs/adr/0003-idempotency.md).
```

A task body links to a document, which is the whole reason a methodology puts
documents in a repository and mounts it. A link is a **markdown link, of the
shape above, whose path is relative to the root of the repository the task
names**: `shared-docs/adr/0003.md` in a task for `acme-api` is
`acme-api/shared-docs/adr/0003.md`, which is the only form that means anything
when the documents arrive as a submodule. Prose that mentions a file is not a
link, a URL is somebody else's to serve, and a link inside a fenced block is an
example of one — the same line `scripts/check-docs.mjs` draws for this
repository's own documentation.

Every link is looked for **at the start of the task, after the shared context
has been brought to its remote's tip** (§5), so the question is asked of the
revision the agent will actually read. Not at queue validation, where a
document pushed and not yet fetched would be reported missing — a false alarm
about exactly the freshest documents, which are the ones a task is most likely
to name.

A link that resolves is **not mentioned anywhere**: silence is the normal case,
and a check that reports its own success spends a line of the most load-bearing
text in the product on nothing. A broken one is told to the agent as part of
what it is given, naming the path, so the only party who can tell whether the
document was needed is the one asked; it is in the journal line as
`"links": { "checked": 3, "broken": [...] }` (§11), always present, so a task
with no links and a task whose links all resolved are different records; and it
is given to the acceptance pass, because a reviewer deciding whether the work is
sound should know what the implementer could not read.

**It is not a pause.** detent cannot tell a load-bearing link from a decorative
one, and a task may name five documents and need one; stopping on the other four
trains a person to stop reading the reason. The price is recorded rather than
hidden: a task whose document was missing can end green and under-informed
([ADR 0014](docs/adr/0014-init-asks-where-the-queue-and-the-documents-are.md)).

The check never reads `docs` (§11). A path either resolves in the repository the
task names or it does not, and that question does not depend on a key; what
`docs` says is which repository those documents live in, which is what makes a
missing one somebody's to mount.

### Validation before any of it runs

`detent plan` and `detent run` both reject a queue that cannot be executed:
the repository must exist in `product.json`, acceptance criteria must be
non-empty, the id must be unique. Catching this before the first agent starts is
the difference between a typo and three wasted attempts.

`detent run` asks one more thing before it creates a branch: whether `doctor`
already **fails** on the repositories the queued tasks name (§12). It is not a
second opinion — a failure is by definition what would stop a run or make it
skip a repository, so every one of them is something the run was going to hit
anyway, and a declared agent nobody installed used to be found out when it was
invoked, after the task branch existed and the workspace had been taken. What
`doctor` calls worth a look is left out, a repository no queued task mentions
is never asked about, and the refusal names the checks that failed and then
`detent doctor` for the rest, rather than reprinting a report nobody asked for.

---

## 5. Lifecycle

```
tasks/todo/0042-wallet-endpoint.md

  gate: clean tree · no merge or rebase in progress · agent/dev exists · repo free
        ──→ any of these fails: the repository is skipped, the run continues

  git checkout -b agent/task-0042-wallet-endpoint agent/dev
        (or the existing branch, when a paused task is resumed)

  the shared context to its remote's tip — every submodule outside neverCommit
        ──→ one that cannot be reached: the task is paused, no agent is asked

  ┌── the agent works in the main copy
  │   gauge (exit profile)
  │     red   → the agent is handed the stage and the failure text; attempt++
  │     red on the last attempt → escalation, no further attempt
  │   green → commit
  │
  │   acceptance pass, on a different model — may demote, never approve
  │     a doubt → wip commit carrying each doubt; the agent is handed them
  └──           and told the gauge was green; attempt++
        a doubt on the last attempt → rejected, no further attempt

  no doubt  → checkout agent/dev → merge → done/
              conflict → merge --abort → escalation
  otherwise → wip commit on the task branch → hold/, and a person is told

  always    → checkout agent/dev, clean tree
  always    → one line appended to the journal, with a round per attempt
```

### Outcomes

| Outcome | Meaning | Branch | Merged |
|---|---|---|---|
| `passed` | gauge green, acceptance raised nothing | deleted after merge | yes |
| `rejected` | **gauge green and the task still was not done**, on the last of `attempts` attempts | kept | no |
| `escalated` | the last of `attempts` attempts was red, or the merge conflicted | kept | no |
| `error` | the run itself broke — quota, crash, exception | kept | no |
| `skipped` | the gate refused: dirty tree, no `agent/dev` | none | no |

`rejected` is a separate outcome on purpose. It is the number this project
exists to produce: the machine checks were green and the work was still not
done. Folding it into `escalated` would hide exactly the measurement that
justifies running an acceptance pass at all.

**`attempts` is one budget and a doubt spends it too**
([ADR 0023](docs/adr/0023-a-doubt-is-an-attempt-and-every-round-is-recorded.md)).
A doubt before the last attempt hands the doubts to the agent and goes round
again; `rejected` is the outcome of a doubt on the last one. The reviewer still
never approves — a round ends in a merge because the gauge was green and no
doubt was raised — so what the budget bought is how many times the reviewer
gets to speak before a person is called, and nothing about who grants green.

Failed work never reaches `agent/dev`, so the next task in that repository
branches from a clean base and does not inherit someone else's mess.

### Landing

The merge into `agent/dev` is built on a **detached HEAD** and checked there:
the `merge` profile runs on the merged tree, which is what will actually land,
and `agent/dev` moves to the merge commit only when that is green. A red merge
gauge or a conflict leaves `agent/dev` exactly where it was — nothing to revert,
because nothing moved — and pauses the task with its green commit kept on its
branch. The merge commit runs no hooks and carries the `Task` trailer and both
gauges. A landed task's branch is deleted; its commits live on in `agent/dev`.

### The agent's turn

The agent is given the task body and nothing of the frontmatter, the rules of
the territory — stay on this branch, do not commit, merge, stash or push — the
gauge stages it is held to, and on a retry the failed stage's output. It is
asked to end with a `Commit:` line; a well-formed one becomes the subject of
the commit, and detent writes the trailers whatever it says. It is also told
which documents the task links to are not in the repository, and nothing about
the ones that are (§4).

An agent has a shell, so the boundary is **checked after every turn, not
assumed**. If `agent/dev` moved, detent puts it back and keeps what the agent
put there on `<task branch>-stray`. If a human branch or a tag moved, detent
names it and pauses the task — it is not detent's to move back. Green with
nothing changed is not a pass.

The files that **judge** the agent live outside its repository but within reach
of its shell: `.detent/product.json` holds the gauge, the task file holds the
criteria, the journal holds the record. Each is fingerprinted before the agent's
turn and compared after it; a change pauses the task and names the file. They
are the person's, so detent does not restore them — and the run goes on using
the product it loaded before the agent started, so an edited gauge never judges
the attempt that edited it.

### What the agent is saying, while it says it

The agent's output arrives **as a stream**, and every attempt's raw stdout is
written to `runs/logs/<task>-attempt-<n>.jsonl` as it arrives, byte for byte
([ADR 0021](docs/adr/0021-the-agents-output-is-a-stream-written-to-a-file-that-is-not-a-record.md)).
A run used to print a line when a task started and a line when it ended, and
between them — minutes, sometimes a quarter of an hour — nothing.

**The name is the index.** Nothing records where a log is: a task id and an
attempt number are enough to write the path, which is what makes `tail -f`
possible without copying anything out of a terminal a run has occupied.
`detent run` prints the path for attempt 1 when a task starts and shows nothing
— several tasks may be running, and their output interleaved in one terminal is
unreadable. The surface this is for is the dashboard (§12), which shows it
inside the task's own detail view.

**What is logged, and what is not.** One file per **implementing attempt**, and
nothing else in a run writes one:

| Part of a run | Log |
|---|---|
| each of the agent's implementing attempts | `<task>-attempt-<n>.jsonl` |
| the gauge, either profile (§6) | none — its stages are commands, and their output is the feedback the next attempt is handed |
| the link check (§4) | none — what it found is in the journal line and on the task |
| the acceptance pass (§9) | none — its output is a verdict and its doubts, which the journal line carries and the task detail shows; a transcript of it would widen the privacy cost stated below for content already recorded |
| the merge, the commit, the queue move (§5) | none — git's own work, and the journal says what came of it |

So **a task can be running with nothing arriving here**, and a reader of this
section must not take "what the agent is saying" for a record of the run: most
of the wall clock of a run is the agent's turn, but the parts that are not are
exactly the ones that print nothing. The journal line is the record of the whole
run; a log is one attempt's output and no more. The dashboard therefore
distinguishes three states rather than two, and §12 says how it tells them
apart without a phase field anything would have to keep true.

**A log is not a record.** Nothing reads one to decide an outcome, a cost, a
verdict or a model. Every number in a journal line comes from the result object
the agent prints last, exactly as it did when that object was the only thing it
printed; a number taken from a transcript is a number nobody can check. The
stream is parsed in one place, for display on the page, and a line that will
not parse is shown as it arrived.

**Losing it never costs the task.** A log that cannot be opened or written says
so once, on stderr, and then does nothing. The run carries on and the journal
is unaffected.

**It goes no further than this machine.** A transcript holds whatever the agent
read — file contents, values from the environment, whatever a tool returned —
and the dashboard that serves it is on loopback.

**It is kept until `detent prune`**, which deletes the attempt logs of tasks in
`done/` and `failed/`, and of tasks whose file is in none of the four folders.
A task in `todo/` or `hold/` keeps its last attempt, because that is what a
person opens the task to read, and a task a run is holding is being written to
right now. An artefact with no stated end is a disk leak with a feature request
attached.

### The shared context

A product may mount documentation, a kit or the queue as submodules of its
repositories, so that a dispatched agent reads them without leaving the working
copy it was given. Those submodules are **brought to their remote's tip before
the agent's first turn**, and the commit each one landed on goes in the journal
line: the agent reads the context as of the moment its task started, and the
run's record says what that was
([ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).
A submodule that cannot be reached pauses the task before an agent is asked for
anything — work done against a context nobody chose would be recorded as work
done against one.

The pointer that results is committed with the task, and only once it is
verified (§13). Which submodules this is about is one question with one answer:
those **not** listed in `neverCommit`. A submodule in `neverCommit` is not
fetched, not moved and not committed, and the agent is told not to touch it —
exactly as before, which is what every product that says nothing gets. About a
tracked one the agent is told the other half: read it, do not write there, and
detent records which revision it read.

### The time limit

Every agent call — the implementer's and the reviewer's — is held to `timeout`
minutes (default 30; a repository may set its own). Past it the agent's whole
process group gets SIGTERM, and SIGKILL after a grace period: an agent's shell
commands would otherwise outlive it and keep the run waiting. A stopped call is
an `error`; the task is paused with the work up to the cut parked on its
branch, and not retried — a call that hangs usually says something about the
environment, not the code. Because each agent runs in its own process group, a
terminal's Ctrl-C does not reach it directly, so detent stops every live agent
itself before it returns the repositories.

### Pausing, and resuming

Every outcome other than `passed` and `skipped` needs a person, so it **pauses
the task** rather than judging it: the file moves to `tasks/hold/`, the branch
keeps the work, and the person is notified
([ADR 0009](docs/adr/0009-three-attempts-then-pause.md)). Moving the file back
to `todo/` resumes it on the same branch with a fresh budget and whatever the
person added to the task. `failed/` is where a person puts a task they abandon;
detent never moves anything there.

**The decision to resume is a person's; the move need not be.** `detent run`
offers each paused task three answers — leave it, resume it now, or open `plan`
to change it first — and the default is to leave it, because a bare Enter must
never start a run that costs money. Resuming moves the file through the same
`moveAndRecord` every other move goes through, so a queue that is a repository
gets its commit and its push (§11); `plan` is opened on the task file where it
is, with what the last run said about it, and the run stops afterwards rather
than chaining into one. With nobody on stdin nothing is asked, each paused task
is named in a line, and everything a paused barrier bars stays barred
([ADR 0024](docs/adr/0024-a-barrier-bars-until-it-passes-and-a-resume-is-a-decision-not-a-move.md)).
Nothing about the resumed run itself changes: the same branch, the same fresh
budget, the same doubts handed to the implementer.

A **conflict** is the one pause a resume cannot get past on its own. detent
never resolves a conflict, and the agent is not let into a merge either — a
resolution is a judgement about two pieces of work, one of which the agent has
never seen. So the notification names the paths and the person's step: merge
`agent/dev` into the task branch, resolve, commit, and move the task back to
`todo/`. The next run lands it.

`notify` in `product.json` is a shell command. It gets the message on stdin and
`DETENT_TASK`, `DETENT_REPO`, `DETENT_OUTCOME`, `DETENT_BRANCH` and
`DETENT_MESSAGE` in its environment — enough to reach a chat, a phone or a mail
without detent holding a credential for any of them. Without it, detent tries a
desktop notification. A notifier that fails is reported, never fatal.

---

## 6. The gauge

Stages are declared, not discovered:

```json
"gauge": {
  "exit":  [
    { "stage": "lint",      "command": "npm run lint" },
    { "stage": "typecheck", "command": "npm run typecheck" },
    { "stage": "test",      "command": "npm test" }
  ],
  "merge": [
    { "stage": "build",     "command": "npm run build" }
  ],
  "promote": [
    { "stage": "e2e",       "command": "npm run e2e" }
  ]
}
```

Guessing which link of a `&&` chain died by pattern-matching its output works
for exactly one package manager. Declaring the stages costs three lines and
gives an exact answer for make, cargo, pytest and everything else.

**Three profiles, because one gauge cannot answer three questions.** Each is
tied to what it is allowed to cost, and the unit it checks:

| Profile | Runs | Unit | Budget |
|---|---|---|---|
| `exit` | every attempt, on the agent's way out | one attempt | seconds — anything slower makes each iteration expensive |
| `merge` | once, before landing on `agent/dev` | one task | may be slow |
| `promote` | once, before landing on `agent/staging` | a batch of tasks | may be very slow (§7) |

`promote` is optional and does nothing on its own: without a declared
`agent/staging` there is nowhere to promote to.

**A repository that declares no gauge gets no lock.** It is not refused, and it
is not pretended at: the journal records `"lock": "absent"` and the summary
shows a dash rather than a pass rate. A green result invented for a project with
no checks is worse than no result.

A gauge of `lint + typecheck` with no tests checks that the code compiles, not
that it works. detent will run it and will say so in the summary; it will not
call it behaviour.

**A profile's stages define what green covers, and green means nothing outside
them.** A stage checks what its command reads, and a change the command never
opens has not been checked — however green the run, however real the gauge. A
repository whose gauge is `lint + typecheck + test` and whose task edited only
the README has been told that the code still compiles and the tests still pass,
and nothing at all about the README. This is the honesty of `"lock": "absent"`
extended to a gauge that is real but blind to the change in front of it: detent
reports the stages that ran and reads no further into them. Covering a gap like
that is a stage somebody adds, never an interpretation detent supplies
([0011](docs/adr/0011-a-gauge-that-cannot-read-the-change.md)).

### The lock

Stages run in order and the first red one ends the gauge: it is the answer, and
a stage built on top of it would report the same failure in other words. The
agent is handed that stage's command and the end of its output — stdout and
stderr together, in the order they arrived — two pipes guarantee no more than
that — capped from the front because the failure is almost always reported
last.

`attempts` in `product.json` is the budget: how many times the agent is let
back in (default 3). A red gauge on the last attempt ends the task as
`escalated`. Whether the failures were **identical** is recorded in the reason,
because "stuck on the same thing" and "failing somewhere new each time" are
different news — identical meaning the same stage, the same exit and the same
output once colour codes, timestamps and durations are removed.

---

## 7. Promotion

Both other profiles check **one task**. The thing that actually breaks is the
combination: five tasks green on their own, and together a broken integration, a
failing build, a contract that no longer matches. `agent/staging` is where that
is checked.

It is optional — declare the branch and the profile, or neither.

### Promotion is a command, not a step of a run

`detent promote` is explicit, and never automatic after a task. A batch gauge
that runs after every task is merely a slow `merge` profile, which already
exists; the value is in checking what a batch does that its tasks did not.

The gate: clean tree · no active run · `agent/staging` exists · at least one
task landed on `agent/dev` since the last promotion.

| | |
|---|---|
| green | `agent/dev` merges into `agent/staging`, and the human gate becomes `agent/staging → dev` |
| red | **nothing is promoted and nothing is reverted** — the work stays on `agent/dev`, the failed stage goes to the journal |
| conflict | `merge --abort`, escalate — as everywhere |
| interrupted | `detent recover` returns the repository to `agent/dev` with a clean tree |

The batch is every task whose merge reached `agent/dev` since the last
promotion, read from the `Task` trailers between the two branches. The merge
is staged on a detached HEAD and the `promote` profile runs on that tree, so
`agent/staging` moves only to a batch that was green together; the promotion
commit names the tasks it carries and runs no hooks. The journal line's
outcome is `passed`, `red`, `escalated` (a conflict), `skipped` or `error`, and
red, conflict and error tell the developer. A staging branch with no promote
stages still promotes, says the batch was not checked, and is not counted as a
green batch.

**Nothing is bisected.** A red batch means the combination broke; which task is
at fault detent does not know and does not guess. Bisecting a batch is a
different product, and a confident wrong answer here costs more than no answer
(§15).

### What promotion is for: measuring the blind spot

A promotion is its own line in the journal, so `detent summary` can report the
number this section exists to produce: **how often a batch came out red after
every task in it was green.** That is the per-task gauge's blind spot, measured
— the same kind of number as `rejected`, and the reason staging is a mechanism
here rather than one more branch.

A side effect worth having: the branch a human reviews has passed more checks
than any single task in it ever did.

---

## 8. Scheduling

Two rules, and no others:

1. **One active task per repository.** The exclusion key is the repository name.
   There are no zones: zones existed to let two tasks share a repository, which
   requires separate working copies, which detent does not use.
2. **A barrier runs alone, and nothing starts past it.** The pool drains, the
   barrier task runs by itself, and only then does anything else begin. A
   contract change is an ordering point, not merely an exclusive slot — a task
   queued behind one must not begin against the contract that change is about to
   replace.

The concurrency ceiling is therefore bounded by the number of repositories, and
configured below it.

**A barrier that does not pass ends the run there.** The tasks queued behind it
were written for the contract it was meant to replace; starting them against
the old one is the mistake the barrier exists to prevent. They stay in `todo/`
for the next run, and the run says which were not started.

**And it goes on barring after that run is over.** A barrier that did not pass
is in `hold/`, so the next invocation would find no barrier in `todo/` and
start exactly the work the last one refused to start — against exactly the
contract it refused to start it against. The rule belongs to the queue rather
than to one process, so `run` reads `hold/` before anything begins: a paused
task with `touches_contract: true` bars every task in `todo/` with a higher
number, in any repository, and what is barred does not start. The run names the
barrier and why. This holds with a terminal and without one — it is a
correctness rule, not a convenience — and `detent run --past <id>` is the way
past it, for the person who knows that contract landed another way
([ADR 0024](docs/adr/0024-a-barrier-bars-until-it-passes-and-a-resume-is-a-decision-not-a-move.md)).
A paused task that changes no contract bars nothing: it is named in one line
and the queue runs.

Tasks for one repository run in id order; a busy repository never holds up
another. Running side by side, tasks share the journal, so the check that an
agent did not touch the files judging it allows the journal to grow by lines
detent itself appended, and by nothing else.

---

## 9. The acceptance pass

One model implements, a different model reads the diff against the acceptance
criteria. Different by design, not for economy: a model tends to approve its own
reasoning, and its blind spots are exactly its own.

**It can demote, never approve.** Green is granted by machine checks. A model's
judgement may only raise a doubt and send the task to a person. Otherwise
"proven" quietly becomes "a second model agreed", and the whole thing is
theatre.

How it runs:

- **After the green commit, before the merge.** The reviewer is `models.accept`,
  run in its CLI's **read-only mode** — Claude Code in plan mode — on the
  committed task branch. It is given the task body and the diff against
  `agent/dev`, and told what it is for: a criterion not met, something out of
  scope done anyway, a check satisfied by gaming it.
- **Read-only is checked, not trusted.** If the tree, the branch, a ref or a
  file that judges the agent changed, what the reviewer wrote is discarded and
  the task is paused as `error`.
- **The verdict is one line:** `VERDICT: NO DOUBTS`, or `VERDICT: DOUBTS`
  followed by one `- ` line per doubt. Doubts cost an attempt and put an empty
  commit on the branch carrying each one as a `Doubt:` trailer — on **every**
  rejected round, so `git log` on the task branch says what was said each time.
  Doubts on the last attempt pause the task as `rejected`. A verdict detent
  cannot read is an `error`, never a pass: silence is not the absence of doubt,
  and it is not retried either — the pass itself is what went wrong.
- **No `models.accept`, no pass.** The journal records `"verdict": "absent"`
  and the merge commit says `Acceptance: none declared`.
- **`implement` and `accept` must differ** — at least in model — or the
  configuration is refused. With one agent offered, that means a different
  model of the same agent: shared training, shared blind spots, and "may only
  raise a doubt" carrying more weight than it was meant to. That is the price
  of the one-agent version and it is written down rather than discovered
  ([ADR 0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)).
- **A doubt is an attempt** ([ADR 0023](docs/adr/0023-a-doubt-is-an-attempt-and-every-round-is-recorded.md)).
  The doubts go to the implementer, who addresses each one or says why it is
  wrong, and the loop goes round on the same budget the gauge spends. The
  wording differs from the gauge's retry on the one point that matters: the
  previous attempt **passed the gauge** and was still not accepted, so turning
  it green again is not what is missing. A rejected task a person resumed hands
  the doubts over the same way, from the journal's last line for that task.
- **Three outcomes, not two.** The pass answers merge, doubts or stop. `stop`
  is the pass going wrong rather than the work — a breach, a pass that wrote,
  a pass that failed, a verdict nothing can read — and it pauses the task
  without spending an attempt.

`summary` reports the number this exists for: of the green runs a reviewer
read, how many were not done. Beside it, the number the retry has to earn: of
the runs that passed, how many were accepted on a round after the first, having
been doubted on an earlier one.

---

## 10. Commits

**Green and accepted** — a real commit, and the branch merges:

```
feat(wallet): driver wallet balance in the app

Task: 0042
Gauge: lint ✓ typecheck ✓ test ✓ (2 attempts)
Agent: claude (claude-sonnet-5)
Acceptance: claude (claude-opus-5) — accepted

Co-Authored-By: ...
```

**Anything else** — a wip commit, and the branch stays where it is:

```
wip(wallet): attempt 3, gauge red on test

Task: 0042
Gauge: lint ✓ typecheck ✓ test ✗
Outcome: escalated — 3 identical failures on test
Agent: claude (claude-sonnet-5)

Co-Authored-By: ...
```

Parking the work as a commit rather than leaving a dirty tree matters: a dirty
tree would fail the gate and block that repository for every task behind it.
The wip commit is written with git's plumbing, onto the task branch, without
checking anything out and **without running the repository's hooks** — a
failing pre-commit hook is exactly the situation in which unfinished work most
needs saving. Never a stash, and never `agent/dev`.

**A promotion** — a merge commit on `agent/staging` that names what it carries:

```
promote: 5 tasks from agent/dev

Tasks: 0042, 0043, 0045, 0046, 0048
Gauge: e2e ✓ (promote profile, 14m22s)

Co-Authored-By: ...
```

A side effect worth having — **git becomes a second journal.** If
`runs/journal.jsonl` is ever lost, the history under `refs/heads/agent/` still
says which stage failed, how many attempts there were, what the acceptance pass
concluded, and which tasks went into which batch.

---

## 11. On disk

```
<product>/
  .detent/product.json       composition, branches, gauge, models
  .detent/state.json         per repository: active task, attempt, started at
  tasks/{todo,hold,done,failed}/NNNN-<slug>.md      the queue, where `queue` puts it
  runs/journal.jsonl         append-only, one line per run
  runs/logs/NNNN-attempt-N.jsonl   what the agent printed, as it printed it —
                             not a record, and deleted by `prune` (§5)
  map.json  map.mmd          the relationship map; committed, diffed by a person
  acme-api/ acme-web/ …      the product's repositories
```

The queue lives in the product folder rather than in a documentation
repository, even when one exists. A task moves between folders dozens of times
during a run; in a repository that is noise, and in a repository mounted as a
submodule it is a submodule pointer to move everywhere. Documentation receives
the *decision* a batch of tasks came from — one document, one commit. Churn and
record are different things and belong in different places.

Where in the product folder is the product's to say: `queue` names a path
relative to it, `tasks` by default
([ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).
A session that writes tasks on one machine for a run on another puts the queue
in a repository of its own and points `queue` at it; nothing else about the
queue changes, and the folder it sits in is never taken for a repository of the
product.

### `product.json`

```json
{
  "version": 1,
  "product": { "name": "acme", "summary": "freight marketplace" },
  "branches": {
    "integration": "agent/dev",
    "staging":     "agent/staging",
    "task":        "agent/task-{id}-{slug}"
  },
  "queue": "tasks",
  "docs": "acme-docs",
  "concurrency": 3,
  "attempts": 3,
  "timeout": 30,
  "notify": "notify-send detent \"$DETENT_MESSAGE\"",
  "models": {
    "implement": { "agent": "claude", "model": "claude-sonnet-5" },
    "accept":    { "agent": "claude", "model": "claude-opus-5" }
  },
  "modelSuggestions": ["opus", "sonnet", "haiku", "claude-opus-5"],
  "repos": [
    {
      "name": "acme-api",
      "path": "acme-api",
      "role": "REST API backend, owns the database schema",
      "stack": ["node", "nestjs", "postgres"],
      "compare": "dev",
      "gauge": { "exit": [], "merge": [], "promote": [] },
      "models": {
        "implement": { "agent": "claude", "model": "claude-opus-5" },
        "accept":    { "agent": "claude", "model": "claude-sonnet-5" }
      },
      "neverCommit": ["shared-docs"]
    }
  ],
  "edges": [
    { "from": "acme-web", "to": "acme-docs", "kind": "submodule", "source": "scan" },
    { "from": "acme-web", "to": "acme-api", "kind": "api-contract", "source": "model" }
  ]
}
```

Six things about this shape are deliberate:

- **`queue` is a path inside the product folder, and `tasks` when it is left
  out.** It is validated like `repos[].path`: a value that escapes the product
  folder is refused by name, and so is one inside a repository of the product,
  whose tree a task file moving between folders would dirty. Everything that
  reads, writes, moves or reports a task uses it, printing included, so the
  path in a message is the path on disk. **`docs` names one of the product's
  repositories — the one the documents a task links to are in — and is `null`
  for none.** A name that matches no repository is refused in the same sentence
  an edge pointing at nothing is, and the `null` is written rather than left
  out, because "there are none" is an answer and a re-run of `init` has no
  reason to ask again (§12). These two are the keys
  `init` asks for: the scan cannot see either, so neither is ever guessed.
- **No field can name a human branch.** Every value in `branches` is validated
  against `^agent/` on load and by `doctor`. With two configurable branches the
  guarantee stops being "there is only one field to get wrong" and becomes a
  check, which is the stronger form of the same promise. `compare` is the single
  exception and is read-only: it names the branch `agent/dev` is reported
  against, and nothing else is ever done with it.
- **The schema is strict: an unknown key is an error.** It catches a typo
  instead of silently ignoring it, and it is what lets a field be specified here
  before it is implemented — until the code honours it, the loader refuses it by
  name and points at the version where it arrives. A field that exists and does
  nothing is worse than a field that does not exist.
- **A repository overrides a *role*, never "the model"** — otherwise you could
  not say "expensive implementation in the backend, one reviewer everywhere".
  Above, `acme-api` goes further and names its own reviewer, because the
  product-wide one is the model that repository implements with and the two
  roles must differ (§9).
  A role names its **agent** — `claude`, Claude Code, the one this version
  offers ([ADR 0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)) —
  and optionally a model; without one the CLI's default runs, and the journal
  records which model that was when the CLI says
  ([ADR 0010](docs/adr/0010-three-agent-clis.md)). The field and the list are
  the mechanism 0010 got right and 0018 kept: another agent arrives as a name
  here and a row in the adapter table, once it has run a real task and its
  adapter was written against what it printed.
- **`modelSuggestions` is a suggestion and not a constraint.** It is the model
  names offered where a model is typed — the dashboard's field beside the agent
  select — and **nothing is ever checked against it**: a name that is not on the
  list is accepted, written and run. detent ships a list, `init` writes it into
  the file, and extending it is editing a file the product owns. Present means
  exactly what it says, empty included: a file carrying the key is offered that
  list and nothing else, and a file without it is offered the shipped one. The
  names are ones detent has watched work rather than ones it read about, which
  is also why the list is not a whitelist: nothing detent can reach knows which
  models an account and an installed CLI can run between them — the CLI holds
  no list, the API's needs a credential this product does not have
  ([ADR 0013](docs/adr/0013-the-agent-gets-a-prompt-and-a-directory.md)), and a
  name can be refused by the binary as well as by the plan, so a list that
  refused a model would be wrong for somebody on the day it shipped
  ([ADR 0019](docs/adr/0019-the-offered-model-names-are-a-suggestion-in-the-product-file.md)).
- **Every edge carries its `source`.** Edges established by the deterministic
  scan are drawn plain; edges a model proposed are labelled with their kind, so
  a guess never looks like a fact.

### A journal line

```json
{
  "kind": "task",
  "task": "0042",
  "slug": "wallet-endpoint",
  "repo": "acme-api",
  "started": "2026-10-07T09:12:03Z",
  "finished": "2026-10-07T09:18:43Z",
  "outcome": "passed",
  "attempts": 2,
  "lock": "enforced",
  "gauge": { "profile": "exit", "failedStage": null },
  "models": {
    "implement": { "agent": "claude", "requested": "claude-opus-5", "actual": "claude-opus-5" },
    "accept": { "agent": "claude", "requested": "claude-sonnet-5", "actual": "claude-sonnet-5" }
  },
  "acceptance": { "verdict": "accepted", "doubts": [], "cost": { "usd": 0.06, "tokens": { "input": 21004, "output": 312 } } },
  "rounds": [
    { "attempt": 1, "gauge": { "profile": "exit", "green": true, "failedStage": null },
      "acceptance": { "verdict": "rejected", "doubts": ["no test covers the balance"] },
      "cost": { "usd": 0.18, "tokens": { "input": 90000, "output": 3100 } } },
    { "attempt": 2, "gauge": { "profile": "exit", "green": true, "failedStage": null },
      "acceptance": { "verdict": "accepted", "doubts": [] },
      "cost": { "usd": 0.23, "tokens": { "input": 92044, "output": 3110 } } }
  ],
  "links": { "checked": 3, "broken": ["shared-docs/adr/0003.md"] },
  "cost": { "usd": 0.41, "tokens": { "input": 182044, "output": 6210 } },
  "branch": "agent/task-0042-wallet-endpoint",
  "commit": "a1b2c3d",
  "merged": true,
  "submodules": { "docs": "9f1c0ab…" }
}
```

**`kind` is on every line, never defaulted.** A promotion is a run too, and a
`summary` that counted promotions as task runs would quietly corrupt the pass
rate — the same class of silent corruption the `requested`/`actual` pair below
exists to prevent.

The model that actually ran is recorded alongside the one requested, because a
silent substitution would quietly corrupt every comparison built on this file.

`rounds` is one entry per attempt
([ADR 0023](docs/adr/0023-a-doubt-is-an-attempt-and-every-round-is-recorded.md)):
what the gauge said, what the reviewer said if the attempt reached the
acceptance pass, and what that attempt cost. A round that never reached the
pass has `"acceptance": null`, which is not the same fact as a pass that raised
nothing. **`attempts`, `gauge` and `acceptance` are not computed from it and
hold the last round**, because the journal is appended and never rewritten: no
line written before `rounds` existed has one, so every number reported from
this file goes on reading the flat fields, and a line that has none is a run of
one round, which the task detail draws from them. The duplication is deliberate
and is the price of a file nothing migrates.

`links` says what the task's links turned out to be: how many documents were
looked for at the start of the run, and which of them were not there (§4). It is
always present, like `acceptance.doubts`, because `"checked": 0` is a task that
named no documents and must not read like a task whose documents were all found.
A broken link is a record and never a verdict — the run that reported one can
still be `"outcome": "passed"`.

`submodules` is there only for a product that has a shared context, and says
which commit each tracked submodule was at when the task started — the one
place a record of *which revision of the documents the work was done against*
can be kept by something other than memory. The pointer in the task's commit
says the same thing in git; this says it in the journal, for a run that paused
before it committed anything.

Every run leaves a line, a run the gate skipped included, so the journal is the
whole history; `summary` does not count skipped runs, because no agent was
involved and a dirty tree is not a failure of the model.

Cost is reported **per pass**, never per run: a cheap model that needs three
attempts is not cheap. It is in dollars where the CLI reports dollars and in
tokens always; `usd` is `null` rather than estimated where it does not.

A promotion line is the same shape with `"kind": "promote"`, no `task`/`slug`,
and the batch it carried:

```json
{
  "kind": "promote",
  "repo": "acme-api",
  "started": "2026-10-07T18:40:11Z",
  "finished": "2026-10-07T18:54:33Z",
  "outcome": "passed",
  "tasks": ["0042", "0043", "0045"],
  "gauge": { "profile": "promote", "failedStage": null },
  "branch": "agent/staging",
  "commit": "f9e8d7c",
  "merged": true
}
```

---

## 12. Commands

```
detent doctor       whether this product is in the shape detent expects
detent init         scan the workspace and write product.json
detent plan         discuss a task with an agent; it writes the task files
detent run          work the queue: [id…] [--past ID]
detent promote      merge agent/dev into agent/staging behind the batch gauge
detent summary      pass rate, iterations, cost per pass
detent dashboard    a page that watches this product
detent gauge        run a repository's gauge by hand, outside any run
detent recover      return repositories an interrupted run left behind
detent prune        delete agent/task-* branches already merged into agent/dev
```

`init` runs in three passes, in this order and for a reason:

1. **A deterministic scan** — manifests, submodules, remotes, lockfiles,
   branches, scripts, test files. Cheap, exact, repeatable, no model involved.
   Facts should not be guessed at by something that can be wrong.
2. **A model pass** over that skeleton plus the READMEs, answering only what the
   scan cannot: what each repository is *for*, which relations are real, and
   what the gauge stages should be. Forced to a schema, retried on mismatch.
3. **Validation against the scan.** A repository the model invents is dropped
   rather than written, because a gap is visible and an invention is not.

Before those three, two questions — the first of the two places detent asks
anything itself, and the subsection below is what it asks and what happens when
there is nobody to answer. (The other is `run`, about a task in `hold/`.)

`init` also creates the queue's four folders, `{todo,hold,done,failed}`, if they
are not there: at the path the first question settled, before any of the three
passes, and deterministically, so a folder that exists is left alone and
`--no-agent` creates them too. When that path is somewhere other than the
default, the line that says the queue was created says what it is: a plain
directory nothing can be committed to, or a repository that pushes nowhere, or
nothing at all when the queue is one the next machine can read. `init` reports
it and goes no further — it clones nothing, creates no repository and adds no
remote, because that division is what makes both it and `doctor` safe to run.

`init --no-agent` stops after pass 1 and leaves the model's fields empty for a
person to fill. The tool has to work for someone who has no agent installed,
or the first such person leaves.

Re-running `init` produces a **diff to review**, not a silent overwrite. The
machine proposes, a person accepts.

Passes 2 and 3, as built: the implementing agent is run **read-only** on the
product folder with the scan's skeleton and each README, and must answer one
JSON object — `repos` with a `role` and, only where the scan found nothing to
propose, a `gauge`; `edges` with a `kind`. An answer off the schema is sent
back with its problems, three attempts in all, and then pass 1 is written
alone. Pass 3 drops a repository the scan did not find, an edge to one or to
itself, and a stage that runs a script or make target the repository does not
declare. What survives fills only what pass 1 left empty — a gauge from
declared scripts is never replaced — and an edge is written with
`source: "model"`. The output says which fields came from the model and what
was dropped.

What pass 1 writes, from files and git alone: every git repository directly in
the product folder; `compare` from the branches that exist (`dev`, `develop`,
`main`, `master`, in that order); gauge stages from scripts the repository
already declares — lint, typecheck and test into `exit`, build into `merge`,
run with the package manager its lockfile names — and nothing for a repository
that declares none; every submodule path as `neverCommit`, and an edge with
`source: "scan"` when the submodule is a sibling repository; and agents from
the CLIs on `PATH`, a different one for the review when two are installed.
With a `product.json` already there, the proposal keeps every field a person
wrote, adds only what is new, goes to `.detent/product.proposed.json`, and the
difference is printed.

### `init` asks two questions

Two questions, after the scan and before anything is written, because they are
the two things the scan cannot work out: **which repository holds the queue** —
one meant to hold tasks looks like any other until there are tasks in it, and
at `init` there are none — and **which holds the documents a task's links point
into**, which is whichever one a person decided would hold decisions. Each
lists the repositories the scan found and offers its default by name, so an
answer can be a choice rather than a typed path: a number, a repository name,
or for the queue a path. The queue's default is `tasks` beside the
repositories, the folder `init` creates anyway; the documents' default is
**none**, which is an answer and not an empty one. A repository that holds the
queue *is* the queue, and detent leaves it out of the product (§11,
[ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).

`--queue <path>` and `--docs <name>` answer the same two questions from the
command line, and `--docs none` says there are none. **A flag is an answer, not
a suggestion:** given one, nothing is asked — terminal or no terminal — and it
is what the proposal says.

**With no terminal on stdin, nothing is asked at all.** `init` takes both
defaults, prints what it took and why, and exits as it would have; Ctrl-D is
read the same way, because what it says is "stop asking me". A command that
waits in a pipeline for an answer nobody is there to give is a worse failure
than the assumption the question was added to replace. Every answer is
announced, the defaults included — a person who presses enter is told what they
got — and every answer is written, `"docs": null` included, so a re-run asks
nothing the file already answers
([ADR 0014](docs/adr/0014-init-asks-where-the-queue-and-the-documents-are.md)).

One other command asks, about one other thing: `run`, about a task in `hold/`
(below). Everything else detent does is either its own work or somebody else's
question — `plan` is interactive by handing the terminal to the agent — and
those two are the whole of what reads detent's own stdin, under the one rule
both obey: a question nobody is there to answer is not asked.

`gauge` exists so the gauge is useful before any run does: a person sees exactly
what an agent will be held to — every stage, its time, and for a red one the
output the agent would be handed — before an agent is ever held to it. A
repository with no stages in the profile is reported as having no lock, never
as green.

`doctor` reports each finding as passed (✓), failed (✗), worth a look (!) or
not checkable (·) — condition 8, one person per workspace, is a convention no
scan can see, and is said to be one rather than skipped. A failure is anything
that would stop a run or make it skip a repository, or that leaves the product
in a shape its own `product.json` does not describe; worth a look is anything
that lets a run go ahead with less than it could have: no gauge, no reviewer,
an `agent/dev` that tracks a remote. It exits 1 on a failure and writes
nothing; where there is a command that fixes a finding, it prints the command.

### Six things `doctor` checks beyond the nine conditions

- **the queue exists** — `tasks/{todo,hold,done,failed}` (§11); a product with
  nowhere to put a task is not ready, whatever else the report says. `init`
  creates it, and that is the command the finding prints
- **a configured queue can be published** — a `queue` somewhere other than the
  default was configured so that two machines could share it
  ([ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)),
  and the four folders existing is not that. One that is **not in a git
  repository** is a failure: a task's move is a file move with nothing to
  commit it to, so the queue never leaves this machine and the run that
  believed it published says nothing. One in a repository whose branch
  **tracks no remote** is worth a look and nothing more — a queue nobody can
  fetch has no next machine to be stale for — and it is a different sentence,
  because which of the two a person has decides what they do about it. A queue
  at the default location is asked nothing: that is ADR 0005's file move, and
  the common case gains no line
- **no branch named exactly `agent`** — it makes the whole namespace
  uncreatable, and the error arrives mid-run looking like something else (§2)
- **every value in `branches` matches `^agent/`** — the guarantee that no
  configuration can aim detent at a human branch
- **`gauge.promote` declared with no `branches.staging`** — a declared check
  that nothing ever runs is the same invented green as a missing gauge (§6)
- **every tracked submodule is one everybody else can see** — a submodule
  outside `neverCommit` is a deliberate configuration and is reported as
  tracked, with the note that its pointer is committed with the task once
  verified; what is checked about it is what the run checks before that commit
  (§13) — its checked-out commit against its own remote branches. In none of
  them is a failure naming the submodule, because a run would pause on it. A
  submodule **in** `neverCommit` is detent's to leave alone and has nothing to
  report

### Run, and what it will not start

`detent run [id…] [--past ID]` works `todo/` under the two rules of §8 — and
reads `hold/` before it starts any of it, because the second of those rules
outlives the run that paused a barrier. What a paused barrier bars is above;
what follows is the rest of what `hold/` changes about this command.

**A name that is not in `todo/` is answered by where it actually is**, one
sentence per folder, because paused, already finished and abandoned by hand are
three different things to have typed. A number in none of the four keeps the
old sentence: it is the only one that means the number does not exist.

**A paused task is offered, when there is a terminal to offer it on.** `detent
run <id>` naming one, and a bare `detent run` that found anything in `hold/`,
ask about each in id order: leave it, resume it now, or open `plan` to change
it first. Leaving it is the default and what a pipeline gets. Resuming is a
`moveAndRecord` back to `todo/` — committed and pushed where the queue lives,
and the run goes on exactly as it would have after a hand-moved file. `plan`
opens on that task file where it is, with the outcome and the doubts the last
run recorded and the instruction to change that one file in place; the file
stays in `hold/` while it is being rewritten, and the run stops afterwards and
says what to type next. `plan` ends the run, but it does not withdraw an answer
already given: a task resumed earlier in the same pass has moved, with its
commit and its push, and the closing line says it is queued in `todo/` and was
not started
([ADR 0024](docs/adr/0024-a-barrier-bars-until-it-passes-and-a-resume-is-a-decision-not-a-move.md)).

Nothing else about `run` asks anything: no confirmation before a normal queue,
no prompt on a dirty tree, and no answer is ever remembered — the question is
asked because the answer depends on what the person has just read. And
`todo/` being empty while `hold/` is not is its own sentence: there is work, it
is paused, and that is not the same as having none.

### Prune

`detent prune [repo…] [--dry-run]` deletes `agent/task-*` branches whose every
commit is already on `agent/dev` — a landed task's branch is deleted when it
lands, so what remains is mostly paused work, which prune keeps. It never
touches a branch outside `refs/heads/agent/task-`, the branch that is checked
out, or the branch of a task that is running.

It also deletes the **attempt logs** of settled tasks — those in `done/` and
`failed/`, and those whose task file is in none of the four folders — which is
the stated end of the one artefact detent writes that nothing depends on (§5).
Naming repositories narrows which branches are considered and not which logs: a
log belongs to a task, and its name does not say which repository the task was
for. A queue that will not read keeps every log and says why.

### Plan

`detent plan [brief…] [--agent claude]` — `claude` being Claude Code, the one
agent this version offers
([ADR 0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)) —
opens the agent's own interactive session in the terminal, in the product
folder, with an opening
that gives it the task format of §4, the repositories with their roles and
relations, the next free numbers and the rules — one task per repository,
`touches_contract` only for what others depend on, criteria someone can check —
and asks it to talk the work through before writing anything. Edits are
accepted without asking, because writing task files is the whole job.

When the session ends, detent checks what it left: new and changed tasks in
`todo/` are listed and the queue is validated exactly as `run` will validate
it; a task that would not run is reported and kept; and a change to a
repository, to `product.json` or to a task outside `todo/` is named.

### The dashboard

`detent dashboard [--port 4100]` serves one page on `127.0.0.1` that watches
the product. **It is sections, one shown at a time, and the one shown is named
in the fragment**, so a reload and a copied link both come back to where
somebody was — no server route, and nothing fetched to change section
([ADR 0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)).
The sections are:

- **Overview** — what is happening and what is next, because that is what
  somebody opens the page to find out. **Running now**: which repository, which
  task, which attempt and how long it has been going, from the claim's
  `started` against the read's own clock — or, when nothing is running, a
  sentence saying so, since an empty box reads the same either way. **Next
  up**: the next few of `todo/` in the order a run would take them, which is
  ascending task id, and the line above the table says so; a barrier
  (`touches_contract`) is marked as one, because it runs alone and nothing
  queued past it starts until it has landed (§8). **Waiting for you**: the
  paused tasks with why each stopped — the same rows Queue lists and the strip
  counts, because the strip is a line saying how many and this is the list
  saying which. Then the figures `summary` computes, from the same code: they
  answer "was it worth it", which is a different question from "what now" and
  so reads under those three rather than instead of them. Nothing here is a
  prediction — no estimate of how long a run has left or what it will cost.
- **Repositories** — where each repository's `agent/dev` stands against its
  `compare` branch (identical, behind — agents cannot see your work — or tasks
  ahead, waiting for your review), and the same numbers per repository. Not
  which models it uses: that is read in **Configuration**, which is where it is
  written, and two renderings of one fact are free to disagree.
- **Queue** — all four folders: `todo/`, the paused tasks with why each was
  paused and the reviewer's doubts, the `done/` detent has finished with, and
  the `failed/` a person abandoned. **Each task is a card, not a row.** A
  folder here has about a third of the width, and a row that narrow could not
  hold what the journal already knew about a task — the words "abandoned by
  hand" in `failed/` sat under the height of their own row and were never
  seen. A card is the number and its name on one line, the path under it,
  small, and every fact on a line of its own: the outcome, why it stopped, the
  reviewer's doubts, the branch, and what `Recent runs` says about the same
  journal line — how many attempts, what it cost, when it finished and the
  acceptance verdict. **A card's rows do not wrap**: what is laid out in a row
  stays in one row, and anything longer than a row is a line, so nothing is
  pushed under a fold a row has. **The name is the slug** —
  `0043 · A task is something you can open`, derived where it is drawn, because
  the slug already *is* the name and a second place to keep it is a second
  place to get it wrong; the frontmatter gains no `title`. A task the journal
  has never seen says that, rather than showing dashes that read like zeros.
  `todo/` is in ascending task id, which is the order a run takes it, and the
  line above it says so; `done/` and `failed/` are newest first, by what the
  journal says finished and by the number when it says nothing. **Any column
  sorts on a click**, with the arrow showing which and which way, and the
  choice survives the three-second read — but a sort of `todo/` never changes
  what a run does, which is why that line says the run order whatever the
  order on the screen is. And the section says **how to make a task and how to
  run one**, because the page does neither: the next number, which is one past
  the highest in the four folders, the file in this product's own `todo/` in
  the shape §4 gives, `detent plan` to be talked through it, and `detent run`
  or `detent run <id>` to start it — with this product's own path in the
  command, ready to copy. **It does not run or move tasks**: detent has
  already read this queue and moves these files by its own results, and a
  second writer of them is a bug that arrives later disguised as a mystery.
- **Agents** — runs, passes, attempts and cost per pass, per agent and model.
- **Recent runs** — the last fifteen, newest first.
- **Configuration** — what the file says, read as text, and beside it the keys
  that are shown here and changed on disk. It is also the one thing the page
  writes, on request.

**What is wrong is in none of them.** A run whose process is gone, a paused
task, and a queue that would not parse are drawn above every section on every
read, each naming the section that holds the detail. A single scroll had the
property that everything was somewhere below you; sections mean a person can
be looking at a page that does not contain the thing that is wrong, and
noticing that is the one job the page has.

An absent or unrecognised fragment lands on the first section rather than on
nothing, and nothing rewrites it: a page that corrects the address bar loses
the one thing the fragment was for.

**A task can be opened**, from every table that lists one — `todo/`, the paused
tasks, `done/`, `failed/` and the recent runs — so a link to one task is a link
somebody can send and reload. The head is **a number and a name** —
`0043 · A task is something you can open`, off the slug by the helper the
queue's cards use, with the folder and the path still beside it, small, because
the path is what opens the file and the line above it is not a file name any
more.

**It opens over the section you were on.** The detail is a **drawer**, not a
section of its own: a person is in Queue comparing four folders, opens a task,
and the list has to still be there when they close it — including which row
they were on and which ones they had already looked at
([ADR 0022](docs/adr/0022-the-task-detail-is-a-drawer-over-the-section-you-were-on.md)).
So the section behind it stays rendered and stays where it was, nothing about
it is touched while the drawer is up, and closing returns to it with nothing to
restore because nothing was torn down. It is a drawer and nothing else: the
detail is not also reachable as a section, because two ways to see one task
would be two code paths free to disagree about what a task is.

**The fragment names both**: `#<section>/task/<number>`, which is where the
grammar ADR 0020 established had to grow — a fragment names where you are, and
where you are is now two things. A fragment with no task is the bare section,
exactly as it was. The two parts are read apart and half a fragment opens
nothing: an unknown section with a good number and a good section with a bad
one both **land on a section** by the rule above, and neither is corrected.
`#task/0043` — the shape the detail shipped with as a section — names nothing
now and lands on a section, which is that rule working and is still a link that
used to go somewhere.

**Closing it rewrites the fragment to the bare section.** That is not the
landing rule bending: landing is the page guessing at something somebody typed,
and closing is a person acting on the page — leaving `#queue/task/0043` in the
address bar after they closed it would be the page lying about where they are.
**Escape closes it, and so does a control in its head** that says `Close`,
because a panel covering content with no obvious way back is worse than the
section that got replaced. **On a narrow screen the drawer is the screen** —
the section replacement this exists to avoid, arriving through the viewport
instead of through the navigation; it is the right behaviour there, which means
the improvement is partly a desktop one, and the head it is closed from sticks
to the top so the way out stays reachable. Nothing animates and nothing
transitions. A drawer is a positioned element and a `hidden` attribute: no
router, no second asset, and the same one request.

**It leads with its runs.** What its attempts did is the first block, directly
under the head and before the frontmatter and the body: a person opening a task
that has run wants "what happened and what did it cost", and the body is what
they scroll to when the answer raises a question rather than four blocks to
scroll past before finding out whether it ran at all. Each run shows **what
became of it** — the outcome, how many attempts, how long it ran from `started`
against `finished`, when it stopped, and whether it was **resumed**, because a
task that came back from `hold/` and finished is not the same story as one that
passed first time and the attempt count alone does not tell them apart. Then
**what the implementation cost and what the acceptance pass cost, kept apart**,
each with its tokens and the model it ran on: the name that was requested and,
when the CLI reported a different one, the name it reported — a request the CLI
never confirmed says so rather than standing in for a confirmation. The run's
own total is shown beside those two rather than instead of them, so a line
whose numbers disagree with each other shows that it does; the implementation
figure is the total less the acceptance figure and nothing else is added up to
reach it. Then what the gauge stopped on, whether it merged and as what commit,
what the reviewer said and with which doubts, and whether the task's links
checked.

A run that went round more than once replaces those first three lines with
**one line per round** — which gauge stage sent that attempt back, what the
reviewer said about it, and what the attempt cost — because one run can be red
on the gauge, then green and doubted, then green and accepted, and the attempt
count tells none of those three apart. **A run of one round keeps the lines it
has always had**, and a line with no `rounds` is a run of that shape (§11): the
flat fields hold its one round, so the runs already in a journal are drawn by
the code that drew them. Their cost is the run's cost, already above, and the
same figure twice would read as two.

**Every number there is already in the journal line** (§11) — this reads it and
records nothing — and **a field the line has as `null` is shown as not
reported**, never as a zero and never as a dash among real figures, because
both read as a number and an invented number is the one thing the journal has
always refused. A task the journal has never seen says *that*, in a sentence,
and grows no table of blanks. Nothing here is a rate, an average or a
projection: `summary` and **Agents** are where runs are compared, and this is
one task's record. Under the runs, the body: the frontmatter, the goal, the
acceptance criteria and the out-of-scope, in that order. The sections are the
ones `parseTask` already finds because a run needs them, and the history is the
journal's own lines for that number; nothing is computed here and nothing is
checked again.

**The body is shown as written.** A task body is markdown somebody wrote, and
**detent renders no markdown**: every line of it reaches the page as text, so
nothing in a task file can become markup, and the structure comes from the
parsed sections rather than from a sanitiser this project would have to write
([ADR 0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md),
[ADR 0006](docs/adr/0006-zero-dependencies-node-22.md)).

**What the agent is saying is under it, and is the one part of a task that is
polled.** A person who ran `detent run` has that terminal occupied; this is
where the output of a running task is read, a few seconds behind, which is what
watching is
([ADR 0021](docs/adr/0021-the-agents-output-is-a-stream-written-to-a-file-that-is-not-a-record.md)).
It is the end of the newest attempt's log — read from the same file `tail -f`
would read, on the timer the page already has — and three things keep it from
growing with the run: the page asks to carry on from the byte its last answer
ended at, so it never re-reads what it has; what arrives is kept as a bounded
number of lines, oldest off the top; and each line is clipped, because a tool
result the agent read in full is not a line somebody scans. Each event is read
for display and for nothing else, and a line that will not parse is shown as it
arrived. It lives here and nowhere else: a transcript with no task attached is a
log viewer, which is not what this is for. It **moved with the detail** into the
drawer, and a drawer is where it is drawn rather than a change to how it is
read: the same one timer, the same request, and the same ask to carry on from
the byte the last answer ended at.

**It says which of three states it is in, in a sentence above the lines.** Not
running: what is shown is what the last attempt said, not something happening
now — and a task nothing has ever run says *that* rather than showing an empty
box that could be either. Running and printing: the end of the output, a few
seconds behind. **Running and not printing:** what is running is the gauge, the
acceptance pass or the merge, because none of the rest of a run writes a log
(§5) — so "running" over a tail that has stopped moving is the one thing this
surface must never show, because working and stuck look identical again.

The third sentence is built from facts the page holds and **no phase field
exists to be read**: a claim records a repository, a task, an attempt and a pid
([ADR 0017](docs/adr/0017-a-claim-locks-the-configuration-only-while-its-run-is-alive.md)),
and adding a phase would mean a writer keeping it true through
every branch of a run, including the ones that end badly. What the page has
instead is the claim's attempt against the attempt the log belongs to, whether
the last line that arrived is the agent's result object — the event that says
its turn is over — and how long the file has been quiet, which is its mtime
against the clock. A log that has gone quiet while its attempt is claimed says
so with the time; one that has ended, or belongs to an earlier attempt, or
cannot be found at all while a run holds the task, says that instead.

The task itself is fetched when it is opened and is never polled; `state.json`
carries nothing about it. The number is matched as digits and resolved against the four
folders by file name — it never becomes a path, and nothing outside the queue
is reachable by asking for it. A file that will not parse opens anyway, showing
what it says and naming what is wrong with it, because a task nobody can open
is a task nobody can fix; this is the one place a task outside `todo/` is read
and parsed at all. A number that is in none of the four folders is refused in a
sentence that says so, and a queue that will not read says *that* instead, with
its problems: the detail does not report a task missing from a queue it could
not read. `readQueue` stays all-or-nothing (§4) — the one file is read
directly.

**Nothing in this view writes.** Not moving a task between folders, not editing
a body, not retrying, not unpausing: detent moves tasks by its own results, and
two writers shuffling the same files is a bug that arrives later disguised as a
mystery.

The page loads nothing from outside and sets every value as text, and a status
is always an icon and a word, never a colour alone. Its source is several
modules under `core/dashboard/`, composed at import time; what is served is one
document, one request, and no second asset.

### The dashboard reads a product and writes its configuration between runs

It reads everything and writes one thing: the product's configuration, and
only when no run is active
([ADR 0015](docs/adr/0015-the-dashboard-may-write-the-configuration-between-runs.md)).
`GET` and `HEAD` serve the page, the snapshot, the configuration, one task and
the end of what that task's agent is printing; `POST /configuration.json` is
the one write, and every other method gets `405`.

**The page reads the configuration, and writes it on request.** Viewing is the
default and shows what the file says as text — each model, each limit, and
what a repository inherits with whose setting it is inheriting. The editor is
entered deliberately and leaving it discards; nothing is written but by the
one write above
([ADR 0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)).
**Reading is not what a run stops.** A run refuses the editor and never the
view: somebody who opens the page during a run to see which model is costing
what finds the answer, which is the whole of the separation. **The view may
refresh; an open editor never does** — opening it takes a read of its own, so
what is edited is what the file currently says, and from then until it closes
nothing moves under the person typing. A write the server refuses leaves the
editor open with what was typed still in it and the problems against their
paths.

What may change is the models for each role — product-wide and per repository —
`attempts`, `timeout`, `concurrency` and `notify`. Not `repos`, not `queue`,
not `docs`, not `branches`: those name things on disk, and a page cannot create
what it names, so they are shown with the reason they are not editable there.
Not `modelSuggestions` either: the model field offers that list, accepts any
name, and says where the list is — it is shown and used on the page and
extended in the file (§11).

Three things hold every write.

- **A run is active, and the write is refused** — by the same `state.json`
  `recover` reads, naming which repository is on which task. The page refuses
  to open its editor as a courtesy, with that explanation beside the disabled
  button, and the server refuses the write regardless: the files that judge an
  agent are fingerprinted before each of its turns (§5), and that guard does
  not ask who changed one, so a write during a run would pause the task
  blaming the agent for a person's edit.
- **The whole file validates, through `validateProduct`** — the same code
  `loadProduct` uses, every problem at once, each naming its path, and nothing
  written if any of them fails. A page cannot write a `product.json` that
  `detent run` would refuse to load.
- **The request came from the page** — `origin` naming this server and
  `content-type: application/json`, neither of which a form on another site
  can produce. Binding `127.0.0.1` stops meaning anything once a server
  accepts a write, because any site open in the same browser can post to
  localhost. It is not authentication and is not meant to be: one person per
  workspace is condition 8.

The file keeps the shape `init` writes it in, the keys the page does not touch
keep their values and their order, and what the page shows after a write is
read back off disk. There is no queue of changes applied later: a change
accepted and not yet applied is a third state between what the file says and
what the page shows, and the page exists to say what is true.

The queue still cannot be edited during a run: detent has already read it and
moves tasks by its own results. Two writers shuffling the same files is a bug
that arrives later disguised as a mystery.

---

## 13. Rules that are not configurable

- **Never write a ref outside `refs/heads/agent/`.** One predicate, checked on
  every write path, rather than a prefix convention remembered in several
  places.
- **Push the queue, and nothing else.** detent merges into a local `agent/dev`
  and stops: someone's CI deploys from the branch you did not expect. The queue
  is the exception, and only when it lives in a repository — a task moving to
  `done/`, to `hold/` or back to `todo/` on a resume a person asked for is
  detent's own bookkeeping, not anybody's work, and a
  queue that is never pushed is a queue the next machine reads stale
  ([ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).
  Never a product repository, never `agent/dev`, never a tag. A push that fails
  ends the run, rather than piling up work nobody else can see.
- **Commit a submodule pointer only where it is verified** (`neverCommit`).
  Moving a pointer without pushing the submodule leaves everyone else with a
  reference to nowhere — so the pointer is checked rather than forbidden.
  Before a task's commit, every submodule outside `neverCommit` has its
  checked-out commit looked for in its own remote branches
  (`git branch -r --contains HEAD`, empty exactly when the commit was never
  pushed). Empty pauses the task and names the submodule; it never drops the
  pointer quietly, because a commit saying the agent read revision X when it
  read Y is the unchecked claim this whole project is against. A submodule in
  `neverCommit` is not fetched, not moved and not committed.
- **Never resolve a merge conflict.** `merge --abort`, escalate, let a person
  look at it.
- **Never work in a dirty repository.** Skip it, say so, continue elsewhere.
  Stashing is how work gets lost.

---

## 14. Build order

By what the rest depends on, not by what is most interesting.

1. `product.json` + task reading + frontmatter validation
2. the gauge and the lock — *useful on their own, before any run exists*
3. the gate, `state.json`, unconditional return, `recover` — **tests live here**
4. one task from file to commit on a task branch, sequentially
5. merge into `agent/dev`, with abort on conflict
6. journal + `summary` — *numbers start existing*
7. `doctor` and `init` pass 1 — *the deterministic scan is the same code in
   both: one checks the nine conditions with it, the other writes
   `product.json` from it*
8. `dashboard` — reading what already exists
9. the scheduler: repository occupancy and barriers
10. `promote`: `agent/staging`, the batch profile, the promotion journal line —
    and `doctor` gains its staging checks here
11. the acceptance pass
12. `init` pass 2 — the model pass and its schema
13. `plan`

End to end after 6. Worth showing after 8.

`branches.staging` and `gauge.promote` were specified (§7) in 0.0.2 and
**refused by the loader by name** until step 10 accepted them: specified before
accepted, accepted before advertised. `PROGRESS.md` says where the build is.

---

## 15. Deliberately not here

Named so they read as decisions rather than gaps.

- **Worktrees.** One task per repository instead. Worktrees would allow two, at
  the cost of installing dependencies per worktree — hundreds of megabytes per
  task on a typical Node repository — and of a second working copy's worth of
  environment. The price buys parallelism inside a repository that a product of
  eight repositories does not need.
- **Zones.** They only make sense with worktrees.
- **Bisecting a red batch.** When a promotion fails, the combination is at
  fault and the individual tasks were all green. Finding the culprit means
  replaying subsets of a batch, which is a build system, not a dispatcher. The
  journal says which batch went red and which tasks were in it; a person reads
  it (§7).
- **Multiple people on one workspace.** Two dispatchers merging into one
  `agent/dev` need a lock and per-person integration branches. Later, honestly,
  rather than half-done now.
- **Windows.** WSL or neither.
- **Anything that is not git.**
- **Task import from an issue tracker.** The task file is the prompt; a Jira
  description is not one yet.
- **Skills, hooks and settings passed to the agent.** detent spawns a CLI
  with a prompt and a working directory. Every agent it drives can be given
  more than that, and each in its own shape, so passing any of it means
  either privileging one CLI or writing the most load-bearing code in the
  product three times. A kit repository is a tracked submodule and is worth
  what the agent reads out of it
  ([0013](docs/adr/0013-the-agent-gets-a-prompt-and-a-directory.md)).
