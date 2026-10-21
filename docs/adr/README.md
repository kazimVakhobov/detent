# Decisions

`DESIGN.md` says what detent is **now**. These say **why not otherwise, and when
that changed**.

| # | Decision | Status |
|---|---|---|
| [0001](0001-agent-branch-namespace.md) | The agent branch namespace, and two human gates | accepted |
| [0002](0002-no-worktrees.md) | No worktrees: one active task per repository | accepted |
| [0003](0003-declared-gauge-stages.md) | The gauge is declared as stages, in profiles | accepted; escalation superseded by 0009 |
| [0004](0004-acceptance-demotes-only.md) | The acceptance pass may demote, never approve | accepted |
| [0005](0005-queue-in-the-product-folder.md) | The queue lives in the product folder | accepted; narrowed by 0012 |
| [0006](0006-zero-dependencies-node-22.md) | Zero dependencies, and the published artifact is the source | accepted |
| [0007](0007-scoped-package-name.md) | Published under a scope, because npm refuses the bare name | accepted |
| [0008](0008-optional-agent-staging.md) | Optional agent-side staging, for a gauge that checks a batch | accepted |
| [0009](0009-three-attempts-then-pause.md) | Three attempts, then the task is paused and a person is told | accepted; narrowed by 0023 |
| [0010](0010-three-agent-clis.md) | Three agent CLIs behind one call, and a role names its agent | accepted; narrowed by 0018 |
| [0011](0011-a-gauge-that-cannot-read-the-change.md) | A gauge that cannot read the change it gates says nothing | accepted |
| [0012](0012-the-queue-and-the-shared-context-may-be-repositories.md) | The queue and the shared context may be repositories | accepted |
| [0013](0013-the-agent-gets-a-prompt-and-a-directory.md) | The agent gets a prompt and a working directory, and nothing else | accepted |
| [0014](0014-init-asks-where-the-queue-and-the-documents-are.md) | `init` asks where the queue and the documents are, and a task's links are checked against them | accepted |
| [0015](0015-the-dashboard-may-write-the-configuration-between-runs.md) | The dashboard may write the configuration, and only between runs | accepted; corrected by 0017 |
| [0016](0016-a-task-may-choose-its-own-models.md) | A task may choose its own models | accepted, not implemented |
| [0017](0017-a-claim-locks-the-configuration-only-while-its-run-is-alive.md) | A claim locks the configuration only while its run is alive | accepted |
| [0018](0018-one-agent-in-the-first-version-and-what-readmits-another.md) | One agent in the first version, and what re-admits another | accepted; narrows 0010 |
| [0019](0019-the-offered-model-names-are-a-suggestion-in-the-product-file.md) | The offered model names are a suggestion in the product file, never a constraint | accepted |
| [0020](0020-the-dashboard-is-sections-and-the-configuration-is-read-before-it-is-written.md) | The dashboard is sections, and the configuration is read before it is written | accepted |
| [0021](0021-the-agents-output-is-a-stream-written-to-a-file-that-is-not-a-record.md) | The agent's output is a stream, written to a file that is not a record | accepted |
| [0022](0022-the-task-detail-is-a-drawer-over-the-section-you-were-on.md) | The task detail is a drawer over the section you were on | accepted; narrows 0020 part 1 |
| [0023](0023-a-doubt-is-an-attempt-and-every-round-is-recorded.md) | A doubt is an attempt, and every round is recorded | accepted; narrows 0009 |

## The rules

**An ADR is never edited.** It is replaced by a later one, which says
`Status: superseded by NNNN`, and the old one says `superseded by NNNN` in
return. The record of a decision that was later reversed is more useful than a
document that has always been right.

**A commit that reverses or narrows an earlier choice carries an ADR.** A commit
that clarifies wording does not. The test is whether a reader six months from
now would ask "why is it not the obvious way?" — if yes, the answer belongs
here rather than in a commit message nobody greps for.

**Each one names what it displaced.** A decision recorded without its rejected
alternatives is a description, and descriptions are already in `DESIGN.md`.

## Shape

```markdown
# NNNN. Title in the imperative or as a statement

- **Date:** YYYY-MM-DD
- **Status:** accepted | superseded by NNNN

## Context      what forced a choice
## Decision     what was chosen, precisely enough to implement
## Consequences what follows, including what got worse
## Alternatives rejected
```
