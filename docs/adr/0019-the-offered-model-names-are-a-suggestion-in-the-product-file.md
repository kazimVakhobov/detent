# 0019. The offered model names are a suggestion in the product file, never a constraint

- **Date:** 2026-10-20
- **Status:** accepted

## Context

`models.<role>.model` is validated as a non-empty string and nothing more
(`core/product.mjs`, `validateModels`). The dashboard offers a free text input
beside the agent select (`core/dashboard-page.mjs`, `modelField`). Both are
right and neither helps the person who has to fill them in: there is nowhere
to learn what to type. `detent init` was reported refusing a file with seven
problems, one of them about models, by somebody who said plainly that there
were no keys anywhere and no way to know what a model name looks like.

Three sources of a list were considered, and each fails differently.

**The local CLI does not hold one.** `claude --help` has no `models`
subcommand. `--model` with no value errors on the missing argument.
`/opt/homebrew/bin/claude` is a Mach-O binary, and `strings` on it yields a
historical set including names that no longer exist. `~/.claude` holds names,
but they are usage traces — empty on a machine that has not run anything yet,
which is exactly the machine running `init`.

**The API has one, and it is credential-scoped.** `GET /v1/models` returns
`id`, `display_name` and a capability tree, with no beta header. It returns
what the calling organisation can see, so it answers "what may this key run"
rather than "what exists" — and detent holds no key. It drives the CLI a
person already pays for and ships none of its own ([ADR
0013](0013-the-agent-gets-a-prompt-and-a-directory.md)). Reaching for a
credential to populate a dropdown would add the one thing this product has
deliberately never had.

**Availability is not one axis.** It was assumed to depend on the account. It
also depends on the installed CLI: `--model claude-opus-5-5` returns `400
Claude Code 2.1.220 does not support this model; version 2.1.280 or newer is
required`. A list that was correct for an account can still be wrong for the
binary in front of it.

So nothing can answer "which models can this person run" before one is run.

## Decision

**detent ships a list of model names, `init` writes it into `product.json`,
and it is a suggestion.** The field that uses it stays free text, and the
validator never checks a model name against the list. A name that is not on it
is accepted, configured, and run.

**The list leads with the aliases, because they are the part that does not
rot.** Verified by running them rather than by reading about them: `claude -p
--model opus|sonnet|haiku` all succeed, and `modelUsage` comes back naming the
resolved model — `opus` → `claude-opus-5`, `sonnet` → `claude-sonnet-5`,
`haiku` → `claude-haiku-4-5-20251001`. An alias in the configuration therefore
costs the journal nothing: `requested` keeps the alias, `actual` keeps the
concrete model, and the pair stays comparable across months in which the alias
pointed at different things.

The full identifiers follow, for pinning, limited to the ones that answered on
this machine today.

**The list is in `product.json` rather than only in detent** so that extending
it is editing a file the product owns, and so that what a person is offered is
visible next to what they chose.

## Consequences

- **The list goes stale, by design.** That is the cheapest of the available
  failures: a stale suggestion costs one line in a file its owner can edit,
  where a stale validator whitelist costs a product that will not load.
- **It ships incomplete, knowingly.** `claude-sonnet-5-5` and
  `claude-haiku-5-5` both answer on the machine this was written on and are
  not in the shipped list, because one machine is not evidence about a
  subscription. They are exactly the case the note on the page describes.
- A model the account or the CLI version cannot run fails on the first
  attempt, carrying the service's own sentence. detent reads that correctly —
  an errored result arrives as `is_error: true` with `subtype: "success"`, and
  the `ok` check requires both — so the turn fails rather than passing with an
  error message as its output.
- detent still ships no credential and makes no network call of its own.
- The dropdown is honest about what it is. It does not claim the list is what
  the account can run, because nothing it has access to knows that.

## Alternatives rejected

**Validate against the list.** The obvious reading of "ship a list", and it
converts a stale suggestion into a product that refuses to load. The three
axes above guarantee the list is wrong for somebody: a new model, an older
CLI, a different plan. A tool that refuses a model its own agent would have
run is worse than one that offers no help at all.

**Ask `GET /v1/models` at run time.** Current, structured, and it needs a
credential detent does not have and should not start wanting. It would also
answer a question nobody asked — the API platform's catalogue is not the set
of names the CLI accepts, and the two are allowed to differ.

**Build the list from the journal's `models.actual`.** Needs no credential,
never lies, and shows exactly what this machine has run. It is also empty on
the first run, which is the only run where a person does not know what to
type. It remains a good second source and may be added to the suggestions
later; it cannot be the only one.

**Ship no list and document the names in the README.** What is happening now.
The names are then in a file nobody has open while filling in the field that
needs them, and the README goes stale with none of the editability that makes
a stale `product.json` entry a one-line fix.
