# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions mean what
[`PROGRESS.md`](PROGRESS.md) says they mean.

## 0.8.0 — 2026-10-23

**A queue card shows the cost whole, and the live log stops repeating itself.**
Two places where a line had more to say than it had room for, and both resolved
it by losing what mattered. **The card:** the facts row did not wrap and
scrolled inside the card instead, and at a quarter of the page the part hanging
past the right edge was the money — `$11.51` arrived as `$1`, a plausible
figure with nothing on the card to say it was a fragment. The facts wrap now,
and each one breaks between its words and never inside one, so a date may take
two lines and a figure never takes two halves. The head is still one row and
the name still ellipsises — it is an identifier read from its beginning, and
the path below carries it in full — and the `min-width: 0` that keeps a card in
its column is untouched. **The log:** the stream emits an event continuously
while a model thinks, and an event detent has no reading for prints as its
type, so *What the agent is saying* filled with twenty copies of one word while
the last thing the agent actually said went off the top. Consecutive identical
lines are one line with a count and over how long, because four minutes of the
same nothing is not four seconds of it; the span is measured by when the page
read the lines, since the log carries no times and asking an event for one
would be reading the stream for meaning. Nothing with content of its own
collapses — two calls to the same tool are two calls — no event type is named,
and the line cap now applies after collapsing, so repetition no longer pushes
content off the top. Still no parsing for the journal: every figure comes from
the result object, and a line that will not parse is shown as itself
([ADR 0021](docs/adr/0021-the-agents-output-is-a-stream-written-to-a-file-that-is-not-a-record.md)).

**The dashboard's queue is four columns in one row, and it stays four.** The
four folders were in a grid of as-many-as-fit, so at an ordinary window three
sat in a row and **Abandoned by hand** dropped underneath **Queue**, where it
read as a fourth thing about `todo/` rather than as the fourth folder. The
tracks are now four, equal, and do not reflow at any desktop width; below the
width the drawer already calls narrow they stack, because four columns of a
phone are not four columns. **And a card no longer leaves its column**: a grid
item's default `min-width` is its content's intrinsic minimum and a card's rows
do not wrap on purpose, so a long path made the item wider than its track, the
track stopped being a ceiling, and the card ran under the next column and off
the right-hand edge of the page. The four children are `min-width: 0`, the
track is the width, and the content ellipsises or scrolls inside it the way it
always meant to. The headings and the sort under each are untouched.

**A task that is being run now looks like one.** Its file stays in `todo/`
until `settle` moves it, so it sat among the tasks nothing had touched, under
the line *the journal has not seen this task — nothing has run it*, while
Overview's **Running now** said otherwise in another tab. Its card now carries
that it is running and which attempt, as an icon and a word like every other
status, and comes first in its folder whatever the sort is. It says nothing
about a phase: a claim is a repository, a task, an attempt and a pid, and which
of the gauge, the link check, the acceptance pass or the merge is under way is
recorded nowhere. A claim whose process is gone is not a running task and is
not drawn as one. No new read and no new endpoint — this is the `active` the
page had already read.

**The task detail loses a level of boxing, and the agent figures become
blocks.** It was a panel, a legend block inside that, a card inside that and a
table inside that: three borders before any content, and the content is what
somebody opened the drawer to read. What separates one block from the next is
space and a heading now; the drawer keeps its own edge, which is what makes it
a drawer, and the border left inside is the innermost one. The `Pass / Cost /
Tokens / Model` table was four columns inside a drawer 680px wide at its
widest, and it broke `claude · claude-opus-5` across four lines, one word per
line — it is a block per pass, each with what it cost, its tokens in and out
and the model that ran it, and a model name no longer breaks mid-identifier.
Every figure is the figure it was, out of the same two numbers the journal line
carries.

**Overview leads with the figures, and their heading says what they are.** The
pass rate, cost per pass, attempts per run, green-but-not-done and paused were
the last block on the landing screen, under a heading asking *was it worth it*
— a question about whether to regret the figures, put to somebody who had not
read one of them yet. The three blocks under them keep their order: what is
running, what runs next, what is waiting.

