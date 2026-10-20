# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions mean what
[`PROGRESS.md`](PROGRESS.md) says they mean.

## Unreleased

### Fixed

- **The timeout test no longer races the clock.** One test in
  `test/agents.test.mjs` checked two things that want opposite things from the
  clock: that a call past its limit is stopped and says which limit, and that
  the signal reached the whole process group the agent started. The second half
  reads a pidfile and so needs the fixture to have *started* — `sh` can take
  half a second to reach its first line from a temporary directory on macOS,
  which is why the limit had been raised to 2000ms — while the first half wants
  a limit short enough to keep the suite quick. Under the whole suite in
  parallel on a loaded machine it was seen to take 255 seconds and fail its own
  `< 5000` wall-clock assertion. It is two tests now: the limit, with a 100ms
  limit and nothing read from the fixture, which keeps both the error sentence
  and `Date.now() - started < 5000` — the sentence proves only that the timer
  fired, since `core/agents.mjs` composes it in `child.on('close')` and would
  compose it just the same after a failed kill let `sleep 30` finish, so only
  the clock proves the kill ended the call; and the reach of the signal, with
  no limit at all, which waits for a pid to arrive in the pidfile — a number,
  not a path, since `echo $! >` creates the file before it writes into it —
  and then calls `stopAgents`. No assertion was dropped, and the waits that
  remain are bounds a broken fixture fails against rather than budgets a slow
  machine is measured against. Run against load to check that: five full
  `npm run verify` runs against ten `yes > /dev/null` processes (one per core)
  and a second `npm run verify` looping beside them — 329 passing every time,
  the whole suite stretched from 22s to 47–57s, and these two tests unmoved at
  0.10s and 1.1–1.7s, inside the 5s and 10s bounds they are checked against. No change to `core/agents.mjs`: the timeout worked, the test
  measured it with a stopwatch.

### Changed

- **Overview answers "what now" rather than "what on average".** The landing
  section held one thing — the lifetime figures — and both of the questions a
  person actually opens the page with were somewhere else: what is running was
  a sentence in the header chip and a cell in Repositories, and what is next
  was in Queue, behind a click, in a table that did not say it was in run
  order. Overview now opens with **what is running now** — which repository,
  which task, which attempt and how long it has been going, or a sentence when
  nothing is — then **what is next**, the next five of `todo/` in the order a
  run takes them, which is ascending task id and is now stated above the list
  rather than left to look arbitrary, with a barrier marked as one and
  everything behind it saying which task it is behind — then **what is waiting
  for a person**, with why each stopped. The figures stay, under those three:
  they answer "was it worth it", which is a different question. Repositories
  keeps its own section unchanged, and the strip of what is wrong is untouched
  — this adds a landing screen, it does not become the place things are
  reported.
- The snapshot's queue entries now carry `touchesContract`. `readQueue` had
  already parsed it for every task in `todo/` — it is the one field the
  scheduler branches on — and the snapshot dropped it, which is the single
  reason the page could not say that a task in the queue runs alone. Nothing
  new is read, and nothing was added to `state.json`.

## 0.6.0 — 2026-10-20

The release where the product stopped claiming three agents and the dashboard
stopped being a thing you only read.

**One agent, and the table it came out of.** Three adapters were offered and
one had ever run: the header of `test/agents.test.mjs` had said so since they
were written, and one of the unverified two pointed at a program its vendor had
replaced for free accounts four months earlier. `codex` and `gemini` are gone
and the mechanism they came in is untouched — a role still names its agent, and
the adapter table is still a table with one row, because what makes adding one
back a configuration rather than a rewrite is the shape
([0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)).
The cost is written down rather than discovered: with one vendor, an acceptance
pass is a different model of the same family, so `0004`'s "a model's judgement
may only raise a doubt" carries more weight than it was meant to.

