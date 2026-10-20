# 0018. One agent in the first version, and what re-admits another

- **Date:** 2026-10-20
- **Status:** accepted; narrows 0010

## Context

0010 put three agent CLIs behind one call: Claude Code, Codex and Gemini CLI.
The reasoning holds and is not what changed. What changed is what is true
about the three.

**Only one of them has ever run.** The header of `test/agents.test.mjs` has
said so since the adapters were written, candidly and without anyone acting on
it: the samples are *"taken from the CLIs themselves: Claude Code 2.1 run for
real, Codex 0.160 and Gemini CLI 0.62 read from their event and formatter
code."* Every task detent has worked, here and anywhere, ran on Claude Code.
The journal has one agent in it.

**One of the three was replaced at the vendor.** Google stopped serving Gemini
CLI to free and individual accounts on 2026-06-18 and directs them to
Antigravity CLI, which is a different program with a different interface.
`core/agents.mjs` targets Gemini CLI 0.62. The README promises it.

**The third costs money that the role may not be worth.** Codex in the CLI
needs ChatGPT Plus at $20 a month or an API key billed per token. That is a
defensible price for implementing and a steep one for a reviewer that may only
ever raise a doubt (0004).

So the product claims three, has verified one, and one of the unverified two
points at a program that no longer serves the people most likely to try it.
That is a claim this repository would refuse from anybody else.

## Decision

**The first version offers one agent: `claude`.** The mechanism that chooses
an agent stays exactly as it is — a role names its agent, `product.json`
carries the shape, the adapter table is a table — and it has one entry.

**The other two are planned, not abandoned**, and this records what re-admits
one: **it has run a real task in a real repository, and its adapter was
written against what it actually printed rather than against its source.**
That is the condition the current two fail, and the reason they are leaving
rather than waiting.

The README and `DESIGN.md` stop promising three and say what is true, with a
link here.

## Consequences

- **The acceptance pass loses its only path to a genuinely independent
  reviewer.** With one vendor it must be a different model of the same family
  — shared training, shared blind spots — and `0004`'s "a model's judgement
  may only raise a doubt" is doing more work than it was meant to. This is
  the cost of the decision and it is not small; it is written here rather
  than discovered later by somebody wondering why the reviewer agrees so
  often.
- A product that configured `codex` or `gemini` stops loading, by the
  validator, naming the agent and this decision. Nobody is known to have one.
- Less code to keep true: two adapters and their tests go, and nothing claims
  behaviour nobody has observed.
- Re-admitting an agent is now a task with an acceptance criterion rather than
  an opinion. The bar is "it ran", which is the bar this product applies to
  everything else it says.

## Alternatives rejected

**Keep all three and mark which have been run.** Honest, cheap, and it leaves
the product offering two choices it cannot stand behind. A person picking one
would be picking an experiment, and the first thing it does is run an agent
unattended with `bypassPermissions`.

**Keep the adapters, remove them from the schema.** The same dead code with a
longer explanation. An adapter nobody can select is a guess that has stopped
being checked even by being wrong.

**Write the Antigravity CLI adapter now and keep three.** The replacement is
real and free at a tier, which makes it the obvious candidate — and it would
be a third adapter written from documentation rather than from a run, which is
exactly the mistake being corrected. It is the first candidate for
re-admission, under the rule above.

**Drop the agent field entirely and hard-code Claude Code.** Simplest, and it
throws away the thing 0010 got right. The shape is what makes adding one back
a configuration rather than a rewrite, and the cost of keeping it is a table
with one row.