**`notify` was one command on one occasion, and the dashboard said it ran "when
a task finishes" — which is not what the code did: a task that passed was
settled in silence.** It now accepts an object — which events, and a list of
channels — and **still accepts a string**, meaning exactly what it meant
before, so every `product.json` already written keeps working and nothing has
to be edited to go on behaving as it did. Events are named: `paused`, `passed`
and `promoted`, plus the raw outcomes, so somebody can ask for `error` alone;
**a `notify` that does not say which events it wants notifies on a pause and
nothing else**, which is today's behaviour spelled out. `settle` now sends on
the `passed` branch too, and a promotion sends `promoted` — a batch reaching
`agent/staging` is news a person watching the gate wants, and it was news
nothing told them. Channels are a registry, one module per kind: the command
channel is what shipped, moved, and `telegram` is new — one POST to the Bot
API, no dependency, nothing vendored. A kind is added once it has delivered a
real message, not once its module compiles
([ADR 0025](docs/adr/0025-a-channel-is-a-kind-and-the-secret-is-not-in-the-configuration.md)).

**A channel that fails is reported and never fails the run — now per channel.**
One failing does not stop the others, `record.notified` carries a result per
channel, and `detent run` and `detent promote` print a line for each that did
not deliver, naming the channel and where it was aimed.

**The token is not in `product.json`, and the reason is not squeamishness: the
dashboard reads that file back and serves its values to a browser, and nothing
gitignored it.** A channel names the environment variable its token is in —
`tokenEnv` — and detent reads it when it sends; a `token` key is refused by
name with that reason rather than as an unknown key. A secret may also be typed
on the dashboard, which writes it to `.detent/secrets.json`, created `0600`,
under the same name; `init` now writes `.detent/.gitignore`, which there was
none of before. **Whether it is set is reported; what it is never is** — the one
place the page does not show what the file says, which is a decision and is
written down as one. Nothing prints, logs or journals a secret: the token is in
the URL the Bot API is called at, so a failed send is built from the status and
the API's own sentence, and redacted against the token on the way out.

**Notifications is a block of its own on the dashboard,** not a row among
`attempts`, `timeout` and `concurrency`: those are one value under one key, and
a list of channels is not one value. The events are choices, the channels are a
list, and a telegram channel shows its chat, its topic and the name of its
variable with `set` or `not set` beside it. It is drawn from the same read and
written by the same Save, because it is the same file.

**A barrier stops barring the moment it pauses — it did, and now it does not.**
The scheduler's second rule says a barrier runs alone and nothing starts past
it, and a barrier that does not pass ends the run with everything behind it
untouched. All of that was true of the list it was handed, and `run` handed it
`todo/` alone: the barrier moved to `hold/`, the next invocation found no
barrier, and it started exactly the work the first run had refused to start,
against exactly the contract it had refused to start it against. One run
enforced the rule and the next did not know it existed. Now `run` reads
`hold/` before anything begins — a paused task with `touches_contract: true`
bars every queued task with a higher number, in any repository, the run names
the barrier and why, and `detent run --past <id>` is the way past it for the
person who knows that contract landed another way. **The barring is not part
of any question:** a script, a pipeline and a cron line enforce it and report
it exactly as an interactive run does
([ADR 0024](docs/adr/0024-a-barrier-bars-until-it-passes-and-a-resume-is-a-decision-not-a-move.md)).
A paused task that changes no contract bars nothing — it is named in one line
and the queue runs.

**`detent run 0003` on a paused task used to say `not in tasks/todo/: 0003`,**
which is what it also said about a number nobody had ever used. A name is now
answered by where the task actually is: `hold/` says it paused, with the
outcome and the reason from its last journal line; `done/` says it already
passed, with the commit; `failed/` says that folder is yours and detent never
moves a task there. A number in none of the four keeps the old sentence, being
the only one of the four it is true of. And `todo/` empty while `hold/` is not
is its own sentence: there is work, it is paused.