**The page you watch a run on.** It is sections now, one shown at a time and
named in the fragment, so what was wrong with a single scroll — the densest
block at the bottom, two of four queue folders drawn, numbers computed and
displayed nowhere — is gone, and what is wrong with *sections* is answered in
the same change: a dead run, a paused task and a queue that will not parse are
drawn above every section, because a page that can hide the thing that is wrong
has lost the one job it had. A task is something you can open, with its body as
text and no markdown rendered. The configuration is read before it is written,
which also narrows a rule: a view may refresh, an open editor never does
([0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)).
And what the agent is saying arrives while it says it, in a file that is not a
record — nothing reads one to decide an outcome, a cost or a verdict
([0021](docs/adr/0021-the-agents-output-is-a-stream-written-to-a-file-that-is-not-a-record.md)).

**Which model to type.** Nothing detent can reach knows: the CLI holds no
list, the API's list needs a credential this product does not have, and
availability turned out to depend on the installed CLI as well as the account.
So the names it has watched work are a suggestion in `product.json`, editable
there, and the validator never checks a model against them
([0019](docs/adr/0019-the-offered-model-names-are-a-suggestion-in-the-product-file.md)).

One thing in here cost two runs, and it is the part worth reporting. The
logging change passed its gauge and was **demoted by the acceptance pass**,
which found that the page said "running" over a tail that had stopped growing
whenever the run was in a phase that writes no log — the exact symptom the
change existed to remove. It went back and came out naming the third state. The
reviewer could not approve and did not have to; `0004` earned its keep.

### Added

- **A model name you can pick, and a list you can extend.** A role names an
  agent and optionally a model, the validator took any non-empty string for it,
  and the dashboard offered a bare text box beside the agent select — correct,
  and no help at all to somebody who said plainly that there were no keys
  anywhere and no way to know what a model name looks like. detent now ships a
  list of names it has watched work, `init` writes it into `product.json` as
  `modelSuggestions`, and the dashboard's model field offers it while staying
  free text
  ([ADR 0019](docs/adr/0019-the-offered-model-names-are-a-suggestion-in-the-product-file.md)).
  The aliases lead — `opus`, `sonnet`, `haiku` — because they are the entries
  that do not go stale, and they cost the journal nothing: a run with an alias
  came back naming the model it resolved to, so `requested` keeps the alias and
  `actual` keeps the model. **Nothing is checked against the list**, not on
  load, not in `doctor`, not on the page: a name that is not on it is accepted,
  written and run. A file carrying the key is offered its own list and nothing
  else, empty included; a file without it is offered the shipped one, so every
  product that exists today gets the suggestions without being edited. The
  reason it is a suggestion is that nothing detent can reach knows the answer —
  the CLI holds no list, the API's needs a credential this product does not
  have, and `--model claude-opus-5-5` turned out to be refused by the installed
  binary rather than by the account, so a list that refused a model would be
  wrong for somebody on the day it shipped.
- **The page says where the names come from**, under the field: the list is
  `modelSuggestions` in `product.json`, it can be extended there, and any name
  may be typed. It does not claim the list is what an account can run, because
  nothing the page can reach knows that.

- **What the agent is doing, while it does it.** A run printed a line when a
  task started and a line when it ended; between them — minutes, sometimes a
  quarter of an hour — nothing, and the person who dispatched it had no way to
  tell working from stuck without reaching for `ps`. The agent is now invoked
  so that its output arrives **as a stream**, and every attempt's raw stdout is
  written to `runs/logs/<task>-attempt-<n>.jsonl` as it arrives
  ([ADR 0021](docs/adr/0021-the-agents-output-is-a-stream-written-to-a-file-that-is-not-a-record.md)).
  Two facts made this cheap and both were checked rather than assumed: the last
  line of `--output-format stream-json --verbose` is the same `type: "result"`
  object the single-object format printed on its own, so every number the
  journal records is read from the same place; and there is one agent now
  ([ADR 0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)),
  so streaming no longer means privileging one of three in the most
  load-bearing code in the product.
- **The dashboard shows the output of a running task**, inside the task's own
  detail view, under its body and its history — the surface somebody watching
  is already looking at, read from the same file `tail -f` would read, on the
  timer the page already has. It does not grow with the run: the page asks to
  carry on from the byte its last answer ended at rather than re-reading what
  it has, keeps a bounded number of lines, and clips each one.
