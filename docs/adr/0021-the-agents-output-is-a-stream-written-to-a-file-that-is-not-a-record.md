# 0021. The agent's output is a stream, written to a file that is not a record

- **Date:** 2026-10-20
- **Status:** accepted

## Context

A run printed a line when a task started and a line when it ended. Between
them — minutes, and on a hard task a quarter of an hour — it printed nothing,
and the person who dispatched it had no way to tell working from stuck without
reaching for `ps`. Everything the agent said was in `core/agents.mjs`,
accumulating in a string that was read for its last object and then dropped.

Two facts made the obvious fix cheap, and both were checked rather than
assumed.

**The output can be a stream.** `claude -p --output-format json` returns one
object at the end. `--output-format stream-json --verbose` returns JSONL as the
work happens — `system/init`, `rate_limit_event`, assistant messages, tool use
— and **its last line is the same `type: "result"` object detent already
parsed**, carrying `result`, `session_id`, `total_cost_usd`, `usage` and
`modelUsage`. Reading the last JSON object of a stream instead of the only one
keeps every number the journal records.

**There is one agent now** ([0018](0018-one-agent-in-the-first-version-and-what-readmits-another.md)).
Streaming had meant writing three readers, or privileging one of three CLIs in
the most load-bearing code in the product. That reason is gone.

What was left to decide is where the output goes and what it is allowed to
mean. A transcript is the most tempting file in a dispatcher: it is the longest
and the most detailed, it appears to say what happened, and nothing in it has
been checked by anything.

## Decision

**The agent is invoked so that its output arrives as it happens**, and each
attempt's raw stdout is written to
`<product>/runs/logs/<task>-attempt-<n>.jsonl` as it arrives — byte for byte,
with nothing added and nothing parsed on the way in.

**The name is the index.** Nothing records where a log is: a task id and an
attempt number are enough to write the path by hand, which is what makes
`tail -f` possible without copying anything out of a terminal a run has
occupied. `detent run` prints the path for attempt 1 when a task starts and
shows nothing — several tasks may be running, and their output interleaved in
one terminal is unreadable.

**It is not a record.** Nothing reads a log to decide an outcome, a cost, a
verdict or a model. Every number in a journal line comes from the result object
exactly as it did before this file existed, and a number taken from a
transcript would be a number nobody can check. The stream is parsed in one
place only — the dashboard, for display — and a line that will not parse is
shown as it arrived.

**Losing it never costs the task.** A log that cannot be opened or written says
so once, on stderr, and then does nothing. The run carries on; the journal is
unaffected; a sink that throws loses the log and not the run.

**The dashboard is where it is read**, inside the task's own detail view, under
its body and its history, on the timer the page already has. The page asks to
carry on from the byte its last answer ended at, keeps a bounded number of
lines, and clips each one — so a page watching a long run neither re-reads what
it has nor grows with the output. When a task is not running the page says, in
a sentence, that what it shows is what the last attempt said rather than
something happening now.

**It goes no further than this machine.** A transcript holds whatever the agent
read: file contents, values from the environment, whatever a tool returned.
Today that lives in memory and disappears, so writing it down is already a new
surface. The dashboard is on loopback and that is as far as it goes.

**It has a stated end.** `detent prune` deletes the attempt logs of tasks in
`done/` and `failed/`, and of tasks whose file nobody can find; a task in
`todo/` or `hold/` keeps its last attempt, because that is what a person opens
it to read, and a task a run is holding is being written to right now.

## Consequences

- A person watching a run can see what it is doing, on the surface they were
  already looking at. This is the whole point and it is worth the rest.
- **There is a new file on disk holding everything the agent read.** It is the
  first artefact detent writes that is neither configuration, queue nor
  journal, and the first with a privacy cost. The mitigations are above and
  they are mitigations, not an argument that the cost is zero.
- `agents.mjs` reads the last JSON object of its input rather than all of it,
  which is strictly more general: one object, one object after a banner, and a
  stream are the same question with the same answer.
- Decoding moved from `stdout += chunk` to the stream, which fixes a latent bug
  the single object survived by luck: a multi-byte character split across two
  chunks was two broken halves.
- The acceptance pass streams too, and no log is written for it. Its output is
  a verdict and its doubts, which the journal line carries and the task detail
  already shows.
- `prune` grows a second job and a dependency on the queue. A queue that will
  not read keeps every log and says why — the one thing worse than a transcript
  nobody deletes is one deleted because the folder it belonged to would not
  open.

## Alternatives rejected

**Put the events in the journal.** One file, no new surface, and it would make
the journal unreadable at the exact moment it matters: the thing the numbers
are computed from would be mostly tool calls. The journal is append-only and
one line per run on purpose, and an event stream in it is a format change
nothing downstream asked for.

**Show the stream in the terminal as the run goes.** Readable with one task and
noise with three — `concurrency` defaults to 3, and the scheduler exists to run
tasks side by side. The path is the offer and `tail -f` is the person's choice.

**Parse the stream for the numbers, now that they arrive early.** It would give
a running cost per attempt and a live tool count, from a source nothing
validates, computed by code that would have to track a format detent does not
own. The result object is the vendor's own total; a sum detent computed from
events would be a second number free to disagree with it, which is the mistake
0020 part 2 recorded about the configuration.

**Keep the log in memory and serve it from the run's process.** No file, no
lifetime, nothing to prune — and the dashboard is a separate process, so it
would need the run to serve it, which is a second server, a port and a protocol
between two of detent's own commands. A file is the interface both already
have.

**No lifetime: keep every log forever.** It is what every tool does and it is a
disk leak with a feature request attached. An artefact with no stated end is
one somebody discovers at forty gigabytes.

**Delete a log when its attempt ends.** It would make the dashboard's non-running
case impossible — "what the last attempt said" is the sentence a person reading
a paused task needs, and a transcript deleted at the moment the run stopped is
deleted exactly when it became interesting.