**A paused task is offered rather than refused.** With a terminal to ask on,
`detent run` offers three answers per paused task in id order — leave it,
resume it now, or open `plan` to change it first. The default is to leave it:
a bare Enter must never start a run that costs money, and leaving a barrier
paused leaves it barring, which the run says rather than quietly doing less
than it was asked to. A resume goes through `moveAndRecord` like every other
move, so a queue that is a repository gets the commit and the push, and a
resume that cannot be published fails the way those do; what follows is what
follows a hand-moved file, unchanged. `plan` opens on the task file where it
is, with the outcome and the doubts the last run recorded and the job of
changing that one file in place — no new task, no code — and the file stays in
`hold/` while it is rewritten. Afterwards the run stops and says what to type
next, rather than starting an unattended agent on a conversation nobody has
read yet — and a task resumed earlier in the same pass has still moved, so it
is queued in `todo/` and waiting, which that line says too. Nothing is
remembered between runs: the answer depends on what the person has just read.

**What that conversation left is checked, the way `plan` checks its own.** The
pre-prompt says to change one file and write no code, and a prompt is an
instruction rather than a guarantee — so the amending session is wrapped in the
same before-and-after, with the narrower boundary it was given. Whether the
file changed at all is said, and so is anything else that did: a ref moved, a
working tree touched, `product.json` written, another task rewritten, a new
task in `todo/` nobody asked for, or the file itself moved out of `hold/`. Any
of those exits non-zero, because the one person who could catch it is the one
who has not read the conversation yet.

**A doubt is an attempt.** `attempts` was a budget for the gauge and for
nothing else: a task whose gauge went red was handed the failure and asked
again, and a task whose gauge went *green* and was then doubted by the
acceptance pass was paused on the spot, after one attempt, to wait for a person
— even though the agent could have addressed the doubt and the budget was
untouched. The feedback it needed was already written and only a resume could
reach it. Now a doubt costs an attempt exactly as a red gauge does: the doubts
go to the implementer with the one sentence the gauge's retry cannot say — the
previous attempt passed the gauge and was still not accepted, so turning it
green again is not what is missing — and the loop goes round. `rejected` is
what a doubt on the *last* attempt produces, unchanged: the same reason, the
same empty commit carrying each doubt as a `Doubt:` trailer, `hold/`, the
notification. The reviewer still never approves; what the budget buys is how
many times it gets to speak before a person is called
([ADR 0023](docs/adr/0023-a-doubt-is-an-attempt-and-every-round-is-recorded.md),
narrowing [0009](docs/adr/0009-three-attempts-then-pause.md) and leaving
[0004](docs/adr/0004-acceptance-demotes-only.md) where it was).

**A merge conflict, a boundary breach, a verdict nothing can read, an agent
that failed, and green with nothing changed still pause immediately,** with no
attempt spent. detent does not resolve conflicts and the agent is not let into
a merge, so a budget spent on either would be a budget spent on nothing it can
change. The acceptance pass now answers with one of three named outcomes —
merge, doubts, stop — rather than a boolean that had to smuggle the third in as
a second meaning for `false`.