- **It says which of three states it is in.** Not running: what is shown is what
  the last attempt said, not something happening now — and a task nothing has
  ever run says *that* rather than showing an empty box that could be either.
  Running and printing: the end of the output, a few seconds behind. Running and
  **not** printing: only the agent's own turn writes a log, so the gauge, the
  link check, the acceptance pass and the merge print nothing there, and the
  page says that rather than leaving a frozen tail under the word "running",
  which is the symptom this change exists to remove. It is told from what the
  page can check: the claim's attempt against the log's, whether the last line
  to arrive is the agent's result object, and how long the file has been quiet.
  No phase is recorded anywhere to drive it, and `DESIGN.md` §5 names every part
  of a run that writes no log.
- `detent run` prints the path when a task starts and shows nothing: several
  tasks may be running and their output interleaved in one terminal would be
  unreadable, so the path is the offer and `tail -f` is the choice. The name is
  derivable from a task id and an attempt, so a second terminal needs nothing
  copied out of the first.
- **A log is not the journal.** Nothing reads one to decide an outcome, a cost,
  a verdict or a model; the journal's numbers come from the result object as
  they always have, and a number taken from a transcript is a number nobody can
  check. A run that cannot write its log says so once and carries on — losing a
  log must never cost the task — and the output goes no further than this
  machine, because a transcript holds whatever the agent read.
- **It has a stated end.** `detent prune` now also deletes the attempt logs of
  settled tasks: `done/`, `failed/`, and tasks whose file is in none of the four
  folders. A task in `todo/` or `hold/` keeps its last attempt, because that is
  what a person opens it to read, and a task a run is holding is being written
  to right now. An artefact with no stated lifetime is a disk leak with a
  feature request attached.

- **A task can be opened on the dashboard.** A task on the page was
  `id + ' ' + slug`, and for a paused one its reason and the reviewer's doubts
  — not the goal it was given, not the criteria it is judged against, not what
  its attempts did. The one thing a person wants when deciding whether to run a
  task, or working out why it stopped, is now a section of its own: the
  frontmatter, the folder, the goal, the acceptance criteria, the out-of-scope,
  and the journal's lines for that number with each run's outcome, attempts and
  cost, the acceptance verdict with its doubts, and whether the task's links
  checked
  ([ADR 0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)).
  The parse already existed — `parseTask` splits a task into its frontmatter
  and its three sections because `detent run` needs them — and the page had
  never seen the result. It is read by `core/task-detail.mjs` and drawn by a
  sixth module under `core/dashboard/`, composed into the same one document:
  one request, no second asset, and the same content security policy.
- Every table that lists a task opens it: `todo/`, the paused tasks, `done/`,
  `failed/` and the recent runs. The fragment carries the number, `#task/0042`,
  so a link to one task is a link somebody can send and reload, and a task with
  no row in any table is still reachable by typing one. A fragment that names
  the section with no number, or with a number that is not digits, still lands
  on the section, and nothing rewrites the address bar.
- **The body is shown as written.** detent renders no markdown: a task body is
  markdown somebody wrote, every line of it reaches the page as text, and the
  structure comes from the sections already parsed — so nothing in a task file
  can become markup and there is no sanitiser here to be wrong about
  ([ADR 0006](docs/adr/0006-zero-dependencies-node-22.md)). Somebody will ask
  for headings.
- A task in `hold/`, `done/` or `failed/` opens too, which means reading and
  parsing a file nothing else in the process opens: `readQueue` holds `todo/`
  to the full shape and pushes the other three folders by name alone, so a task
  that has already run was a file nobody had read. **A file that will not parse
  opens anyway**, showing what it says and naming the problem — a task nobody
  can open is a task nobody can fix.
- The number never becomes a path: it is matched as digits, compared as a
  number, and resolved against the four folders by file name, so nothing
  outside the queue is reachable by asking for it. A number that is in none of
  them is refused in a sentence that says so, and a queue that will not read
  says *that* instead, with its problems — the detail does not report a task
  missing from a queue it could not read. `readQueue` stays all-or-nothing,
  which is what keeps a typo from costing three attempts; the one file is read
  directly. Nothing in the view writes, and the detail is fetched when a task
  is opened rather than polled: `state.json` gains nothing.

