# 0014. `init` asks where the queue and the documents are, and a task's links are checked against them

- **Date:** 2026-10-17
- **Status:** accepted

## Context

0012 made the queue's location configurable and 0013 refused the kit a name.
Between them they left everything to a person editing `product.json` by hand,
and what that person has to know has grown: which repository holds the tasks,
whether one does at all, and whether the documents a task links to are mounted
where the agent can reach them.

The scan cannot work the first of these out. A repository meant to hold tasks
looks like any other until there are tasks in it, and at `init` there are
none. The second it cannot work out at all: the documents repository is
whichever one a person decided would hold decisions.

The third is worse, because it fails quietly. A task body links to a
document — that is what linking documents from task bodies is for. If the
documents are not mounted in the repository the task names, the agent is
handed a path it cannot follow and **nothing notices**: not the queue
validation, which reads frontmatter and file names; not the gauge, which runs
commands; not the acceptance pass, unless the agent says so itself. The task
goes green having been built without the context it was told to use.

## Decision

Four parts.

**1. `init` asks.** Two questions, after the scan and before the file is
written: whether one of the repositories it found is the queue, and whether
one of them is the documents. This is **the first time detent asks a question
itself** — `plan` is interactive by handing the terminal to the agent
(`stdio: 'inherit'`), and detent has never read from stdin.

**2. Flags answer the same questions without a terminal**, and the defaults
are announced rather than assumed. `--queue` and `--docs` say what the
questions would have asked; `--docs none` says there are none. With no
terminal and no flag, `init` takes the defaults and prints what it took: a
`tasks` folder at the product root, and no documents repository. It must never
wait for an answer nobody is there to give.

**3. `docs` is named in `product.json`,** and that makes it the first role
named after a function. The rule this sets, which is the part worth keeping:
**a role earns a name when detent's behaviour depends on it.** The queue has
one because detent writes into it. Documents get one because the validity of a
task depends on them. The kit has none, and 0013 is why.

**4. A link is checked at the start of the task, after the submodules are
refreshed.** A link is a relative path from the root of the repository the
task names, which is the only form that means anything when the documents
arrive as a submodule: `shared-docs/adr/0003.md` in a task for `acme-api` is
`acme-api/shared-docs/adr/0003.md`. A broken one is **told to the agent** as
part of what it is given, recorded in the journal, and visible to the
acceptance pass. It is not a reason to stop.

## Consequences

- `init` can be run by a person who knows nothing about `product.json`, and by
  a script that knows everything, and neither waits on the other's assumption.
- The check runs on the revision the agent will actually read, because the
  refresh has already happened, and costs nothing beyond what the refresh
  already did.
- **A task whose document is missing still runs.** The agent is told, the
  journal says so and the reviewer sees it — but the work happens without the
  context the task named, and it can end green. That is the price of not
  stopping, and it is paid deliberately: a task may name five documents and
  need one, and detent cannot tell which.
- `docs` is the second name after `queue`. The rule in part 3 is what stops
  there being a third for every repository somebody thinks is special.
- Interactivity is a new shape for this tool. Every command it had either did
  its work or handed the terminal to somebody else; now one of them has a
  question, and a question has to behave when there is nobody to answer it.

## Alternatives rejected

**Pause the task on a broken link.** The position this tool's thesis argues
for: a precondition failed, so nothing should proceed to green. It lost to the
observation that detent cannot tell a load-bearing link from a decorative one,
and that stopping on the decorative one trains a person to stop reading the
reason. Handing the agent the fact, and the reviewer the record, keeps the
information without making it a verdict — but the ADR records that this is
weaker, and that a task can now be green and under-informed at once.

**Check the links at queue validation, before the run.** Cheaper, offline, and
earlier, which is where this tool usually wants its answers. It reports a
missing file for a document that was pushed and not yet fetched — a false
alarm about exactly the freshest documents, which are the ones a task is most
likely to name. A check that cries wolf about new work is worse than a check
that runs a minute later.

**Let the session agent put tasks wherever it likes.** It already knows the
structure, and that is the argument: it knows it this time. Writing the answer
into `product.json` means `run`, `plan`, `doctor` and the next session all read
the same one, instead of each inferring it from what they find.

**Name every repository's role.** The symmetrical thing to do once `docs` has
a name, and the reason part 3 states the rule instead: a name that nothing
branches on is a comment with a schema, and it has to be kept true for as long
as the product exists.
