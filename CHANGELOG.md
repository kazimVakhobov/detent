# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions mean what
[`PROGRESS.md`](PROGRESS.md) says they mean.

## Unreleased

### Added

- **The shared context is brought up to date, and the pointer is recorded.**
  Before an agent's first turn, every submodule of its repository that is not
  in `neverCommit` is fetched and moved to its remote's tip, and the journal
  line says which commit each one landed on: the agent reads the documents as
  of the moment its task started, and the run's record says what that was. The
  pointer that results is committed with the task and reaches `agent/dev` with
  it — the prohibition in `DESIGN.md` §13 became a check, since a pointer
  without a pushed submodule is a reference to nowhere. Before the commit, each
  tracked submodule's commit is looked for in its own remote branches; one that
  is in none of them pauses the task, names the submodule and says it has
  commits nobody else can see, and that run commits no pointer anywhere, not
  even in what it parks. A submodule that stays in `neverCommit` is not
  fetched, not moved and not committed, down to the sentence the prompt gives
  the agent about it; a product that mounts nothing is unaffected. The second
  part of
  [ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md).
- **detent pushes the queue, and nothing else.** When the queue lives in a git
  repository, a task reaching `done/` or `hold/` is a commit there naming the
  task — only the two files the move touches, leaving whatever else the person
  has staged alone — pushed to the branch's own upstream and nowhere else. Not
  a product repository, not `agent/dev`, not a tag; `assertAgentRef` goes on
  guarding every ref in every repository of the product. A queue that is not in
  a repository moves the file and commits nothing, exactly as before, and a
  queue repository with no remote is committed and not pushed — there is no
  next machine to be stale for. A push that fails, or a commit that repository
  refuses, ends the run with what failed and names the tasks it did not start,
  rather than working on with a queue the next machine cannot see; the run that
  hit it still leaves its journal line first. The third part of ADR 0012, and
  the first time detent writes outside `refs/heads/agent/`.
- `queue` in `product.json`: where the four folders of the queue live, as a
  path relative to the product folder, `tasks` when it is left out. Validated
  like `repos[].path` — a value that escapes the product folder is refused by
  name, and so is one inside a repository, whose tree a task file moving
  between folders would dirty — and used by everything that reads, writes,
  moves or reports a task,
  what the tool prints included, so a product with
  `"queue": "agent-loop/tasks"` is never told about `tasks/todo/`. `init`
  creates the folders there, `doctor` looks for them there, and the scan does
  not take the folder the queue lives in for a repository of the product,
  whatever it is called. A product that says nothing behaves exactly as before.
  The first of the three parts of
  [ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md).

### Fixed

- A missing `.detent/product.json` explains itself. The one-line answer was
  right and useless to its most likely reader, who has not met the tool: the
  message now says what the file is for, draws the folder it belongs in, names
  the repositories it can see from where it was pointed, and ends in the
  command to run. Three situations get three answers — standing in the product
  folder, standing inside a clone, and standing somewhere with nothing in it —
  and the clone one is still careful never to name the parent directory as the
  fix, since that is usually a projects directory and following it would build
  one product out of everything in it. `ConfigError` carries an optional hint
  for this: problems stay a list, prose comes after them.
- `detent init` on a `product.json` somebody broke says `is not valid JSON`
  and where to go from there, instead of a `SyntaxError` and a stack trace.
  It read the file with a bare `JSON.parse` while every other command went
  through the loader that has always reported this properly — and the path to
  it is the ordinary one: edit the file by hand, misplace a comma, re-run
  `init` to regenerate.
- A run of `detent init` that finds nothing to propose still reports. The
  early exit on "already says everything the scan found" was taken before the
  notes were printed, so a failed model pass, a repository with no gauge
  stages and a missing `models.accept` were all swallowed behind a sentence
  that reads like success.
- What `init` says is installed comes from the scan rather than from what
  `product.json` declares. A file naming an agent nobody has was reported as
  that agent being the only one installed.

## 0.4.1 — 2026-10-14

One message, from watching somebody meet detent for the first time and run a
command from the wrong directory.

### Changed

- A missing `.detent/product.json` says where to stand, and names the mistake
  when it can see it: run from inside a clone — the usual first attempt —
  every command that reads the product now answers `<name> is a git
  repository; detent works from the folder your repositories sit in, not from
  one of them`. It deliberately does **not** offer the parent directory as the
  fix: that is normally a projects directory full of unrelated clones, and
  detent would take every one of them for part of the same product.

## 0.4.0 — 2026-10-13

