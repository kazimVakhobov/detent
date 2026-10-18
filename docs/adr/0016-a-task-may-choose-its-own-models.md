# 0016. A task may choose its own models — later, and this is the shape

- **Date:** 2026-10-18
- **Status:** accepted, not implemented

## Context

Models are chosen in two places. `models` at the root of `product.json` sets
them for the product; `repos[].models` overrides a role for one repository,
and a repository that overrides `implement` keeps the product's `accept`
(`core/product.mjs`: `{ ...models, ...repo.models }`). The reasoning is in
§11: a repository is a unit of ownership, so a Rust service and a landing page
may want different agents.

A task is not a unit of ownership, and for most of them the repository's
answer is right. But the journal has been saying otherwise since step 6. It
records which model ran, how many attempts it took and what it cost, per task,
and `summary` turns that into cost per pass by agent and model — which is the
measurement this product exists to make. Having made it, there is no way to
act on it below the repository: a documentation correction and a change to the
scheduler run on the same model because they are in the same directory.

The queue already distinguishes them in the one way that matters for
scheduling — `touches_contract` makes a task a barrier — so the task file is
already a place where a task says something about itself that its repository
cannot.

## Decision

**A task may name its own models, in its frontmatter, and this is not built
yet.** What follows is the shape it will take, recorded now because the
question has been asked and because half of the answer is what it must not
become.

```markdown
---
id: 0042
repo: acme-api
touches_contract: false
models:
  implement: { agent: claude, model: claude-haiku-4-5-20251001 }
---
```

Four constraints, which are the decision:

**1. The layering is the one that exists, with a third level.** Product, then
repository, then task, each overriding a role rather than the set:
`{ ...product.models, ...repo.models, ...task.models }`. A task that names
`implement` keeps the reviewer it would have had.

**2. Every rule that holds for the other two levels holds here.** `implement`
and `accept` must differ at least in model, or there is no acceptance pass
worth the name (ADR 0004); an unknown key is an error; the agent must be one
of the three. The validator is the same code, reading one more level.

**3. The journal records that the task chose.** `models.implement.requested`
already says what was asked for and `.actual` what ran. A third field says
where the choice came from — product, repository or task — because a summary
that cannot separate "this model is cheap here" from "somebody picked this
model for the cheap tasks" is measuring its own selection.

**4. It is a frontmatter key, so it is bookkeeping and never reaches the
agent.** §4 is explicit that only the body is the prompt. A task telling an
agent which model it is would be a task telling an agent about detent.

## Consequences

- The measurement becomes actionable at the grain it is taken at. A
  documentation task on a cheap model and a scheduler change on an expensive
  one stop being a thing you can only arrange by moving files between
  repositories.
- **It is the third place to look when a run used a model nobody expected**,
  and the journal field in part 3 exists because of that: without it the
  answer is a search through task files.
- A person can now give a task a model that cannot do it, and find out three
  attempts later. That is already true of a repository, and the cost of being
  wrong is now spread over fewer tasks.
- The acceptance rule gets easier to break by accident: a task naming
  `implement` as the model the product uses for `accept` makes the pass
  worthless, and the validator refusing it is the only thing between a person
  and a review by the author.

## Alternatives rejected

**Build it now.** It is three lines in the validator and a line in the prompt
assembly, which is exactly why it can wait: nothing about it gets harder
later, and nothing in the queue is asking for it today. The honest reason to
defer is that every key in a schema has to be kept true for as long as the
product exists, and this one has not yet been wanted by a real queue.

**A model per task *kind* rather than per task.** Tempting — "documentation
tasks are cheap" is the generalisation anyone reaches for — and it needs a
taxonomy of kinds that nothing else in this product has. `touches_contract`
is a property, not a category, and it earned its place by changing how the
scheduler behaves.

**Let the implementing agent choose its own model.** The cheapest to build and
the one that cannot be allowed: the thing being measured would be selecting
the measurement, and the journal would record a choice nobody made.
