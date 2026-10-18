# 0017. A claim locks the configuration only while its run is alive

- **Date:** 2026-10-19
- **Status:** accepted

## Context

0015 let the dashboard write the configuration and refused a write while a run
is active, which `state.json` records. It then said what it expected a stale
claim to do:

> A stale one — written by a run that was killed — would lock the inputs until
> `detent recover` is run, which is the right answer and an unobvious one.

The implementation does not do that. `core/configure.mjs` filters the claims
in `state.json` by whether their process is still running, and a claim whose
process is gone does not refuse anything. Built, tested, and the opposite of
what the decision that asked for it says.

That is worth correcting rather than quietly keeping, because 0015 did not
arrive at its sentence carelessly: it reasoned that a lock a person has to
clear with a command is honest about an interrupted run, and it is not obvious
which of the two is right.

## Decision

**A claim locks the configuration only while the process that made it is
alive.** `state.json` is the record of what a run claimed; whether a run is
*happening* is the process, and the file is evidence of it rather than the
thing itself. The sentence quoted above is withdrawn.

Nothing else in 0015 changes: writes are refused while a run is alive, by the
server and not only by a disabled input, and every write goes through the
validator.

## Consequences

- A run killed with Ctrl-C leaves a claim behind, and the page keeps working.
  Under 0015's sentence it would have locked the configuration until `detent
  recover` ran — a page that stops working because of something that happened
  in another terminal an hour ago, with the fix a command nobody is told to
  type while looking at it.
- **The lock now depends on a pid, and a pid can be reused.** A claim whose
  process is gone and whose number has been handed to something else reads as
  alive, and the page refuses a write it could have allowed. Rare, harmless in
  the direction it fails, and the same assumption `recover` has always made
  about the same field.
- `recover` and the dashboard now answer the same question the same way,
  which is the behaviour a person would guess at. A repository `recover` would
  return is one the page will let you configure around.
- The stale claim stays in the file until `recover` clears it. Nothing reads
  it as a lock any more, so it is now only a record of an interrupted run —
  which is what `recover` is for.

## Alternatives rejected

**Keep 0015's sentence and change the code.** The sentence has an argument: a
lock that needs clearing makes an interrupted run impossible to ignore, and
this product generally prefers the loud version. It loses on where the
loudness lands. The person who killed the run is not the person reading the
dashboard an hour later, even when they are the same person, and a refusal
whose cause is invisible on the page teaches them that the page is unreliable
rather than that a run was interrupted.

**Refuse, but say the claim is stale and offer `recover`.** The compromise,
and nearly right: it keeps the lock and removes the mystery. Rejected because
the refusal still has nothing to protect — the fingerprint guard that 0015
exists to avoid tripping only matters while an agent is taking turns, and a
dead run takes none.

**Have the dashboard clear the stale claim itself.** It knows the process is
gone, and clearing it is one write. It is also `recover`'s whole job, done by
something that cannot do the rest of it: a stale claim normally comes with a
repository left on a task branch, and clearing the record without returning
the repository would leave the two disagreeing.
