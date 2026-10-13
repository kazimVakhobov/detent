# 0011. A gauge that cannot read the change it gates says nothing

- **Date:** 2026-10-13
- **Status:** accepted

## Context

The first four tasks detent ran in this repository exposed something the design
had not said out loud. Two of them changed only documentation, and for those
two the gauge — `deps`, `progress`, `test` — was green **by construction**. None
of the three stages opens a markdown file. An empty commit would have been
equally green, and so would a commit that replaced the README with a lie.

This is not a gap in those stages. A test suite is the right gauge for code and
has no opinion about prose. The gap is that `passed` in the journal, a green
merge commit and a pass rate in `summary` all read the same whether the gauge
examined the change or merely ran beside it.

What actually held on those two tasks was the acceptance pass, and it held
once out of twice. On 0027 it rejected a green run for a false claim in
`PROGRESS.md` that no machine check could have seen. On 0026 it accepted a diff
that left the same class of claim standing elsewhere — found only because the
next task went looking. Two cases is not a measurement, but the direction is
not in doubt: a model reading a diff may demote, and sometimes does not.

So documentation was the one place in this product where green was decorative,
in a product that exists to refuse exactly that.

## Decision

**Two parts, and the first matters more than the second.**

**A profile's stages define what green covers, and green means nothing outside
them.** This is now stated in `DESIGN.md` beside the gauge rather than left for
a reader to infer. A repository whose gauge cannot read the kind of change a
task made has not checked that task, and no amount of green says otherwise.
This is the same honesty `0003` already applies to a repository with no gauge
at all — `"lock": "absent"`, a dash instead of a pass rate — extended to a
repository whose gauge is real but blind to what changed.

**This repository's own gauge gains a `docs` stage**, deterministic and in the
`exit` profile, checking the claims that can be checked without judgement:

1. every relative link in a tracked markdown file resolves to a file that exists
2. every version a document states as the **current** one agrees with
   `package.json` — a changelog entry naming a past release is a record, not a
   claim about now, and is left alone
3. the ADR index in `docs/adr/README.md` lists exactly the files in that
   directory, in both directions

Each of the three is there because it already failed. In one session the
README claimed "eight decisions" with ten in the directory, carried a status
line two versions stale, and the `0.3.0` entry named a registry version that
had never been served.

## Consequences

- A whole class of drift stops reaching `main`: dead links, a version in prose
  that nobody bumped, an index that forgot an entry. Cheap, deterministic, and
  it fails on the attempt that caused it.
- **It does not make a documentation change safe.** Whether a sentence is *true*
  remains unreachable by any stage, and this ADR deliberately does not pretend
  otherwise. Green on a documentation task still means less than green on a code
  task; it now means something rather than nothing.
- The acceptance pass stays the only thing reading for truth, and it is now
  understood as a net with holes rather than a second gauge. The number worth
  watching is the one `summary` already prints — how often a green run was not
  done.
- Another repository gets none of this automatically. The stage is three lines
  in this product's `product.json` and a script behind it, not a feature of the
  tool. What the tool provides is the honesty about coverage, which is the part
  that generalises.

## Alternatives rejected

**Leave it to the acceptance pass.** It is already there, costs nothing extra,
and reads the whole diff against the task. It also accepted 0026. Making a
model's attention the sole guard on a category of change puts judgement where
the product promises machine checks — the line `0004` draws, approached from
the other side.

**A model-based documentation stage in the gauge.** Tempting, because it would
catch what the deterministic checks cannot: ask a model whether the diff's
claims are true, and fail the stage on no. It would also make a model's opinion
into a gauge result, and the gauge is what grants green. `0004` exists so that
"proven" never quietly becomes "a second model agreed"; putting one inside the
gauge would be that substitution with extra steps.

**Forbid documentation-only tasks from running unattended.** Honest, and it
gives up something real: well-specified prose corrections are work agents do
well, and three of this session's four tasks were documentation. It would also
protect nothing, because a person editing the README by hand drifts it in
exactly the same way — as happened here, twice, in commits written without an
agent involved.

**Make the existing `test` stage read the docs.** The checks would run and the
reporting would lie: a stage named `test` failing on a dead link tells the agent
the tests broke. Stage identity is the whole point of `0003` — the failed stage
is handed to the agent as the thing to work from.