The release where the repository started checking what it says about itself.
detent reached self-hosting and the documents said otherwise for a day, and the
gauge had been green on every documentation change ever made here because none
of its stages opened a markdown file. One of those is now recorded; the other
is now checked, and it caught this release's own stale version line before the
commit was written.

Nothing in `cli.mjs` or `core/` changed, so the tool behaves exactly as 0.3.1
did. What changed is what this repository claims and what it verifies before
claiming it.

### Added

- A `docs` stage in this repository's own gauge, `scripts/check-docs.mjs`,
  run by `npm run verify` as a step of its own. It checks that every relative
  link in a tracked markdown file resolves, that a version a document states as
  the **current** one is the version in `package.json`, and that
  [`docs/adr/README.md`](docs/adr/README.md) lists exactly the files in
  `docs/adr/` — the three kinds of drift that had already reached `main` here.
  An `#anchor` is part of the link and not part of the path, and a changelog
  heading naming a past release is a record rather than a claim about now.
- `DESIGN.md` §6 now says what green covers: a profile's stages define it, and
  green means nothing outside them. Two of the first four tasks run here
  changed only documentation, and for those two the gauge was green because
  none of its stages opened a markdown file — the same honesty detent already
  owed a repository that declares no gauge at all
  ([0011](docs/adr/0011-a-gauge-that-cannot-read-the-change.md)).

### Fixed

- [`PROGRESS.md`](PROGRESS.md) and the README record that **self-hosting was
  reached on 2026-10-13**, with task 0026. Both still said detent did not build
  itself yet, a day after it started to. The milestone names evidence a reader
  of this repository can check without the product folder the journal lives in:
  `git log --grep='^Acceptance: '` lists what detent has worked here, carrying
  the trailers `DESIGN.md` §10 specifies. The claim is bounded to what
  happened — detent merges onto `agent/dev` and has opened no pull request,
  placed no tag and moved no branch of a person's, and the task files are
  still written by hand.

## 0.3.1 — 2026-10-13

What a first run on a clean machine found. Both entries below come from
walking the install path as a stranger would, which is also how the README
section was written.

0.3.0 reached the registry in the meantime. It was tagged on 2026-10-12 and
its publish step failed because the package had no trusted publisher
configured — npm had nothing to check the workflow's identity against. The
repository side had been right since the workflow was written; configuring the
npm side and re-running the same tag published it, and that first publish is
what validates the configuration, so tags from here publish themselves.

### Added

- A **Getting started** section in the README: how to install, what a product
  folder is and why it is not the folder your repositories happen to sit in,
  the four commands that get to `ready`, the shape of a task file, and
  `detent run`. The README explained what detent refuses to do and never said
  what to type.

### Fixed

- `detent init` creates `tasks/{todo,hold,done,failed}`, and `detent doctor`
  reports the queue as its own check. `init` wrote `product.json` and stopped,
  so the queue `run` reads and `plan` writes into was never created; `doctor`
  had no check for it and answered `ready` for a product with nowhere to put a
  task. The README quickstart papered over it with a `mkdir -p`, which is gone.
  A folder that already exists is left alone, and a missing one is now a
  failure that prints the command creating it.

## 0.3.0 — 2026-10-12

The build order is complete: steps 9, 10, 12 and 13 of
[`PROGRESS.md`](PROGRESS.md) on top of 0.2.0 — the scheduler, `promote`,
`init`'s model pass and `plan` — and with `prune`, every command in
`detent --help` does something.

Also the first version worth installing. The last version the registry served
is 0.0.1: 0.0.2 was tagged but its publish step failed, and 0.1.0 and 0.2.0
were cut in the repository and never tagged. So the registry goes from 0.0.1 to
here, and the entries below record what each of those three was, because a
version that nobody could install is still a claim this project has to keep
straight.

What 1.0.0 still wants is not code but evidence: a real batch of tasks run
against a real product, and detent running them instead of a person.

### Added

- `detent prune` deletes task branches whose work is already on `agent/dev`,
  and keeps paused work. Every command in `detent --help` now does something.
- Build step 13: `detent plan` opens an interactive session with the agent to
  talk the work through and write the task files, then lists what was written,
  validates the queue as `run` will, and names anything else that changed.
- Build step 12: `detent init` asks the implementing agent, read-only, what the
  scan cannot see — each repository's role, relations, a gauge where nothing is
  declared — forced to a schema and retried on a mismatch; then drops whatever
  the scan does not support. `--no-agent` stops after the scan.
- Build step 10: `detent promote` merges `agent/dev` into `agent/staging`
  behind the `promote` profile run on the merged tree. Red promotes nothing and
  reverts nothing; a conflict is aborted; both tell the developer. A
  promotion is its own journal line, and `summary` and the dashboard report how
  often a batch came out red with every task in it green.
