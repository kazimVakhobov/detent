# detent

**Autonomy bounded by a machine-checkable gauge, and measured.**

A detent is the catch that holds a mechanism in a defined position until it is
deliberately released. Here it is released by a green gauge — the project's own
checks — and by nothing else.

> **Status: 0.4.1 — all thirteen build steps are done.** `detent run` takes
> tasks from a queue to `agent/dev` with Claude Code, Codex or Gemini CLI behind
> the gauge, and `detent summary` reports what it cost; a second model reads
> every green diff and may send it back, never wave it through; `init` writes
> `product.json` from a scan, `doctor` says what to change, and `dashboard`
> serves a page that watches it all; tasks in different repositories run side by
> side, `promote` checks a whole batch on `agent/staging`, `plan` talks a task
> through with an agent and checks the files it writes, and `prune` clears the
> task branches whose work has landed. Every command in `detent --help` does
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

Node 22, and one of Claude Code, Codex or Gemini CLI installed and signed in.
detent drives the agent you already pay for and ships none of its own.

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

`init` reads the repositories, creates the queue, and asks the implementing
agent, read-only, about what it could not determine; `--no-agent` stops after
the scan. Read the two things it cannot decide for you before an agent is held
to them:

- **the gauge.** Stages are proposed only from scripts a repository declares, so
  what you get is what the repository advertises, not what you would have
  chosen. `detent gauge` runs them by hand.
- **`models.accept`.** Left empty, there is no acceptance pass at all. It must
  name a different model from `implement` — a different CLI if you have one, and
  at minimum a different model of the same one.

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
that watches them, and nothing has touched a branch of yours.

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
pushes nothing at all.

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
6. an agent CLI installed and authenticated — Claude Code, Codex or Gemini CLI
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
- [docs/adr/](docs/adr/) — twelve decisions, each with what it rejected and what that cost
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
