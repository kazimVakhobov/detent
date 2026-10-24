# detent

**Run coding agents against a queue of tasks, and let nothing finish until your
own checks pass.**

detent dispatches Claude Code at one task at a time, holds it behind the
repository's own gauge on the way out, has a second model read every green diff,
merges what survives into a branch of its own — and writes down what each run
cost in attempts, time and money.

The constraints are in the code, not in the prompt.

> A detent is the catch that holds a mechanism in a defined position until it is
> deliberately released. Here it is released by a green gauge, and by nothing
> else.

```
npm i -g @kazimvakhobov/detent
```

Node 22, macOS or Linux, and Claude Code installed and signed in. detent drives
the agent you already pay for and ships none of its own. Zero dependencies.

## The three claims

**When is the agent allowed to stop?** Not when it says it is done — when the
project's checks pass. The gauge runs on the agent's way out; red means it does
not get to leave, and it is handed the failure text to work from.

**Was it worth it?** Every run is a line in a journal: which model, how many
rounds it took, which stage it died on, how long, how much. That turns "which
model should run this repository" from an opinion into a number.

**Who says it is done?** A second model reads the diff against the task's
acceptance criteria, and it may **demote, never approve**. Green is granted by
machine checks. A model's judgement can only raise a doubt — which costs the
agent another round, and on the last one sends the task to a person. Otherwise
"proven" quietly becomes "a second model agreed".

## It builds itself, and here are its numbers

Since 2026-10-13 the tasks in this repository have been dispatched by
`detent run`, held behind the gauge, read by the acceptance pass and merged by
the tool. `git log --grep='^Acceptance: '` is the record, and nobody typed those
trailers by hand.

| From this repository's own journal | |
|---|---|
| Runs recorded | 39 |
| Pass rate | 72% |
| Cost per task that landed | $10.52 |
| Green runs the reviewer read | 36 |
| …of those, demoted | 22% |

That last row is the number the product exists to produce: **almost a quarter of
the runs whose machine checks were green had not actually done the task.** Every
one of those was a person's hour that a passing test suite would have told
nobody about.

The task files are still written by a person, and so is everything past
`agent/dev`: the pull request, the tag, the release.

## How a run goes

A task is a markdown file. The frontmatter is bookkeeping; **only the body
reaches the agent** — the spec written before the work is the prompt.

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

Save it as `tasks/todo/0001-wallet-endpoint.md` and run `detent run`. Then, for
up to `attempts` rounds (default three):

1. **the agent's turn** — a prompt and a working directory, and nothing else
2. **the exit gauge** — the repository's own checks. Red hands back the failure
   text and costs one round
3. **the acceptance pass** — a second model reads the diff. A doubt hands back
   the doubt and costs one round, the same budget the gauge spends

Green and undoubted, the task lands on `agent/dev` as one merge commit carrying
what it cost. Out of rounds, or a conflict, or a broken run, and the task moves
to `tasks/hold/` with its branch kept and the work parked on it — and you are
told, through whatever channel you configured. **Resuming is moving the file
back**, and the next run hands the agent what stopped the last one.

Nothing has touched a branch of yours.

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
your product is ever pushed — not `agent/dev`, not a tag. A queue that lives in
a repository of its own is the exception, because that queue is detent's own
bookkeeping and the next machine has to read it as it is now
([ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)).

`agent/staging` is optional and exists for one reason: the per-task gauge checks
a task, and what actually breaks is the combination. The batch gauge runs there,
and how often a batch came out red after every task in it was green is a number
detent reports.

## Setting up a product

**A product folder is not the folder your repositories happen to sit in.**
detent treats everything directly inside it as one product, so give it a folder
of its own:

```
~/work/acme/
  .detent/product.json      written by init
  tasks/{todo,hold,done,failed}/
  acme-api/                 a full clone, on any branch
  acme-web/
```

Then, from that folder:

```
git -C acme-api branch agent/dev dev    # the integration branch
detent init                             # scan, then ask what a scan cannot see
detent doctor                           # the nine conditions, and what to change
```

`init` asks you the two things no scan can settle — which repository holds the
queue, and which holds the documents your tasks link to. They are the only
questions it asks; `--queue` and `--docs` answer them from the command line, and
with no terminal on stdin the defaults are taken and printed, so `init` in a
script never waits.

Read the two things it cannot decide for you before an agent is held to them:

- **the gauge.** Stages are proposed only from scripts a repository declares, so
  what you get is what the repository advertises, not what you would have
  chosen. `detent gauge` runs them by hand, and `doctor` says when a repository
  declares a check the gauge does not run.
- **`models.accept`.** Left empty, there is no acceptance pass at all, and
  `init` leaves it empty: it must name a different model from `implement`.
  Which models your account can run is not something a scan can see, so the line
  is yours to write
  ([ADR 0019](docs/adr/0019-the-offered-model-names-are-a-suggestion-in-the-product-file.md)).

## The commands

| | |
|---|---|
| `detent doctor` | whether this product is in the shape detent expects |
| `detent init` | scan the workspace and write `product.json` |
| `detent plan` | discuss a task with an agent; it writes the task files |
| `detent run` | work the queue |
| `detent promote` | merge `agent/dev` into `agent/staging` behind the batch gauge |
| `detent summary` | pass rate, rounds, cost per pass |
| `detent dashboard` | a page that watches this product |
| `detent gauge` | run a repository's gauge by hand |
| `detent recover` | return repositories an interrupted run left behind |
| `detent prune` | delete `agent/task-*` branches already merged |

Every command in `detent --help` does something.

The dashboard watches a run while it happens — what the agent is saying as it
says it, what each round of each task did and what it cost, and the
configuration, which it will write back between runs. It listens on 127.0.0.1
only and loads nothing from anywhere else.

## This product is opinionated

It expects a product shaped a particular way, and says so instead of adapting
to everything:

1. git, not a shallow clone
2. the product's repositories sit side by side in one folder — one per unit of ownership
3. each repository names one human branch to be compared against (any name) — a
   release train behind it is not detent's business
4. the gauge is declared as stages: a name and a command, runnable locally
5. a clean tree when a run starts
6. an agent CLI installed and authenticated — Claude Code, the only one offered
   in this version ([0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md))
7. the integration branch is not deployed; pushing is done by hand
8. one person per workspace
9. macOS or Linux, Node 22

`detent doctor` checks all nine and tells you what to change.

## Status

**Status: 0.9.0 — all thirteen build steps are done.** Every command listed above
works. What 1.0.0 still wants is a real batch of tasks run against a real
product that is not this one. [PROGRESS.md](PROGRESS.md) says where the build
is.

## Where to read more

- [DESIGN.md](DESIGN.md) — the specification the code is written against: the
  branch boundary and the invariant that guards it, the task lifecycle with
  every outcome it can have, the shape of `product.json` and of a journal line,
  and what is deliberately left out. Written before the code, which is also how
  detent expects tasks to be written.
- [docs/adr/](docs/adr/) — twenty-six decisions, each with what it rejected and
  what that cost
- [CONTRIBUTING.md](CONTRIBUTING.md) — branches, commit format, how a release is
  cut
- [PROGRESS.md](PROGRESS.md) — where the build actually is
- [CHANGELOG.md](CHANGELOG.md)

## License

MIT
