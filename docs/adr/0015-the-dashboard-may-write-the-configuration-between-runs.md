# 0015. The dashboard may write the configuration, and only between runs

- **Date:** 2026-10-18
- **Status:** accepted

## Context

`detent dashboard` serves one page on `127.0.0.1` that watches a product. It
answers `GET` and `HEAD`, replies `405 the dashboard only reads` to anything
else, and `DESIGN.md` §12 says so twice — once about the page and once under a
heading of its own, *The dashboard is read-only while a run is active*.

Everything it displays comes from a file a person edits by hand. Which model
implements and which reviews, how many attempts a task gets, how long an agent
may run, where the queue is, which repository holds the documents — all of it
is `product.json`, and changing any of it means leaving the page, finding the
file, and knowing its schema. The page that knows what the product is cannot
change what it is, and the two things are the same JSON.

There is also a reason it was read-only that is not about taste. The files
that judge an agent are fingerprinted before each of its turns — `product.json`
holds the gauge, the task file holds the criteria, the journal holds the
record (`core/run.mjs`, `digest`) — and a turn that changes one of them pauses
the task. That guard does not ask **who** changed the file. A dashboard
writing `product.json` during a run would trip it, and the task would pause
blaming the agent for a person's edit.

## Decision

**The dashboard may write `product.json`, and only when no run is active.**

Three parts.

**1. What it may change is the product's configuration and nothing else.** The
models for each role, product-wide and per repository; `attempts`; `timeout`;
`concurrency`; `notify`. Not `repos`, not `queue`, not `docs`, not
`branches` — those name things on disk, and a page cannot create what it
names. They are shown, and shown as not editable here.

**2. A write is refused while a run is active, by the same `state.json` that
`recover` reads.** The inputs are disabled on the page and the request is
refused by the server, because a disabled input is a courtesy and the refusal
is the rule. The refusal says a run is active and names what it is working on.

**3. Every write goes through the same validation a file edited by hand goes
through** — `validateProduct`, every problem at once, each naming its path —
and is rejected whole if any of it fails. A page may not write a
`product.json` that `detent run` would refuse to load.

## Consequences

- The configuration can be changed where it is read, by somebody who does not
  know the schema, and the schema stays the thing that decides what is
  allowed.
- **The dashboard stops being read-only**, and the sentence that said so has
  to go from `DESIGN.md` and the README. What replaces it is narrower and less
  memorable: it reads a product and writes its configuration between runs.
- The page now has a state where it refuses to act, and that state is a
  product of something happening in another process. A disabled input that
  nobody explains is worse than no input, so the explanation is part of the
  feature rather than a nicety.
- `state.json` becomes load-bearing for something besides `recover`. A stale
  one — written by a run that was killed — would lock the inputs until
  `detent recover` is run, which is the right answer and an unobvious one.
- A second person, or a second tab, can still race the file. Detent is one
  person per workspace (condition 8) and this does not change that; it only
  makes the single person able to lose their own edit by having two tabs open.

## Alternatives rejected

**Leave it read-only and keep editing the file.** Nothing to build, nothing to
explain, and it was right while the file had six keys. It now has twelve, two
of them added this month, and the number of people who know them by heart is
one.

**Write through a queue of changes applied between runs.** Keeps the page
usable during a run, which is when somebody most wants to change the model
that is failing. It also means a change that was accepted but has not happened
yet — a third state between what the file says and what the page shows, and
the page exists to say what is true.

**Edit the file and let the fingerprint pause the task.** Honest about the
mechanism and useless: the pause would name the agent, which did nothing, and
a person would learn to distrust the guard that exists to catch an agent
editing its own criteria.

**A `detent config` command instead.** Correct for a tool that is only a CLI
and a worse fit for the thing being asked for: the page is where a person is
already looking at which model is costing what, and the change belongs where
the number that prompted it is.
