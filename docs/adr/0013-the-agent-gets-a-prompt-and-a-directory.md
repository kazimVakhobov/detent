# 0013. The agent gets a prompt and a working directory, and nothing else

- **Date:** 2026-10-16
- **Status:** accepted

## Context

The methodology of 0012 carries a third optional repository beside the
documents and the queue: a kit. What is in it was never settled — prompts,
templates, checklists, scripts — and the question that came with it was
whether detent should do something with it.

There is an obvious something. Every CLI detent drives has a way to be given
more than a prompt. Claude Code reads skills from `.claude/skills/`, hooks and
settings from `settings.json`, takes `--settings`,
`--append-system-prompt` and `--mcp-config`. Codex has its own configuration
and its own shape for it. Gemini has a third. A kit repository mounted in
every product repository is one short step from being wired into any of them.

Today detent takes that step with none of them. It spawns the CLI with a model
flag, a mode flag, an output format, a prompt on stdin and a working
directory — and the kit is a tracked submodule like the documents beside it:
brought to its remote's tip before the task, verified, recorded in the commit
and the journal, and named in the prompt as something to read and not write.
Nothing in `core/` knows the word kit, and nothing branches on which tracked
submodule is which.

So the question is not whether to remove something. It is whether to add a
concept, and this records the decision not to.

## Decision

**detent gives the agent a prompt and a working directory.** No skills, no
hooks, no settings file, no MCP configuration, no per-CLI anything. A kit is a
tracked submodule and gets exactly what a tracked submodule gets.

The door is left open deliberately, and this is where it would be reopened: a
second version may pass something, and the thing it would most likely pass is
the kit's text appended to the prompt, because that is the one channel all
three CLIs share.

## Consequences

- A kit is worth exactly what the agent reads out of it, which makes the task
  body — the only thing that reaches the agent — responsible for pointing at
  it. That is where the methodology already puts its links.
- The three CLIs stay behind one call at one level (0010). Nothing has to be
  written three times, and "three agent CLIs behind one call" goes on being
  true rather than becoming true-for-the-flags-we-bothered-with.
- There is nothing to configure, nothing to discover and no names in the code.
  A product may have three such repositories, one, or none, called anything;
  detent's behaviour does not change.
- **The kit is the least useful of the three today**, and this is the reason.
  A person who expects skills to be picked up because the repository is
  mounted will find they are not, and nothing says so at the moment they look.
- Whatever a second version does here will be a change to how agents are
  invoked, which is the most load-bearing code in the product. Deferring it
  costs nothing now and will not be cheap later.

## Alternatives rejected

**Mount the kit as `.claude/` so Claude Code finds it natively.** No code at
all: the CLI already looks there. It makes one of three agents privileged, ties
a product's directory layout to one vendor's convention, and the first product
that runs Codex finds its kit silently ignored — the quiet wrong answer, not
an error.

**Pass each CLI its own configuration.** Honest about the differences and
three times the surface, in the part of the code where a mistake means an
agent ran with permissions nobody intended. 0010 put the CLIs behind one call
precisely to keep that surface single; this would re-open it for a feature
nobody has asked to use yet.

**Append the kit's contents to the prompt.** The one that may come back, and
the reason it is not now: nobody has said what belongs in a kit. Building the
channel before its content means guessing at a shape, and the guess arrives as
a configuration key that is hard to remove once a product depends on it. It
costs nothing to wait until there is a kit worth appending and a sentence
saying what it is for.
