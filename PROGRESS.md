# Progress

One row per step of the build order in [DESIGN.md §14](DESIGN.md#14-build-order),
in dependency order rather than in order of interest.

This file is a claim about what exists, so the claim is checked:

> **A step is `done` only when it names a proof that exists** — normally the
> test that holds it. `scripts/check-progress.mjs` runs inside `npm run verify`
> and fails the gauge if a row claims `done` without a proof or a date, if the
> file it names is missing or empty, or if the table has drifted from the build
> order it tracks. A progress table nobody checks is exactly the invented green
> this project exists to refuse.

## Where the build is

| # | Step | State | Proof | Date |
|---|---|---|---|---|
| 0 | the name, the CLI skeleton, the repo's own gauge, the specification | done | `test/cli.test.mjs` | 2026-10-03 |
| 1 | `product.json` + task reading + frontmatter validation | done | `test/product.test.mjs`, `test/task.test.mjs` | 2026-10-06 |
| 2 | the gauge and the lock — useful on their own, before any run exists | done | `test/gauge.test.mjs` | 2026-10-06 |
| 3 | the gate, `state.json`, unconditional return, `recover` | done | `test/workspace.test.mjs` | 2026-10-06 |
| 4 | one task from file to commit on a task branch, sequentially | done | `test/run.test.mjs`, `test/agents.test.mjs` | 2026-10-06 |
| 5 | merge into `agent/dev`, with abort on conflict | done | `test/run.test.mjs` | 2026-10-06 |
| 6 | journal + `summary` | done | `test/journal.test.mjs`, `test/run.test.mjs` | 2026-10-06 |
| 7 | `doctor` and `init` pass 1 — the deterministic scan they share | done | `test/init.test.mjs`, `test/doctor.test.mjs` | 2026-10-06 |
| 8 | `dashboard` — reading what already exists | done | `test/dashboard.test.mjs` | 2026-10-06 |
| 9 | the scheduler: repository occupancy and barriers | done | `test/scheduler.test.mjs` | 2026-10-06 |
| 10 | `promote`: `agent/staging`, the batch profile, its journal line | done | `test/promote.test.mjs`, `test/doctor.test.mjs` | 2026-10-06 |
| 11 | the acceptance pass | done | `test/acceptance.test.mjs` | 2026-10-06 |
| 12 | `init` pass 2 — the model pass and its schema | done | `test/model-pass.test.mjs` | 2026-10-07 |
| 13 | `plan` | done | `test/plan.test.mjs` | 2026-10-07 |

States are `todo`, `wip`, `done`. Step 3 is where the tests live: it holds the
invariant that every exit leaves the repository on `agent/dev` with a clean tree
and moves no ref outside `refs/heads/agent/`.

## Milestones

| | |
|---|---|
| **end to end** | after step 6 — a task goes from a file to a commit on `agent/dev`, and the journal says what it cost |
| **worth showing** | after step 8 — there are numbers, and a page that displays them |
| **self-hosting** | reached **2026-10-13** with task 0026, commit `f9b97b5` — the first time detent ran a task in this repository instead of a person running it by hand. The proof is this repository's own history: `git log --grep='^Acceptance: ' --date=short --pretty='%h %ad %s'` lists every task detent has worked here and the date each one landed, and every commit it names carries the `Task:`, `Gauge:`, `Agent:` and `Acceptance:` trailers [DESIGN.md §10](DESIGN.md#10-commits) specifies, none of which a person typed |
| **another product** | reached **2026-10-23** on [Yuk Markaz 24](https://yukmarkaz24.uz), a freight marketplace in production — eleven tasks of its queue dispatched by `detent run`: thirteen runs across three of that product's seven repositories, 85% passed at $7.64 for a task that landed. One task spent all three attempts, stopped on a merge conflict in the API contract and passed when it was resumed; one green diff was refused outright by the acceptance pass, and two more were accepted on a round after a doubt. That product's own journal is the record, and none of those numbers come from this repository. [QMed](https://qmed.uz) is set up the same way — seven repositories, twelve edges, twelve tasks queued — and has had no run dispatched at it yet |

## Versions

`0.0.x` is the skeleton and holds the name. `0.0.0-stage` and `0.0.1` are on npm
as `@kazimvakhobov/detent` and not installable for any purpose; `0.0.2` was
tagged but its publish step failed, so the registry never served it. `0.3.0` is
the first version that is installable — `0.1.0` and `0.2.0` were cut here and
never tagged, so the registry goes from `0.0.1` to it.

| Version | Means |
|---|---|
| `0.1.0` | end to end — step 6 |
| `0.2.0` | worth showing — step 8 |
| `0.3.0` | all thirteen steps — the build order is complete |
| `1.0.0` | all thirteen steps, and a real batch of tasks run against a real product — **cut 2026-10-28**, on the thirteen steps and the Yuk Markaz 24 batch above |

## detent builds itself, as far as agent/dev

Until step 6 there was nothing to dispatch with, so the branch model, the commit
format and the acceptance of work were followed **by hand** — by a person and an
agent in a session, under the same names and the same rules the tool would use.
That ended on 2026-10-13. Since task 0026, work here is dispatched by `detent
run`, held behind the gauge on its way out, read by the acceptance pass and
merged onto `agent/dev` by the tool. The pass has sent one task back, which is
why 0027 appears twice in the history the milestone names — once rejected, once
merged.

**The names did not change when it flipped.** `agent/dev` was already the
integration branch, `agent/task-<id>-<slug>` was already the shape of a task
branch, and `npm run verify` was already the gauge. What changed is who types
the commands, and that is the point: a process that only works when a person is
careful is not the process this project is about.

**As far as `agent/dev` and no further.** detent reads and writes refs under
`refs/heads/agent/` and nothing else. It has opened no pull request, placed no
tag, and moved neither `dev`, `staging` nor `main`; that boundary is the product
rather than a part of it left unfinished. Still a person's, and not on a list of
things to automate: writing the task file — `detent plan` exists and has not
been used here — reading what lands on `agent/dev`, opening the pull request
that carries it to `dev`, and cutting the release.
