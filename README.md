# detent

**Autonomy bounded by a machine-checkable gauge, and measured.**

A detent is the catch that holds a mechanism in a defined position until it is
deliberately released. Here it is released by a green gauge — the project's own
checks — and by nothing else.

> **Status: 0.7.0 — all thirteen build steps are done.** `detent run` takes
> tasks from a queue to `agent/dev` with Claude Code behind the gauge, and `detent summary` reports what it cost; a second model reads
> every green diff and may send it back, never wave it through; `init` asks
> where the queue and the documents are and writes `product.json` from a scan,
> `doctor` says what to change, and `dashboard` serves a page that watches it
> all, opens any task to show what it was asked and what its attempts did,
> shows what a running agent is saying while it says it, and writes the
> configuration back between runs; tasks in different
> repositories run side by side, `promote` checks a whole batch on
> `agent/staging`, `plan` talks a task through with an agent and
> checks the files it writes, and `prune` clears the task branches whose work
> has landed and the transcripts of the tasks that are finished with. The queue may be a repository of its own, and the documents an
> agent reads are brought to their remote's tip before a task starts and
> recorded at the revision it read. Every command in `detent --help` does
> something. What 1.0.0 still wants is a real batch of tasks run against a real
> product. [PROGRESS.md](PROGRESS.md) says where the build is.

## What it does

Runs coding agents against a queue of tasks, refuses to let them finish while
the project's own checks are red, and writes down what every run cost in
attempts, time and money.

The constraints are in the code, not in the prompt.

**When is the agent allowed to stop?** Not when it says it is done — when the
project's checks pass. The gauge runs on the agent's way out; red means it does
not get to leave, and it is handed the failure text to work from. Three attempts, then the task is paused and
you are told — not a fourth attempt, and not a verdict nobody has looked at.

**Was it worth it?** Every run is a line in a journal: which model, how many
times it hit red, which stage it died on, how long, how much. That turns "which
model should run this repository" from an opinion into a number.

**Where the boundary is.** The acceptance pass runs on a second model and can
*demote, never approve*. Green is granted by machine checks; a model's
judgement may only raise a doubt and send the task to a person. Otherwise
"proven" quietly becomes "a second model agreed".

## Getting started

```
npm i -g @kazimvakhobov/detent
```

Node 22, and Claude Code installed and signed in. detent drives the agent you
already pay for and ships none of its own. Codex and a Google agent are
planned and not offered yet: an agent is added when it has run a real task,
not when its adapter has been written
([0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)).

**A product folder is not the folder your repositories happen to sit in.**
detent treats everything directly inside it as one product, so give it a folder
of its own and put the repositories it dispatches to inside:

```
~/work/acme/
  .detent/product.json      written by init
  tasks/{todo,hold,done,failed}/
  acme-api/                 a full clone, on any branch
  acme-web/
```

Then, from that folder:

```
git -C acme-api branch agent/dev dev    # integration branch, off the one it is compared against
detent init                             # scan, then ask the agent what a scan cannot see
detent doctor                           # the nine conditions, and what to change
```

`init` reads the repositories, asks you two things no scan can settle — which
repository holds the queue, and which holds the documents your tasks link to —
creates the queue, and asks the implementing agent, read-only, about what it
could not determine; `--no-agent` stops after the scan. The two questions are
the only ones detent asks: `--queue <path>` and `--docs <name>` answer them
from the command line, and with no terminal on stdin they are not asked at
all — the defaults are taken and printed, so `init` in a script never waits.
Read the two things it cannot decide for you before an agent is held to them:

- **the gauge.** Stages are proposed only from scripts a repository declares, so
  what you get is what the repository advertises, not what you would have
  chosen. `detent gauge` runs them by hand.
- **`models.accept`.** Left empty, there is no acceptance pass at all, and
  `init` leaves it empty: it must name a different model from `implement`, and
  with one agent offered that means a different model of Claude Code — which
  models your account can run is not something a scan can see, so the line is
  yours to write. The names to choose from are in the file `init` just wrote:
  `modelSuggestions` is a list detent has watched work, offered on the
  dashboard where a model is typed and yours to extend. It is a suggestion and
  never a constraint — nothing checks a model against it
  ([ADR 0019](docs/adr/0019-the-offered-model-names-are-a-suggestion-in-the-product-file.md)).

`doctor` answers `ready` when the shape is right. Then write a task. The
frontmatter is bookkeeping and **only the body reaches the agent** — the spec
written before the work is the prompt:

```markdown
---
id: 0001
repo: acme-api
touches_contract: false
---

# Goal

One paragraph: what must work when this is done.

# Acceptance criteria

- [ ] a checkable statement

# Out of scope

What not to do while you are in there.
```