- **The dashboard writes the product's configuration, between runs.** The page
  that knows which model implements, which reviews, how many attempts a task
  gets and how long an agent may run could not change any of it: all twelve
  keys are `product.json`, and changing one meant leaving the page, finding the
  file and knowing a schema that two of those keys joined this month. The
  models for each role — product-wide and per repository — `attempts`,
  `timeout`, `concurrency` and `notify` are now inputs on the page, and
  `POST /configuration.json` is the one thing it writes
  ([ADR 0015](docs/adr/0015-the-dashboard-may-write-the-configuration-between-runs.md)).
  `repos`, `queue`, `docs` and `branches` are shown beside them with the
  reason each is not editable there: they name things on disk, and a page
  cannot create what it names.
- A write is refused **while a run is active**, by the server and not only by
  the disabled inputs — a disabled input is a courtesy and the refusal is the
  rule. The refusal says a run is active and which repository is on which task
  and attempt, read from the same `state.json` `recover` reads. The reason is a
  mechanism rather than a preference: the files that judge an agent are
  fingerprinted before each of its turns, that guard does not ask who changed
  one, and a page writing mid-run would pause the task blaming the agent for a
  person's edit. A stale entry left by a killed run keeps the inputs shut until
  `detent recover` is run, which is the right answer and an unobvious one.
  There is no queue of changes applied later: a change accepted and not yet
  applied is a third state between what the file says and what the page shows.
- Every write goes through `validateProduct` whole — the same code
  `detent run` loads the file with, every problem at once, each naming its
  path, and nothing written if any of them fails — so the page cannot produce
  a `product.json` a run would refuse to load. The file keeps the shape `init`
  writes it in, the keys the page does not touch keep their values and their
  order, a field left empty leaves its key out rather than writing the default
  into it, and what the page shows afterwards is read back off disk.
- A write must come from the page: `origin` naming this server and
  `content-type: application/json`, neither of which a form on another site
  can produce. Binding `127.0.0.1` stopped meaning anything the moment the
  server accepted a write — any site open in the same browser can post to
  localhost, and it never needs to read the reply. There is no login, session
  or token, and there is not meant to be: one person per workspace is
  condition 8, and what the check keeps out is a page they did not open rather
  than a person who is not them.

