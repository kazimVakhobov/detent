# 0025. A channel is a kind, and the secret is not in the configuration

- **Date:** 2026-10-22
- **Status:** accepted — narrows 0009

## Context

0009 made notification a command, and the reason it gave was exact: a command is
"enough to reach a chat, a phone or a mail **without detent holding a credential
for any of them**". Every team already has one, and each built-in channel would
have been a dependency or a credential.

That instinct is right and it is not the whole of what people want. Three things
were asked for that the shape in `product.json` could not express:

- **which events reach a person.** `notify` was one command on one occasion.
  `core/run.mjs` called it only where a task paused — `escalated`, `rejected`,
  `error` — and a task that passed was settled in silence. The label on the
  dashboard said `notify — a command run when a task finishes`, which was not
  what the code did.
- **more than one channel.** One string is one command. A chat for the team and
  a desktop notification for whoever is at the machine is two.
- **a channel that needs a credential.** Which is the part that had to be
  designed rather than added.

Because `product.json` is the worst possible place for a bot token, and not by a
small margin. `core/configure.mjs` reads the file back and serves it to the
dashboard, because that is how an editor shows a current value — so a token in
it is a token in a browser. `core/product.mjs` puts the file at
`.detent/product.json`, which nothing gitignores, because `init` wrote no
`.gitignore` at all — so a token in it is a token in a commit. The one value
that must never be read back would have been in the one file every value is read
back from.

## Decision

- **`notify` is a command, or an object of events and channels.** A string means
  exactly what it has always meant — one command, on a pause — so every
  `product.json` already written keeps working and nothing has to be edited to
  go on being notified as before. The object is
  `{ "events": [...], "channels": [{ "kind": ..., ... }] }`.
- **Events are named, and the default is today's behaviour.** A `notify` that
  does not say which events it wants notifies on a pause and nothing else. The
  names are `paused`, `passed` and `promoted` — a task that needs a person, a
  task that landed, a batch that reached staging — plus the raw outcomes
  `escalated`, `rejected`, `error` and `red`, so somebody can ask for `error`
  alone. An occasion matches by its event or by its outcome. A promotion that
  did not happen is `paused`, because it is a thing that needs a person; that is
  also what keeps the default identical to what shipped. **Present means exactly
  what it says**, empty included: `"events": []` is silence, not the default.
- **`core/run.mjs`'s `settle` sends on the `passed` branch as well, and
  `core/promote.mjs` sends `promoted`.** A skipped run is still no occasion at
  all.
- **Channels are a registry, one module per kind, dispatched by `kind`.** A kind
  exports how it validates itself, what the page draws for it, where it sends,
  which variable it needs, and how it sends. Adding a third is one file and one
  line in `core/notify/kinds.mjs`.
- **A kind is admitted once it has delivered a real message**, not when its
  module compiles — 0018's rule for agents, carried across for the same reason.
  A channel written against documentation and never run is a promise to reach
  somebody, and the moment a notification exists for is the moment nobody is
  watching. Two kinds: `command`, which shipped in 0.1 and has run on every
  pause since, and `telegram`.
- **telegram needs no dependency.** Node 22 has `fetch` and the Bot API is one
  POST, so `scripts/check-no-deps.mjs` stays green (ADR 0006) and nothing is
  vendored.
- **The configuration names where the secret is, and never what it is.** A
  telegram channel carries `tokenEnv`, the name of an environment variable;
  detent reads it at send time. A `token` key is **refused by name** with the
  reason, because whoever typed it was doing the obvious thing. A channel whose
  variable is unset is reported where the configuration is read, as "named, and
  not set", and never by printing what it found there.
- **A secret may also be typed on the dashboard, into a file the page cannot
  read back.** `POST /secret.json` writes it to `.detent/secrets.json`, created
  `0600`, under the same name the channel already names; the environment wins
  over it, because that is the one a person can change for a single run without
  editing anything. There is no `GET /secret.json` — by construction, not by
  omission. `init` writes `.detent/.gitignore`, which excludes it.
- **This is the one place the dashboard does not show what the file says.**
  Everywhere else the page reads a value back, because that is how an editor
  shows a current value, and ADR 0020 part 2 made reading the default. Here
  `readConfiguration` reports **whether** a secret is set and where, and the
  value never leaves the machine except in the request that sends with it. Said
  here rather than left to be discovered in the code, because an exception to a
  rule this page is otherwise built on is a decision and not an implementation
  detail.
