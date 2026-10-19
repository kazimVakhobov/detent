# 0020. The dashboard is sections, and the configuration is read before it is written

- **Date:** 2026-10-20
- **Status:** accepted

## Context

`core/dashboard-page.mjs` serves one page as one template string: nine blocks
down a single scroll — the state, the figures, the repositories, the queue
beside the paused tasks, the agents, the recent runs, the configuration, the
keys that are not editable, the footer. It was the right shape when it only
read. [ADR 0015](0015-the-dashboard-may-write-the-configuration-between-runs.md)
gave it inputs, and three things about that shape are now wrong.

**The configuration is always in edit mode.** Every value is a live `input` or
`select`, whether or not anybody intends to change one. Reading which model a
repository uses means looking at the contents of form controls, and the page
also states the same fact in the repositories table in a different format
(`implement claude …`, `review …`). Two renderings of one fact, free to
disagree.

**It is dead exactly when it is most wanted.** While a run is active every
control is disabled — which is correct for writing and costs the reading too.
A person who opens the page during a run to check which model is costing what
finds the answer greyed out.

**The page throws away data it already has.** `snapshot()` reads all four queue
folders (`FOLDERS` is `todo`, `hold`, `done`, `failed`) and the page renders
two. `numbers.byRepo` is computed and displayed nowhere. `recent` carries whole
journal lines and six fields of them are drawn. Nothing needs fetching to show
more; it is already in `state.json`.

**A task is a row of text.** `id + ' ' + slug`, and for a paused one its reason
and the reviewer's doubts. Not the goal, not the acceptance criteria, not what
the attempts did. `core/task.mjs` already parses a task into those sections —
`parseTask` and `section(body, title)` — and the page has never seen them.

## Decision

**Four parts.**

**1. The page is sections, one shown at a time, named in the fragment.** Not a
single scroll. The fragment means a reload and a copied link both come back to
where somebody was, with no server route and nothing loaded from outside. The
sections hold what is already read, including the two queue folders and the
per-repository numbers the page currently discards.

**2. The configuration is read until a person says otherwise.** Viewing is the
default and shows what the file says as text, not as controls. Editing is
entered deliberately, and leaving it discards. **This narrows a rule recorded
in a comment rather than in an ADR**, at the head of
`core/dashboard-page.mjs`: that the configuration is fetched once and after a
write and *never polled*, because "a form whose values move under the person
filling it in would be a third state between what the file says and what the
page shows." That reasoning holds and now applies to half the panel. **The
view may refresh; an open editor never does.**

Entering edit mode is refused while a run is active, with the explanation 0015
required. **Viewing is not** — the whole point of separating them is that
reading the configuration during a run was never the thing that had to be
stopped.

**3. A task can be opened, and its body is shown as text.** Its frontmatter,
its goal, its criteria, its out-of-scope, and what its attempts did. **detent
renders no markdown.** The page's founding rule is that every value is set as
text so that a task title or a reviewer's doubt can never become markup; a
task body is markdown written by whoever wrote the task, and rendering it means
either breaking that rule or writing a sanitiser under
[ADR 0006](0006-zero-dependencies-node-22.md)'s no-dependencies constraint.
Structure comes from the sections `parseTask` already finds.

**4. The source is split into modules; the served artifact stays one page.**
The string is composed at import time from several files instead of being one
409-line literal. One request, one document, no second asset, and the content
security policy is unchanged.

## Consequences

- **Something is always hidden now.** A single scroll had the property that
  everything was somewhere below you; sections mean a person can be looking at
  a page that does not contain the thing that is wrong. Whatever is urgent —
  a run that died, a paused task, a queue that will not parse — has to survive
  outside the section it belongs to, or the split has made the page worse at
  the one job it had.
- The configuration becomes legible during a run, which it was not.
- **There is a new way to lose an edit**: an open editor that does not refresh
  can be submitted against a file something else changed. 0015 already
  accepted that a second tab can race the file (condition 8 is one person per
  workspace); an editor that is deliberately stale widens the window from
  seconds to however long it stays open. The write still validates whole and
  still refuses during a run, so what is lost is the edit and never the file.
- Opening a task means the server reads a file in the queue and sends it to the
  page. The id is a number, resolved through the queue detent already read —
  it never becomes a path, and nothing outside the queue is reachable by asking
  for it.
- A task body shown as text looks like a text file, because it is one. Somebody
  will ask for headings.
- Four files to read instead of one, for the same page. The split pays only if
  each piece is a section somebody can find; it is a cost otherwise.

## Alternatives rejected

**Leave the single scroll and only add the task detail.** The smallest change
that answers the loudest complaint. It also puts a third dense block onto a
page whose densest block is already at the bottom, and leaves the
configuration in permanent edit mode — the thing that made somebody ask for
this.

**Keep one edit mode and make it read-only during a run.** What the code
already does by disabling inputs, said more nicely. A disabled text field is
not a readable value: it is a value you may not have, rendered in the control
you may not use.

**Render the task body as markdown.** What everybody expects, and the page
sets every value as text for a reason that a task body does not get to be an
exception to. With no dependencies the sanitiser is ours to write and ours to
be wrong about, and the failure mode is a task title that becomes markup on
the one page that is supposed to be safe to look at.

**Serve the script as `/dashboard.js` and tighten the policy.** It would let
`script-src 'unsafe-inline'` go, which is a real improvement and the reason
this is written down rather than dismissed. It also makes the page two
requests and an asset, and "one page that loads nothing from outside" is a
property worth more than the policy string is. Worth revisiting on its own,
not as a side effect of moving blocks around.

**A page per section, served by the server.** Routes, a reload per click, and
state refetched each time. The fragment gets the addressability without any of
that.