- `branches.staging` and `gauge.promote` are accepted. `doctor` fails a promote
  gauge with no staging branch — a declared check nothing runs — and a declared
  staging branch that does not exist, printing the command that creates it.
- Build step 9: `detent run` works up to `concurrency` tasks at once — never
  two in one repository, a barrier (`touches_contract: true`) alone with the
  pool drained before it and nothing started past it, and a barrier that does
  not pass ends the run there.

### Fixed

- The gauge is green on macOS, where two of the agent tests were measuring the
  machine rather than detent: one compared a path against the symlink the
  temporary directory is, the other gave a fake CLI 300ms to start when `sh`
  needs up to half a second to reach its first line there. The timeout they
  cover was never at fault. A gauge that is red on one of the two platforms the
  product declares teaches the people reading it to look past a red, which is
  the habit this project exists to break.
- A task file that cannot be read still takes part in the check for repeated
  numbers: a broken task is no excuse for a second one with its number.
- `detent summary | head` and every other command piped into a reader that
  stops early end quietly, not with an EPIPE stack trace.
- Two tasks running at once no longer trip each other's boundary check: the
  journal may grow by lines detent appended, and by nothing else.

## 0.2.0 — 2026-10-06

Worth showing: there are numbers, and a page that displays them. Build steps
7, 8 and 11 of [`PROGRESS.md`](PROGRESS.md), on top of 0.1.0 — `init` and
`doctor`, the dashboard, and the acceptance pass.

### Added

- Build step 11: the acceptance pass. Between a green gauge and the merge,
  `models.accept` reads the diff against the task in its CLI's read-only mode
  and may raise doubts; a doubt pauses the task as `rejected`, a verdict detent
  cannot read is an error, and nothing is ever approved by it. `summary`
  reports how often a green run was not done. `implement` and `accept` must be
  different models.
- Build step 8: `detent dashboard` serves a read-only page on localhost —
  what is running, where each `agent/dev` stands against its human branch,
  the queue, every paused task with why, and the journal's numbers.
- Build step 7: `detent doctor` checks the nine conditions and the namespace
  with the same scan, says what to change — as a command where there is one,
  such as the `git branch agent/dev <compare>` it never runs itself — and
  writes nothing.
- `detent init` scans the product folder — repositories, branches, scripts,
  lockfiles, submodules, installed agent CLIs — and writes `product.json`.
  Re-run, it proposes a diff in `product.proposed.json` and keeps what a person
  wrote. Gauge stages are proposed only from scripts a repository declares.
- Every agent call has a time limit: `timeout` in `product.json`, in minutes,
  30 by default and settable per repository. Past it the agent and everything
  it started are stopped, and the task is paused with its work kept.
- A resumed task's agent is told why it was paused, and is handed the doubts
  of a rejection.

- After every agent turn, `.detent/product.json`, the task's own file and the
  journal are compared with what they were before it; an agent that edits the
  files that judge it pauses the task.

## 0.1.0 — 2026-10-06

End to end: a task goes from a file to a merge commit on `agent/dev`, and the
journal says what it cost. Build steps 1–6 of [`PROGRESS.md`](PROGRESS.md).

### Added

- Build step 1: `core/product.mjs` loads `.detent/product.json` strictly — every
  problem at once, each naming its path; branch values checked against
  `agent/` and as git ref names; `branches.staging` and `gauge.promote` refused
  by name until step 10. `core/task.mjs` reads the queue in
  `tasks/{todo,hold,done,failed}` and rejects one that cannot be executed.
  Nothing calls either yet.
- Build step 2: `core/gauge.mjs` runs a profile's declared stages and names the
  one that went red; `core/lock.mjs` turns a history of gauge results into the
  decision on the agent's way out — leave, retry with the failure text, or
  escalate after `attempts` identical failures in a row. DESIGN.md §6 now says
  what "identical" means.
- Build step 3: `core/workspace.mjs` holds the invariant — every exit from a
  task, including Ctrl-C, leaves the repository on `agent/dev` with a clean tree
  and moves no ref outside `refs/heads/agent/`. Unfinished work is parked as a
  wip commit on the task branch, written without running hooks.
  `.detent/state.json` records which repository is out, and `detent recover` —
  the first command that does something — returns what a hard kill left behind.

- `detent gauge [repo…] [--profile exit|merge]` runs a repository's gauge by
  hand, outside any run.
- A notify command that does not read its stdin is judged by its exit code, not
  by the broken pipe it leaves behind.