- **No secret is printed, logged or journalled.** One function returns a value
  (`readSecret`), one kind receives it, and the dispatcher redacts whatever comes
  back against it before it leaves — because the token is in the URL the Bot API
  is called at, and a failed send's report goes into a journal line that is never
  rewritten.
- **A channel that fails is reported and never fails the run, per channel.**
  That was already the rule for one notifier (0009), and it now holds for each:
  one channel failing does not stop the others, and `record.notified` carries a
  result per channel that `detent run` and `detent promote` print.
- **Notifications is a block of its own on the dashboard**, not a row among the
  limits: those are one value under one key, and a list of channels is not one
  value. It is drawn from the same read and written by the same Save, because it
  is the same file.

**This narrows 0009 rather than reversing it.** detent still holds no credential
**in its configuration**. What changed is that "detent holds no credential" was
being read as "detent never handles one", and those are different claims: the
first is about what is written down where everything else is written down, and
the second was never the thing that mattered. A token in a variable detent reads
at send time is the person's, in a place the person chose. A token in a file
`0600` next to a file served to a browser is the narrowest possible second
option, and it exists for the person who has no shell profile to edit and a
dashboard open.

## Consequences

- A product that configures nothing behaves exactly as before: the desktop
  notifier, on a pause. The default had to be that, or this would be a breaking
  change dressed as a feature.
- `product.notify` is normalised by the validator, so everything downstream reads
  one shape and the string form exists only in the file.
- `settle` and `promote`'s `finish` are now `async`, because a channel may be an
  HTTPS request. A journal line is written after the sends, as it was.
- A passing run's journal line gains `notified` — with `asked: false` and no
  channels where nobody asked, which is the old silence said out loud.
- There are now two files under `.detent/` a person must not commit, and only one
  rule to say so. `init` writes it; a `.gitignore` already there gains the line
  rather than being replaced.
- The dashboard has a second write. Its origin check is the configuration's, and
  it is deliberately *not* refused during a run: `product.json` is shut during a
  run because it is fingerprinted before each of the agent's turns (0015, 0017),
  and the secrets file is not one of those — a run whose channel is missing its
  token is exactly when somebody needs to supply one.
- Reaching a chat now has a failure mode a command did not: a token that expired.
  It is reported per channel, by the condition and never by quoting the token.

## Alternatives rejected

**The token as an ordinary `product.json` key.** One line, no new file, no new
route — and wrong in two independent ways, either of which is sufficient. The
dashboard reads that file back and serves its values to a browser, so the token
would be in the page the moment somebody opened Configuration; and nothing
gitignores it, because `init` wrote no `.gitignore`, so the token would be in the
first commit of a product folder somebody decided to version — which §11 openly
expects, since the queue and the journal are text worth keeping. The key is
refused by name, with that reason, rather than merely undocumented.

**Keep the channel a command, and nothing else.** It is still the kind that
needs nothing of detent, and it is still the default. But "write a shell script
that curls the Bot API" is a real answer only for somebody who would have
written it already, and the question being asked was by people who would not.
A kind that has delivered a message is a smaller thing to maintain than a page
of documentation explaining how to build one.

**A credential store: keychain, 1Password, a `.env` walked up from the current
directory.** Each is a dependency, a platform, or a guess about where somebody
keeps things. An environment variable is the interface every one of those
already exports into.

**Make detent a notification router** — retries, a queue, delivery receipts,
per-channel rate limits. A send is attempted once and what happened is reported.
The task is already paused; losing the run, or holding it open, over a message
about it would be the worse outcome, and that was 0009's judgement before there
was more than one channel to lose.

**Slack, Discord, email, a webhook, now that there is a registry.** None of them
has delivered a message here. The registry is what makes adding one cheap; the
rule above is what stops cheap from meaning free.

**Events as a flag per occasion — `notifyOnPass`, `notifyOnPromote`.** Two keys
today and five later, each one a boolean that cannot say "errors only". A list of
names says it once and reads the same as the journal's own words.

**A separate `secrets` key inside `product.json`, gitignored by writing the
whole file out of git.** It makes the one file every tool reads unversionable,
which loses the thing `product.json` is for: a product's composition, reviewed
and shared.