Save it as `tasks/todo/0001-wallet-endpoint.md`, and:

```
detent run
```

The agent works on `agent/task-0001-wallet-endpoint`, the gauge runs on its way
out, and a green task lands on `agent/dev` as one merge commit carrying what it
cost. `detent summary` reports the numbers, `detent dashboard` serves a page
that watches them — including what the agent is saying while a task runs, and,
between runs, changes which model does what and how long it gets — and nothing
has touched a branch of yours.

A run also prints a path when each task starts, so the same output is a
`tail -f` away in another terminal:

```
0001  acme-api  wallet-endpoint  …
      tail -f /path/to/product/runs/logs/0001-attempt-1.jsonl  (one per attempt, up to -attempt-3)
```

One file per attempt, and only the agent's own turn writes one: the gauge, the
link check, the acceptance pass and the merge print nothing there. So a task can
be running with nothing arriving, and the dashboard says that rather than
showing a line that has stopped moving under the word "running".

## The line agents do not cross

```
       human                   │                     agents
  ─────────────────────────────┼──────────────────────────────────────────
  dev → staging → main         │   agent/task-<id>-<slug>
  feature/*, hotfix/*          │         │ merge, when the gauge is green
                               │         ▼
                               │   agent/dev
                               │         │ promote, when the batch is green
                               │         ▼   (optional)
                               │   agent/staging
                               │
  dev → agent/dev  ────────────┼──→  here is my work, take it into account
  agent/staging → dev  ←───────┼───  I accept yours
```

detent reads and writes refs under `refs/heads/agent/` and nothing else — one
namespace, one predicate, one glob to audit it with. Both gates between the
territories are human operations, in both directions. It refuses to start on a
dirty tree, and never moves a ref outside its own namespace.

**What it pushes is the queue, and only the queue.** Nothing in a repository of
your product is ever pushed — not `agent/dev`, not a tag. The exception is for
a queue that lives in a repository of its own, which is how a session writes
tasks on one machine for a run on another: there a task reaching `done/` or
`hold/` is a commit and a push, because that queue is detent's own bookkeeping
and the next machine has to read it as it is now
([ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).
A product that says nothing about `queue` has no repository there and detent
pushes nothing at all. A `queue` that names a path with no repository at it, or
one in a repository that pushes nowhere, is said by `init` as it creates the
folders and reported by `doctor` — the first as a failure, since that queue
never leaves the machine it was written on, and the second as worth a look,
since a queue nobody can fetch has no next machine to be stale for. Neither
command clones anything: they report, and you decide.

`agent/staging` is optional and exists for one reason: the per-task gauge checks
a task, and what actually breaks is the combination. The batch gauge runs there,
and how often a batch came out red after every task in it was green is a number
detent reports.

## This product is opinionated

It expects a product shaped a particular way, and says so instead of adapting
to everything:

1. git, not a shallow clone
2. the product's repositories sit side by side in one folder — one per unit of ownership
3. each repository names one human branch to be compared against (any name) — a
   release train behind it is not detent's business
4. the gauge is declared as stages: a name and a command, runnable locally — the
   per-attempt profile in seconds
5. a clean tree when a run starts
6. an agent CLI installed and authenticated — Claude Code, the only one offered
   in this version ([0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md))
7. the integration branch is not deployed; pushing is done by hand
8. one person per workspace
9. macOS or Linux, Node 22

`detent doctor` checks all nine and tells you what to change.

## Design

[DESIGN.md](DESIGN.md) is the specification the code is being written against:
the branch boundary and the invariant that guards it, the task lifecycle with
every outcome it can have, the shape of `product.json` and of a journal line,
what the gauge is and why it has three profiles, and what is deliberately left
out.

It is written before the code rather than after it, which is also how detent
expects tasks to be written.

## How this repository is built

The method the tool enforces, applied to the tool. Nothing reaches `dev`,
`staging` or `main` except through a pull request with a green gauge; decisions
are recorded with the alternatives they displaced; and progress is a table the
gauge refuses to let lie.

- [CONTRIBUTING.md](CONTRIBUTING.md) — branches, commit format, how a release is cut
- [docs/adr/](docs/adr/) — twenty-two decisions, each with what it rejected and what that cost
- [PROGRESS.md](PROGRESS.md) — where the build actually is, against the build order
- [CHANGELOG.md](CHANGELOG.md)

detent builds itself as far as `agent/dev`. Since 2026-10-13 the tasks in this
repository have been dispatched by `detent run`, held behind the gauge on the
way out, read by the acceptance pass and merged by the tool —
`git log --grep='^Acceptance: '` is the record, and nobody typed those trailers
by hand. The task files are still written by a person, and so is everything
past `agent/dev`: the pull request to `dev`, the tag, the release.

## License

MIT