- Claude Code, Codex and Gemini CLI run behind one call, `core/agents.mjs`,
  each tested against the output its CLI really prints
  ([ADR 0010](docs/adr/0010-three-agent-clis.md)).

- Build step 4: `detent run` works the queue one task at a time — the
  implementing agent on its task branch, the gauge on its way out, a commit
  with `Task`, `Gauge` and `Agent` trailers when green, a pause and a
  notification when the budget is spent. The boundary is checked after every
  agent turn: `agent/dev` is restored if the agent moved it, a moved human ref
  is named and left alone.

- Build step 5: a green task lands on `agent/dev` as one merge commit, built
  on a detached HEAD and held behind the `merge` profile run on the merged
  tree, so `agent/dev` never sees a red merge. A conflict is aborted, named and
  paused, never resolved.

- Build step 6: every run appends one line to `runs/journal.jsonl`, and
  `detent summary` reports pass rate, attempts per run and cost per pass, per
  repository and per agent and model. A repository with no gauge shows a dash,
  not a pass rate.

- A task paused on a merge conflict says what to do about it: the notification
  names the paths and the command that brings `agent/dev` into the task branch,
  and once a person has resolved it there, resuming lands the task.

### Changed

- A role in `models` names its agent: `{ "agent": "claude" | "codex" |
  "gemini", "model"?: string }`, instead of a bare model name.

- A task gets `attempts` attempts (default 3); red on the last one pauses it in
  `tasks/hold/`, keeps its branch, and notifies the developer through the
  `notify` command in `product.json` or a desktop notification. Moving it back
  to `todo/` resumes it on the same branch. Identical failures no longer decide
  when to stop, only how the escalation reads
  ([ADR 0009](docs/adr/0009-three-attempts-then-pause.md)).

- Session work on detent itself now goes through a task file and an
  `agent/task-<id>-<slug>` branch, as `CONTRIBUTING.md` said it would once the
  queue existed.

## 0.0.2 — 2026-10-03

The first release cut by the workflow rather than by hand — and the first one
that did not reach anybody. `v0.0.2` was tagged, the release workflow ran on
the tag and the version matched `package.json`, but the publish step failed.
This version is not on the registry, which holds only `0.0.0-stage` and
`0.0.1`, both uploaded by hand on 2026-10-03. Everything below happened in the
repository; none of it was ever installable at this version.

This entry claimed the publish succeeded until 2026-10-13, which is the kind
of unchecked claim the project exists to refuse. Why the step failed is a
separate question.

### Added

- The agent branch namespace moved behind a slash — `agent/dev`,
  `agent/task-<id>-<slug>` — making the boundary one predicate, one glob and one
  assertion instead of a prefix convention
  ([ADR 0001](docs/adr/0001-agent-branch-namespace.md)).
- Optional agent-side staging: `branches.staging`, a third gauge profile
  `promote`, and a `detent promote` command that checks a batch rather than a
  task ([ADR 0008](docs/adr/0008-optional-agent-staging.md)). Specified, and
  refused by the loader until build step 10.
- Eight decision records in [`docs/adr/`](docs/adr/).
- [`PROGRESS.md`](PROGRESS.md), with `check-progress.mjs` in the gauge so a step
  cannot be marked done without a proof that exists.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): branches, commit format, when a change
  needs an ADR, how a release is cut.
- A release workflow that publishes from a tag with provenance and **no stored
  credential** — npm trusts the repository and the workflow file over OIDC — and
  refuses a tag that disagrees with `package.json`.

### Changed

- `detent promote` is listed in `detent --help`, and exits 70 like every other
  command that does not exist yet. This is the only change to the packaged
  artifact; the rest of the release is the reasoning behind it.
- The package metadata spells the GitHub account `kazimVakhobov` —
  `repository`, `homepage`, `bugs` and `author` previously resolved only
  through a rename redirect.
- Condition 3 loosened: a repository names *one* human branch to be compared
  against, and a release train behind it is not detent's business.
- `product.json` validates every branch value against `^agent/`, and the schema
  is strict — an unknown key is an error rather than a silent no-op.
- Journal lines carry `kind`, never defaulted, so a promotion can never be
  counted as a task run.

Still nothing implemented — [`PROGRESS.md`](PROGRESS.md) says where the build
actually is.

## 0.0.1 — 2026-10-03

### Added

- The name, held on npm as `@kazimvakhobov/detent`.
- A CLI skeleton that lists its commands and exits 70 on the ones that do not
  exist yet, rather than pretending.
- The repository's own gauge: zero dependencies, checked; tests on Node 22.
- [`DESIGN.md`](DESIGN.md) — the specification the code is written against.

Nothing is implemented. The package exists to hold the name.