- The `docs` stage counts what the prose counts. Two shapes are read, and both
  have been wrong in this repository more than once: a line that links to
  [`docs/adr/`](docs/adr/) and says how many decisions are in it — it has said
  eight, ten, eleven, twelve and thirteen while the directory held another
  number — and a heading of the form `### <count> <things>` over the list of
  those things, which said three when there were four and four when there were
  five. A mismatch names both numbers, and the heading. Counts written as
  English words are read, since that is how this repository writes them.
  Nothing else is: "the nine conditions" and "three attempts" are claims about
  behaviour that the code settles, and a word that is not a number ("a few
  decisions") is not a count and is left alone rather than guessed at — a
  false failure in a gauge stage costs more than a missed one. It found no
  mismatch when it was written; the two claims standing here are both right,
  which is the first time that has been measured rather than noticed.
- A configured queue that cannot be published is said out loud, by the command
  that created it and by `doctor`. `"queue": "agent-loop/tasks"` with no
  `agent-loop` beside the other repositories used to get a plain directory, a
  line saying the queue was created, and `ready`: everything worked except the
  thing the configuration was for, since
  [ADR 0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md)
  has a task's move committed and pushed so the next machine reads a current
  queue, and there was nothing to commit it to. `init` now says the queue
  stays on this machine and why, and `doctor` reports it as a failure of its
  own — a product whose queue cannot be published is not in the shape its own
  `product.json` describes. Neither of them clones anything, creates a
  repository or adds a remote: they report, and a person decides.
- A queue in a repository whose branch tracks **no remote** is reported too,
  as a different sentence and as worth a look rather than a failure: nothing is
  wrong, nothing will be pushed, and which of the two a person has is what
  decides whether there is anything to do about it. The push was already
  skipped there, and rightly — a queue nobody can fetch has no next machine to
  be stale for — but it was skipped silently.
- A queue at the default location says nothing, as it always did. This is a
  check about a `queue` somebody configured.

### Changed

- **The configuration is read until a person says otherwise.** Every value in
  the panel was a live `input` or `select` whether or not anybody meant to
  change one, so reading which model a repository uses meant reading the
  contents of form controls — and while a run was active every control was
  disabled, which was right for the writing and cost the reading with it:
  somebody who opened the page during a run to see which model was costing what
  found the answer greyed out. Viewing is now the default and shows what the
  file says as text, with a repository's inherited role saying whose setting it
  is inheriting; the editor is entered deliberately from one button and leaving
  it discards
  ([ADR 0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)
  part 2). **Entering edit mode is refused while a run is active and viewing is
  not**, with the explanation
  [ADR 0015](docs/adr/0015-the-dashboard-may-write-the-configuration-between-runs.md)
  made part of the feature beside the disabled button: that a run is active,
  what it is working on, and that the server refuses whatever the page allows.
  Nothing about the write changed — it still refuses during a run, still
  validates whole through `validateProduct`, still requires the origin and the
  JSON content type, and still answers with what the file says afterwards.
- **A view may refresh; an open editor never does.** This narrows a rule that
  was written as a comment rather than as an ADR — the configuration is fetched
  once and after a write and never polled, because a form whose values move
  under the person filling it in would be a third state between what the file
  says and what the page shows. That argument is about a form: the view is now
  read on the page's one timer, and opening the editor takes a read of its own
  so what is edited is what the file currently says. From then until it closes,
  neither the timer nor anything else moves a value under the person typing. A
  write the server refuses leaves the editor open with what was typed still in
  it and the problems against their paths, because losing somebody's edits to a
  validation error would make the mode worse than the one it replaced.
- **Which model a repository uses is stated once.** The repositories table drew
  it in a format of its own (`implement claude …`, `review …`) beside a
  configuration panel that drew the same fact as form controls, and two
  renderings of one fact are free to disagree. The configuration is where a
  model is read, because it is where one is written; the table's column is gone,
  the repositories section says where to look, and `snapshot()` no longer
  carries a second copy of it.
- The page's one script is now run by its tests, not only read by them:
  `test/support/page.mjs` puts a document that is enough of one under the
  string the server serves and that same server in front of it, so "the default
  is a view", "the editor does not open during a run", "a refusal keeps what
  was typed" and "discarding writes nothing" are asserted as behaviour rather
  than as a regular expression over the source.
- **The dashboard page is sections, one shown at a time, and the one shown is
  named in the fragment.** Nine blocks down a single scroll put the densest of
  them — the configuration, the only one with inputs — below everything else,
  and the fragment means a reload and a copied link both come back to where
  somebody was: no server route, nothing fetched to change section, and the
  whole document still arrives in one request
  ([ADR 0020](docs/adr/0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)).
  The sections are Overview, Repositories, Queue, Agents, Recent runs and
  Configuration. An absent or unrecognised fragment lands on the first of them
  rather than on nothing, and nothing rewrites it — a page that corrects the
  address bar loses the one thing the fragment was for. The configuration moved
  into a section of its own, and what reading it became is the entry above.
- **What is wrong is in no section.** A run whose process is gone, a paused
  task, and a queue that would not parse are drawn above every section on every
  read, each naming the section that holds the detail. A single scroll had the
  property that everything was somewhere below you, and a page that can hide
  the thing that is wrong has lost the one job it had: ADR 0020 names this as
  how the split makes the page worse, and the strip is what keeps it from
  happening.
- **The page shows what it was already being sent.** `done/` and `failed/` were
  read on every snapshot and drawn nowhere — the queue section now has all four
  folders, `done/` with what the journal says became of each task and `failed/`
  with why, which is a person abandoning a task rather than detent deciding
  anything. `numbers.byRepo` was computed on every read and displayed nowhere;
  it is a table beside the repositories, the same six columns the agents table
  has. Nothing new is fetched and nothing was added to `state.json`.
- The page's source is several modules under `core/dashboard/` — the sections
  and the fragment that names one, the strip of what is wrong, the stylesheet,
  the rendering, and the configuration panel — composed into one string at
  import time. What is served is unchanged: one document, one request, no
  second asset, and the same content security policy, which is now asserted
  whole rather than by one of its directives. Serving the script as its own
  asset would let `script-src 'unsafe-inline'` go and is worth doing on its own
  merits; ADR 0020 declines to do it as a side effect of moving blocks around.
- The tests that read the page's own source for what it does assert the
  property instead, because splitting the file breaks a regular expression over
  it by construction. `PAGE.matchAll(/^ {2}\['(\w+)', '/gm)` — which read the
  offered configuration keys out of the source by their indentation — is now
  `LIMITS` imported from the module that draws them, compared against
  `EDITABLE` less `models` and checked to reach the document. The single
  `setInterval` compared with `['refresh']` is now the exported `POLL` plus a
  count of every timer in the document, so "one timer, and it reads the state"
  survives the timer moving file. The assertion that the empty-queue line is
  built from `s.product.queue` is now the rule it stood for: wherever the page
  writes a folder name, the queue the snapshot carries is written immediately
  before it, and no literal queue path appears anywhere. Three more properties
  are checked that one file made true by accident — no two elements share an
  id, every id the script reads exists in the document, and every block the
  page draws is inside exactly one section.
- `DESIGN.md` §12 and the README stop saying the dashboard is read-only. What
  replaces it is narrower and less memorable: it reads a product and writes its
  configuration between runs. `GET` and `HEAD` are unchanged — the page, the
  snapshot, and now the configuration — and anything that is neither those nor
  the one write still gets `405`.
- `detent run` refuses, before any branch is created, on what `doctor` already
  calls a failure in the repositories the queued tasks name. A declared agent
  that is not installed is therefore caught before the workspace is taken,
  with the sentence `doctor` has given since step 7, instead of when the agent
  was invoked — which is after the task branch exists and the workspace has
  been taken. Only failures, and only those repositories: what `doctor` calls
  worth a look lets a run go ahead, and a repository no queued task mentions
  is one a run would not have touched. The refusal names the checks that
  failed and then `detent doctor` for the rest; it does not reprint the report
  or run the advisory checks.

- The gauge runs on Linux **and** macOS. `verify.yml` is one matrix over
  `ubuntu-latest` and `macos-latest` — not two copies of a job — on the
  triggers it already had, Node 22 and no install step on either, and each
  check names the platform it ran on so a red one is readable from the list
  without opening it. Condition 9 promises both platforms, and until now the
  only one CI measured was Linux while the only one a developer measured was
  macOS, with nothing comparing them: that is how a suite red on Linux stayed
  red through six tasks and two releases while the local gauge said green the
  whole time. No Windows and no second Node version —
  [DESIGN.md §15](DESIGN.md#15-deliberately-not-here) refuses the first by
  name, and the claim under test here is the platform, not the runtime.
- `release.yml` keeps publishing from `ubuntu-latest` alone, deliberately. It
  builds one artifact from a commit whose matrix has already run on both
  platforms on the way to `main`, so a second runner there cannot change what
  is published — it can only gate a release on a machine with no say in it.
- A desktop notification nobody answered names the platform and the program it
  tried: `no desktop notifier answered on linux (tried notify-send)`. Which
  notifier exists at all is the platform's decision, so the same sentence on
  both said nothing about which machine is missing which program.

### Fixed

- **A refused model no longer reads as a success.** An errored result from
  Claude Code arrives as `is_error: true` with `subtype: "success"`, and the
  adapter composed its error string from that subtype — so a model name the
  installed CLI will not run produced `success (400): …`. The verdict was
  always right, since `ok` requires both fields; the sentence now leads with
  the status when the subtype is the one word the failure is not, so a 400
  reads as a 400. What is recorded as the failure is otherwise unchanged.
- The test that checks a timed-out agent is stopped along with what it started
  read an exited-but-unreaped process as still running: signal 0 succeeds on a
  zombie, and the process's parent is the shell detent had just stopped, so
  nothing in the test could reap it. How long an orphan lingers belongs to
  whatever adopts it — an init that reaps at once on a runner, a container's
  shell that never does — and the test was measuring that rather than detent.
  It now reads `/proc` on Linux, where an exited process says so, and keeps
  signal 0 on macOS, where there is no `/proc` and nothing lingers. The
  assertion is the same one: a stopped command has to be gone.
- A multi-byte character split across two chunks of the agent's output was
  decoded as two broken halves: `stdout += chunk` turns each buffer into text
  on its own, wherever the pipe happened to fill. One object at the end
  survived that by luck; a stream of lines would not, so the decoding moved
  into the stream, which holds a partial sequence until the rest of it arrives.

### Removed

- **Two of the three agents.** `codex` and `gemini` are gone from
  `core/agents.mjs`, from the schema, from `detent plan --agent`, from the
  scan's search of `PATH` and from `DESIGN.md`. Only one of the three had ever
  run: the header of `test/agents.test.mjs` had said so since the adapters
  were written — Claude Code 2.1 run for real, Codex 0.160 and Gemini CLI 0.62
  *read from their event and formatter code* — and every task detent has
  worked ran on Claude Code. On top of that, Google stopped serving Gemini CLI
  to free and individual accounts on 2026-06-18 and directs them to
  Antigravity CLI, a different program with a different interface, so the
  adapter targeted something its vendor had replaced for the people most
  likely to try it. The product claimed three, had verified one, and the
  README promised all of them
  ([ADR 0018](docs/adr/0018-one-agent-in-the-first-version-and-what-readmits-another.md)).
- **What was kept is the mechanism.** A role still names its agent,
  `product.json` still carries that shape, and the adapter table is still a
  table — with one row. Nothing hard-codes `claude` outside it: the schema,
  `doctor`'s fix line, `plan`'s usage and the dashboard's choices all read the
  list. 0018 rejected dropping the field by name, because the shape is what
  makes adding an agent back a configuration rather than a rewrite, and the
  cost of keeping it is one row.
- **What brings one back:** it has run a real task in a real repository, and
  its adapter was written against what it actually printed rather than against
  its source. That is the condition both of these failed, and the reason they
  left rather than waited. They are planned, not abandoned, and Antigravity
  CLI is the first candidate — written today it would be a third adapter built
  from documentation, which is the mistake being corrected.
- A `product.json` naming `codex` or `gemini` stops loading, and the refusal
  says so: `models.accept.agent: "codex" is not offered in this version —
  detent offers claude. An agent is added once it has run a real task and its
  adapter was written against what it printed: docs/adr/0018-…`. Nobody is
  known to have one, and whoever does is owed the decision rather than
  "unknown agent".
- `init` no longer proposes two different agents for the two roles. It writes
  `models.implement` and leaves `models.accept` out, and now says why: one
  agent is offered, so a reviewer is that agent on a different model, and
  which models an account has is not something a scan can see.
  [ADR 0004](docs/adr/0004-acceptance-demotes-only.md)
  is unchanged — an acceptance pass by the same model as the implementer is
  worth nothing, and so is one by a model name that does not resolve — which
  is why the key is left for a person rather than filled in.
- The acceptance pass loses its only path to a reviewer from another vendor.
  With one agent it is a different model of the same family — shared training,
  shared blind spots — and 0004's "a model's judgement may only raise a doubt"
  is carrying more weight than it was meant to. `DESIGN.md` §9 says so beside
  the rule.
- Four tests went with the adapters: `codex: exec with JSONL events…`,
  `codex: a failed turn is not ok`, `gemini: headless JSON, yolo…` and
  `gemini: an error object is not ok`. Each asserted one CLI's argv and one
  CLI's output shape — the adapter, not the mechanism. Every test about the
  mechanism stayed and now runs against `claude`: how it is called, how its
  output is read, how a timeout stops it and everything it started, how a
  missing binary and a failure are reported, and that an agent with no row is
  a programming error. One test arrived — the refusal that names a withdrawn
  agent — so `node --test` reports 272 where it reported 275: four gone, one
  added, three fewer.

## 0.5.0 — 2026-10-18

A methodology from outside this repository, and the first one detent's
assumptions had to be examined against rather than applied to. The product may
carry repositories that are the agents' shared context — documents, a kit, the
queue — mounted as submodules so an agent reads them without leaving its
working copy; a session writes there and pushes, and a dispatched agent only
reads.

Three rules bent to fit it, each recorded with what it rested on
([0012](docs/adr/0012-the-queue-and-the-shared-context-may-be-repositories.md),
[0014](docs/adr/0014-init-asks-where-the-queue-and-the-documents-are.md)). The
queue may be a repository. A submodule pointer may be committed once it is
verified to exist on a remote, where before it never could. And detent pushes —
the queue, and nothing else — where before it pushed nothing at all. The fourth
rule did not bend: an agent still gets a prompt and a working directory, and no
skills, hooks or settings
([0013](docs/adr/0013-the-agent-gets-a-prompt-and-a-directory.md)).

The release also carries what a first install found, which is what the four
entries under **Fixed** are: the first minutes of meeting this tool, where
every message was correct and several were no use.

### Added

- **A task's links are checked against the documents its repository has
  mounted.** A link in a task body is a markdown link whose path is relative to
  the root of the repository the task names — `shared-docs/adr/0003.md` in a
  task for `acme-api` is `acme-api/shared-docs/adr/0003.md`, the only form that
  means anything when the documents arrive as a submodule. Every one is looked
  for at the start of the task, **after** the shared context has been brought to
  its remote's tip, so the question is asked of the revision the agent will
  actually read; not at queue validation, which would cry wolf about a document
  pushed and not yet fetched. A link that resolves is not mentioned anywhere —
  silence is the normal case, and a task with no links reads nothing at all. A
  broken one is named to the agent as part of what it is given, so the only
  party who can tell whether that document was needed is the one asked; it is in
  the journal line as `"links": { "checked": 3, "broken": [...] }`, always
  present, so a task that named no documents does not read like a task whose
  documents were all found; and it is given to the acceptance pass, because a
  reviewer deciding whether the work is sound should know what the implementer
  could not read. **It never pauses, fails or retries the task** — detent cannot
  tell a load-bearing link from a decorative one, and the price, recorded rather
  than hidden, is that a task whose document was missing can end green and
  under-informed. `docs` now names one of the product's repositories and is
  refused when it names nothing, like every other reference to one; the check
  itself does not read it, because a path either resolves in the repository the
  task names or it does not. Parts 3 and 4 of
  [ADR 0014](docs/adr/0014-init-asks-where-the-queue-and-the-documents-are.md).

- **`init` asks where the queue and the documents are, and never waits for an
  answer nobody is there to give.** Two questions, after the scan and before
  anything is written, for the two things a scan cannot work out: which
  repository holds the queue — one meant to hold tasks looks like any other
  until there are tasks in it — and which holds the documents a task's links
  point into. Each lists the repositories the scan found and offers its default
  by name, so an answer is a number, a repository name or a path rather than a
  typed guess; the queue's default is `tasks` beside the repositories and the
  documents' is **none**, which is an answer and is written as `"docs": null`.
  `--queue <path>` and `--docs <name>` answer the same two questions from the
  command line, `--docs none` says there are none, and a flag is an answer
  rather than a suggestion: given one, nothing is asked either way. **With no
  terminal on stdin nothing is asked at all** — both defaults are taken, what
  was taken and why is printed, and the run is otherwise the one it has always
  been, which is what keeps `init` usable in a script. Every answer is
  announced, the defaults included, and every answer is written, so re-running
  `init` asks nothing the file already answers. `docs` is the second role
  detent names after `queue`, and nothing reads it yet. Parts 1 and 2 of
  [ADR 0014](docs/adr/0014-init-asks-where-the-queue-and-the-documents-are.md).

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

### Changed

- **`doctor` reads a submodule outside `neverCommit` the way ADR 0012 does.**
  It used to call one a thing to put back in the list — the warning told a
  person to undo the configuration they had chosen. It is now reported as
  tracked, with what that means: detent brings it to its remote's tip and
  commits its pointer with the task, once that commit is verified. What can go
  wrong with it is checked rather than warned about, and it is the same
  question the run asks before the commit — the checked-out commit against the
  submodule's own remote branches. In none of them is a failure that names the
  submodule and prints the push, because a run would pause on it. A submodule
  **in** `neverCommit` is reported exactly as before, which is to say not at
  all, and a repository that mounts nothing produces no new output.
- **The prompt says what a tracked submodule is.** An agent that found a
  submodule it was allowed to read and not to write was told nothing either
  way: the sentence about `neverCommit` paths is about the other list. It now
  gets the other half — read it, do not write there, detent records which
  revision you read. The `neverCommit` sentence is unchanged, and an agent in
  a repository with no tracked submodule gets neither.

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
