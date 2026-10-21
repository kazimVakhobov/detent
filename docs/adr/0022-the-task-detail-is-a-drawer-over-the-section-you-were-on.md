# 0022. The task detail is a drawer over the section you were on

- **Date:** 2026-10-20
- **Status:** accepted; narrows 0020 part 1

## Context

[0020](0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md)
made the page sections, one shown at a time, named in the fragment. Opening a
task then became a seventh section, which is what that decision implied and
what it is now wrong about.

A person is in Queue, comparing four folders. They click a task. **Queue is
gone** — replaced, because that is what "one section at a time" means. They
read the task, and to get back to the list they were working through they
navigate again, having lost which row they were on and which tasks they had
already looked at. The first report of this said it exactly: *the page jumps
somewhere and the thread is lost — which task I was looking at, what I was
doing.*

This is 0020's own first consequence arriving in a shape it did not predict. It
warned that a person could end up looking at a page that does not contain the
thing that is wrong, and answered that with a strip of warnings outside every
section. The same mechanism also means a person can end up looking at a page
that does not contain **what they were in the middle of** — and nothing
answers that.

A task detail is not a peer of Queue. It is something you open *from*
somewhere, look at, and close.

## Decision

**The detail is a drawer over the section, not a section of its own.** The
section behind it stays rendered and stays where it was; closing the drawer
returns to it with nothing to restore, because nothing was torn down.

**The fragment carries both**: `#<section>/task/<number>`. A fragment with no
task is the bare section, as it is today. This is where the grammar 0020
established has to grow — a fragment names *where you are*, and where you are
is now two things.

**Closing the drawer rewrites the fragment to the bare section.** 0041's rule
that nothing rewrites the address bar is about **landing** — a page that
corrects a fragment somebody typed loses the one thing the fragment was for.
Closing a drawer is a person's own action on the page, and leaving
`#queue/task/0043` in the bar after they closed it would be the page lying
about where they are.

**Escape closes it**, and so does a control that is visibly a close control.
A panel that covers content with no obvious way back is worse than a section
that replaced it.

**It is a drawer and nothing else.** The detail is not also reachable as a
section: two ways to see one thing is the problem 0020 part 2 spent a task
removing from the configuration, and it would arrive here as two code paths
free to disagree about what a task is.

## Consequences

- The thread survives. You open a task from a list, close it, and the list is
  the list you left, including how far down it you were.
- **The fragment grammar is no longer a name.** `sectionFor` was
  `ids.includes(name) ? name : ids[0]` — an exact match — and now has two
  parts to parse, with more ways for a hand-typed fragment to be wrong. The
  landing rule covers every one of them: anything unrecognised lands on a
  section rather than on nothing.
- **On a narrow screen a drawer is the whole screen**, which is the section
  replacement this decision exists to avoid, arriving through the viewport
  instead of through the navigation. It is the right behaviour there and it
  means the improvement is partly a desktop one. Said here rather than
  discovered.
- The page still has no router, loads nothing from outside, and serves one
  document. A drawer is a positioned element and a `hidden` attribute.
- `#task/0043` — the fragment 0043 shipped and anything already linking to a
  task — no longer names anything. It lands on a section, which is the rule
  working, and it is still a link that used to go somewhere and now does not.

## Alternatives rejected

**Keep it a section.** What exists. The complaint is not cosmetic: the detail
is the one surface a person opens *while doing something else*, and a section
is the one shape that guarantees the something else is gone.

**A centred modal.** The same escape from the navigation, and worse for the
actual content: a task body and its attempt history are tall and narrow, and
the thing a person most wants beside them is the list they came from. A drawer
puts them side by side; a modal puts the list behind a dimmed overlay.

**Open a task in a second browser tab.** Free, keeps both, needs no decision —
and gives up the single-document property for the one view with a live log on
the page's timer, plus it makes "which task was I looking at" a question about
the browser's tab bar.

**Expand the row in place.** No second surface at all, which is genuinely
attractive. Rejected because the detail is tall — frontmatter, goal, criteria,
out of scope, every attempt and a log — and a row that expands to that height
pushes the list it belongs to off the screen, which is the original problem
with extra steps.