**The journal line gains `rounds`,** one entry per attempt: that attempt's
gauge result and failed stage, its acceptance verdict and doubts if it reached
the pass, and what it cost. A run that is red, then green-and-doubted, then
green-and-doubted again has three stories, and the same doubt three times
("the criteria are wrong") is different news from a new doubt each time ("the
reviewer is wandering"). `attempts`, `gauge` and `acceptance` stay as they are,
holding the last round, because the journal is appended and never rewritten;
the task detail shows a line per round for a run that went round twice, and
leaves a run of one round — which is what every line already written is — drawn
by the lines it has always had. The rejected rounds are on the task branch too,
a commit each, so `git log` says what was said when.

**`summary` reports what the retry has to earn:** of the runs that passed, how
many were accepted on a round after the first, having been doubted on an
earlier one. Near zero and the feature is not paying for itself, which is a
thing the journal should be able to say without anyone reading lines by hand.

## 0.7.0 — 2026-10-21

0.6.0 made the dashboard sections and gave it a task to open. This is the
release where a person said the sections were not much use yet, and said why in
eight specific ways. All of them are here.

**The page answers questions instead of holding tables.** Overview opened with
lifetime averages — pass rate, cost per pass — while the two things somebody
actually opens a dashboard for were elsewhere: what is running was a sentence
in the header, and what is next was behind a click, in a table that did not say
it was in run order. It now leads with what is running, what is next in the
order a run will take it, and what is waiting for a person; the averages are
below, because *was it worth it* is a different question from *what now*. The
queue is cards rather than four thin tables, with the reason a task stopped on
the face of the card instead of under the height of a row — `abandoned by hand`
had been invisible in `failed/` since the section existed. Columns sort, and
sorting the view of `todo/` says in a sentence that the order a run takes them
is unchanged. Opening a task leads with what its runs cost: attempts, the
implementation against the acceptance pass in money and tokens, which model
ran which, how long. Every number was already in the journal line; nothing new
is recorded.

**A task opens over what you were reading.** It was a seventh section, so
clicking a row replaced the list you were working down
([0022](docs/adr/0022-the-task-detail-is-a-drawer-over-the-section-you-were-on.md)).
It is a drawer now, the section behind it stays where it was, and Escape or the
close control brings you back to it. **The fragment grammar changed with it:**
`#queue/task/0049` names both, and `#task/0049` — the shape 0.6.0 shipped —
no longer names anything. It lands on a section, which is the landing rule
working, and it is a link that used to go somewhere.

**And the page says what it cannot do.** The question that prompted half of
this was whether tasks could be started from the dashboard. They cannot, and
the reason is not that nobody got to it: detent has already read the queue and
moves tasks by its own results, the page writes the configuration and nothing
else ([0015](docs/adr/0015-the-dashboard-may-write-the-configuration-between-runs.md)),
and `detent run` is the most consequential thing this product does. So the
Queue section explains how to make a task and how to run one, with this
product's own paths and the next number worked out, and says plainly that it
will not do either itself.

Five tasks, and two of them cost four runs each. The acceptance pass demoted
green work six times across the batch and was right six times — three findings
in the code, and three in the tasks the work was judged against: a criterion
that contradicted its own out-of-scope, a criterion asking for something in a
commit body that `core/run.mjs` leaves no room for, and a miscounted field
list. `0004` says a model's judgement may only raise a doubt and send the task
to a person. It did, and the person was wrong half the time.

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
  and then calls `stopAgents`. No assertion was dropped, and each one can be
  named where it now lives. *a call past its limit is stopped, and says which
  limit* keeps `assert.ok(Date.now() - started < 5000)`, `result.ok === false`
  and `result.error === 'claude ran past the 0.1-second limit and was
  stopped'`. *a stopped agent takes its whole process group with it,
  grandchild included* takes the two that needed the fixture: `result.ok ===
  false` after `stopAgents`, and `alive() === false` for the pid read out of
  the pidfile — the grandchild — with the Linux `/proc/<pid>/stat` state `Z`
  and macOS signal-0 branches of that check carried over untouched. The waits
  that remain are bounds a broken fixture fails against rather than budgets a
  slow machine is measured against. Run against load to check that: five full
  `npm run verify` runs against ten `yes > /dev/null` processes (one per core)
  and a second `npm run verify` looping beside them — 329 passing every time,
  the whole suite stretched from 22s to 47–57s, and these two tests unmoved at
  0.10s and 1.1–1.7s, inside the 5s and 10s bounds they are checked against.
  Checked again against the same ten `yes > /dev/null`: two runs, 329 passing
  both times, suite 34.0s and 34.7s against 22s idle, these two tests at 0.11s
  and 0.79s. No change to `core/agents.mjs`: the timeout worked, the test
  measured it with a stopwatch.

### Changed

- **A task opens over the section you were reading, not instead of it.** 0043
  made the detail a seventh section, which is what "one section at a time"
  implied and what it was wrong about: a person in Queue working down a list
  clicked a task and the list was gone — along with which row they were on and
  which ones they had already looked at. The first report of it said exactly
  that: *the page jumps somewhere and the thread is lost.* The detail is a
  **drawer** over whichever section is showing now
  ([ADR 0022](docs/adr/0022-the-task-detail-is-a-drawer-over-the-section-you-were-on.md)).
  The section behind it stays rendered, keeps its scroll and its sort, and is
  not drawn again — opening a task reads `task.json` and `log.json` and nothing
  else — so closing is nothing to restore. **The fragment names both**:
  `#<section>/task/<number>`, and a fragment with no task is the bare section
  exactly as before. `sectionFor` was `ids.includes(name) ? name : ids[0]`, an
  exact match on a name, and is the part before the first slash against that
  same list; `taskFor` takes the section list too and wants the whole of what
  follows to be `task/<digits>` after a section this page has, so half a
  fragment opens nothing rather than the half of it that parses —
  `#nope/task/0043` and `#queue/task/nope` both **land on a section**, which is
  0041's rule covering every new way of getting the longer shape wrong, and
  neither is corrected. **Closing rewrites the fragment to the bare section**,
  which is the one thing on this page that writes `location.hash`: landing is
  the page guessing at something somebody typed and closing is a person acting
  on the page, and leaving `#queue/task/0043` in the address bar after they
  closed it would be the page lying about where they are. **Escape closes it**,
  and so does a `Close` control in its head, because a panel covering content
  with no obvious way back is worse than the section that got replaced. **The
  detail is a drawer and nothing else**: `SECTIONS` has lost its `task` entry
  and the nav its `Task` link, because two ways to see one task would be two
  code paths free to disagree about what a task is — the problem ADR 0020
  part 2 spent a task removing from the configuration. Every list that opens a
  task names the section it is drawn in — Overview's three blocks, the four
  queue folders, the recent runs — written at the call rather than read off the
  fragment, so a row's link cannot depend on what was on the screen when the
  page last drew it. The log panel moved with the detail and is read exactly as
  it was: the same one timer, the same request, the same ask to carry on from
  the byte its last answer ended at. **On a narrow screen the drawer is the
  screen** — the section replacement this exists to avoid, arriving through the
  viewport instead of the navigation, which is the right behaviour there and
  means the improvement is partly a desktop one; it is a `@media` rule rather
  than a width that happens to overlap, and the head the drawer is closed from
  sticks to the top so the way out stays reachable. No animation, no
  transition, no library, no centred modal, no expanded row and no second tab:
  ADR 0022 rejected each by name. A drawer is a positioned element and a
  `hidden` attribute, so the page still has one timer, one document, one
  request, no second asset and the content security policy ADR 0015 wrote.
  **`#task/0043` — the fragment 0043 shipped, and anything already linking to a
  task that way — no longer names anything.** It lands on a section, which is
  the landing rule working, and it is a link shape that used to go somewhere
  and now does not.
- **Opening a task leads with what its runs cost.** `renderTask` built the
  detail in the order the file is written — head, frontmatter, goal, acceptance
  criteria, out-of-scope, and **last** `What its attempts did` — which is the
  opposite of the order it is read in. A person opening a task that has run
  scrolled past four blocks to find out whether it had run at all. The block is
  **first** now, directly under the head, and the body keeps its own order
  below it with nothing dropped. It was one table row per run — finished,
  outcome, attempts, one cost, verdict, links — and is a block per run: the
  outcome, how many attempts, **how long it ran** from `started` against
  `finished`, when it stopped, and **`resumed`** said out loud, because a task
  that came back from `hold/` and finished is not the same story as one that
  passed first time and the attempt count alone does not tell them apart. Then
  **what the implementation cost and what the acceptance pass cost, kept
  apart** — one number for both hid what reading the work cost against what
  doing it cost (ADR 0004) — each with its tokens in and out and **the model it
  ran on**: the requested name and, when the CLI reported a different one, the
  reported name beside it; a `requested` with no `actual` reads *requested —
  the CLI reported no model* rather than standing in for a confirmation. The
  run's own total is shown beside the two rather than instead of them, and the
  implementation figure is that total less the acceptance figure and nothing
  else, so a line whose two numbers disagree shows that it does rather than
  having the disagreement resolved on the way to the screen. Under those: which
  gauge stage sent it back, whether it merged and as what commit, the branch,
  the verdict with its doubts, and whether the links checked. **A field the line
  has as `null` now reads *not reported***, in the history block and in
  `verdict` and `checked` too, where it had been an em dash — a dash among real
  figures reads as a zero, and a zero nobody recorded is the one thing the
  journal has always refused. A task the journal has never seen says so in a
  sentence and grows no table of blanks. The head is **a number and a name** —
  `0001 · First`, from the slug by the same `taskName` the queue's cards use —
  with the folder and the path still beside it, small. **No field was added to
  the journal line and nothing new is recorded:** every figure was already
  there, and no rate, average or projection is computed, because `summary` and
  **Agents** are where runs are compared and this is one task's record.

- **The queue is a queue you can read.** It was four tables of two or three
  columns, each in about a third of the page's width, and each one hid
  something. `because(t, parked)` built a cell as a stacked `div`, so in
  `failed/` the words **abandoned by hand** sat under the height of the row
  they were in and were never seen at all. A task read `0043
  a-task-is-something-you-can-open` — a file name, not a name. `done/` was in
  ascending id order, so the oldest thing you had finished was at the top.
  Every task is a **card** now: the number and its name on one line, the path
  under it, small, and every fact on a line of its own. **A card's rows do not
  wrap** — `flex-wrap: nowrap` on both of them, so what is laid out in a row
  stays in one row and anything longer than a row is a line, which is what
  keeps a word from falling through a fold a row has. The name is derived from
  the slug where it is drawn (`0043 · A task is something you can open`) and
  **no `title` field was added to the frontmatter**: the slug already is the
  name, and a second place to keep it is a second place to get it wrong. The
  card carries what `Recent runs` carries about the same journal line — how
  many attempts, what it cost, when it finished, the acceptance verdict — and
  a task the journal has never seen says *that*, rather than showing dashes
  that read like zeros. `todo/` stays in ascending task id with the line above
  it saying that is the order a run takes them; `done/` and `failed/` open
  newest first, by what the journal says finished and by the number when it
  says nothing. **Any column sorts on a click**, the arrow says which and
  which way, and the choice survives the three-second read because it is held
  in the page rather than in the markup the read replaces — a sort of `todo/`
  says the run order is unchanged, because `schedule()` sorts by `Number(id)`
  and nothing on this page changes that. The four folders are still four
  folders: a person moves files between them by hand, and a view that hid
  which one a file was in would make that harder.
- **The Queue section says how to make a task and how to run one**, because
  the page cannot do either: the next number — one past the highest across the
  four folders, which is the counter detent reads on disk — the file in this
  product's own `todo/` in the shape `DESIGN.md` §4 gives, `detent plan` to be
  talked through one, and `detent run` or `detent run <id>` to start it, each
  with this product's own `--product` path in it and ready to copy. And it says
  plainly that **the page does not run or move tasks**: detent has already read
  this queue and moves these files by its own results, and a second writer of
  them is a bug that arrives later disguised as a mystery (§12). Nothing in
  this change writes — ADR 0015 fixed what the page may write and the queue is
  not on that list.
- The snapshot's queue entries now carry `attempts`, `cost`, `finished` and the
  acceptance `verdict`. `snapshot()` was already reading each task's last
  journal line for its outcome, its reason and the reviewer's doubts, and
  dropping the rest — so a card in the queue could not say how many attempts a
  task took while a table two sections away said it about the same run. Four
  fields out of a line already read; nothing new is read, and nothing was
  added to `state.json`.
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
