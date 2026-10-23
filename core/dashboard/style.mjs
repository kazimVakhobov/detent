// The page's one stylesheet, inline: nothing is loaded from outside, so there
// is no `@import` and no `url(` anywhere in it. Colour never carries meaning on
// its own — a status is an icon and a word, and the colour repeats what they
// already say.

export const STYLE = `:root {
  color-scheme: light;
  --surface: #fcfcfb; --raised: #ffffff; --line: #e4e3df;
  --text: #0b0b0b; --text-2: #52514e; --muted: #7a7974;
  --good: #0ca30c; --warning: #fab219; --serious: #ec835a; --critical: #d03b3b; --accent: #2a78d6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --raised: #232322; --line: #34332f;
    --text: #ffffff; --text-2: #c3c2b7; --muted: #8f8e86; --accent: #3987e5;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --raised: #232322; --line: #34332f;
  --text: #ffffff; --text-2: #c3c2b7; --muted: #8f8e86; --accent: #3987e5;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-bottom: 12px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); margin: 32px 0 8px; }
.sub { color: var(--text-2); }
.muted { color: var(--muted); }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.running .dot { background: var(--good); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.tile { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
.tile .label { color: var(--text-2); font-size: 13px; }
.tile .value { font-size: 24px; font-weight: 600; margin-top: 2px; }
.tile .note { color: var(--muted); font-size: 12px; margin-top: 2px; }
.hero { grid-column: span 2; }
.hero .value { font-size: 52px; line-height: 1.05; }
@media (max-width: 520px) { .hero { grid-column: auto; } }
.scroll { overflow-x: auto; background: var(--raised); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--text-2); font-size: 12px; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.status { display: inline-flex; gap: 6px; align-items: baseline; white-space: nowrap; }
.status .icon { font-weight: 700; }
div.status { white-space: normal; }
.passed .icon { color: var(--good); }
/* A task being run right now, which is a status like any other: the icon and
   the word carry it and the colour repeats them. Guarded by \`.status\` because
   the header's chip is \`.running\` too, and its dot is the thing that reads
   there. */
.status.running .icon { color: var(--good); }
.escalated .icon, .look .icon { color: var(--warning); }
.rejected .icon { color: var(--serious); }
.error .icon { color: var(--critical); }
.skipped .icon, .info .icon { color: var(--muted); }
ul.doubts { margin: 4px 0 0; padding-left: 18px; color: var(--text-2); }
.empty { padding: 12px; color: var(--muted); }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
footer { margin-top: 32px; color: var(--muted); font-size: 12px; }

/* The sections, and the fragment that names one. The current link is bold and
   underlined as well as coloured, because a tab told apart by colour alone is
   the same mistake as a status told apart by colour alone. */
nav { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
nav a { padding: 8px 12px; color: var(--text-2); text-decoration: none; border-bottom: 2px solid transparent; }
nav a:hover, nav a:focus { color: var(--text); }
nav a[aria-current] { color: var(--text); font-weight: 600; border-bottom-color: var(--accent); }
main > section[hidden] { display: none; }
main > section > h2:first-child { margin-top: 8px; }

/* What is wrong, outside every section: a section can hide a block, and this is
   the strip that nothing hides (ADR 0020). */
.alerts { display: grid; gap: 8px; margin-bottom: 16px; }
.alerts:empty { display: none; }
.alert { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; white-space: normal; background: var(--raised); border: 1px solid var(--line); border-left: 3px solid var(--muted); border-radius: 8px; padding: 10px 12px; }
.alert.look { border-left-color: var(--warning); }
.alert.error { border-left-color: var(--critical); }
.alert a { color: var(--accent); }

/* The landing section: what is running, what is next, what is waiting — and
   the figures under them. A run is a line of plain facts; nothing here is
   coloured to mean something the words do not already say, and the one status
   in it is an icon and a word like every other. */
#now p { margin: 0; }
#now a, #next-up-order a { color: var(--accent); }
#now > .run + .run { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
.run-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
#next-up-order { margin: 0 0 8px; }

/* The four folders, in one row of four that stays four.

   **Four explicit tracks, not \`repeat(auto-fit, minmax(320px, 1fr))\`.**
   \`auto-fit\` fits as many 320px columns as the width allows and wraps the
   rest, so at an ordinary window three sat in a row and "Abandoned by hand"
   dropped underneath "Queue" — where it read as a fourth thing about the first
   folder rather than as the fourth folder. The queue *is* four folders, so the
   row is four columns at every desktop width.

   **And the four children get \`min-width: 0\`.** A grid item's default is
   \`min-width: auto\`, which is its content's intrinsic minimum — and a card
   holds things that cannot break, a long path and a head that does not wrap, so
   the item was wider than its track, \`1fr\` stopped being a ceiling, and the
   card ran under the next column and off the right-hand edge of the page. At 0 the track is the width and the content ellipsises or scrolls
   inside it, which is what \`.card-head .name\` and \`.card .facts\` already
   intend. The cards inside a column are a grid of their own, so they get the
   same floor and the same 0: one level down, the default does the same thing.
   Said here because the next person to meet \`min-width: auto\` should not have
   to spend the same hour on it.

   **Below 760px they stack.** Four columns of a phone are not four columns,
   and a page whose body scrolls sideways is the thing being avoided; 760px is
   the width the drawer already calls narrow, so the page has one narrow rather
   than two. */
.folders { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 24px; }
.folders > *, .cards > * { min-width: 0; }
@media (max-width: 760px) { .folders { grid-template-columns: minmax(0, 1fr); } }

/* The queue, as cards: one card per task, the number and its name on the one
   row that reads like a title, and every fact on a line under it.

   **The head is one row; the facts are as many as they need.** Both were
   flex-wrap: nowrap, so what was laid out in a row stayed in one row rather
   than silently becoming a second line inside it — which is what the rows this
   replaces did to "abandoned by hand" in failed/, where it sat under the height
   of its own row and was never seen. Anything longer than a row is a .line
   instead, full width, wrapping normally.

   **The facts wrap, because the figures are at the end of that row.** nowrap
   was written when a card had a whole row of the page to itself and the only
   risk was a card growing taller than its neighbours; four columns that stay
   four put the row at a quarter of the width, and what then hung past the right
   edge was the cost — \`$11.51\` arriving as \`$1\`, which is a plausible figure
   with nothing on the card to say it is a fragment. A card has no height of its
   own, so a second line of facts makes the card taller and is read: the failure
   nowrap guarded against needs a row with a fold in it, and there is none here.

   Each fact breaks between its words and never inside one — nothing here sets
   \`overflow-wrap\`, so a figure is one word and stays whole, and
   \`.status\`'s own nowrap keeps an icon with the word it belongs to.
   \`overflow-x\` is the floor under that, for the one fact that cannot break at
   all — a forty-character repository name — which scrolls rather than painting
   over the next column. The head keeps its row: a name is an identifier read
   from its beginning, so it ellipsises, and it is on the path line below in
   full. */
.cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-bottom: 8px; }
.cards .empty { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; }
.card { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.card-head, .card-head a { display: flex; flex-wrap: nowrap; align-items: baseline; gap: 6px; min-width: 0; }
.card-head a { color: var(--accent); text-decoration: none; }
.card-head .number { font-variant-numeric: tabular-nums; }
.card-head .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .facts { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; overflow-x: auto; margin-top: 4px; }
.card .line { white-space: normal; overflow-wrap: anywhere; margin-top: 4px; }
.card .path code { color: var(--muted); }
#todo-order { margin: 0 0 8px; }
#todo-order .look { color: var(--warning); }

/* The headings a click sorts by: the chosen one is bold and carries the arrow
   as well as a coloured border, because a control told apart by colour alone is
   the same mistake as a status told apart by colour alone. */
.sort { display: flex; flex-wrap: wrap; gap: 4px; }
.sort button { font-size: 12px; padding: 2px 8px; }
.sort button.chosen { border-color: var(--accent); font-weight: 600; }

#queue-how .group:first-child { margin-top: 0; }
#queue-how pre.body { margin: 8px 0; }
#queue-how p { margin: 0; }

/* One task, in a drawer over the section it was opened from (ADR 0022). Fixed
   to the right, the width of a column of text and no wider, scrolling inside
   itself: the section behind it keeps its own scroll and its own place, which
   is the whole of why this is a drawer and not a modal — the list somebody came
   from is beside what they opened rather than behind a dimmed overlay.

   **Nothing here moves of its own accord**: no transition and no animation
   (ADR 0006).

   **On a narrow screen it is the screen.** That is the section replacement this
   exists to avoid, arriving through the viewport instead of through the
   navigation, and it is the right behaviour there (ADR 0022) — so it is said
   here rather than left to a width that happens to overlap, and the head the
   drawer is closed from sticks to the top, reachable however far down a task
   somebody has scrolled. */
.drawer { position: fixed; z-index: 10; inset: 0 0 0 auto; width: min(680px, 100%); overflow: auto; background: var(--surface); border-left: 1px solid var(--line); padding: 16px 16px 48px; }
.drawer[hidden] { display: none; }
.drawer-head { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 12px; }
.drawer-head h2 { margin: 0; }
@media (max-width: 760px) { .drawer { width: 100%; border-left: 0; } }

/* **What separates one block of the detail from the next is space and a
   heading, not a border.** It was a panel, a legend block inside that, a card
   inside that and a table inside that: three outlines before any content, and
   the content is what somebody opened the drawer to read. So the detail is no
   longer a \`.panel\` — the drawer's own left edge is the border that makes it a
   drawer, and a second one just inside it said nothing — and a block of it is
   its legend and the space to the one below. The border that is left is the
   innermost one, around a run or around a table that scrolls, and nothing
   gained one to make up for the two that went. */
#task-detail > .group { border: 0; border-radius: 0; padding: 0; margin-bottom: 24px; }
#task-detail > .group:last-child { margin-bottom: 0; }

/* Its body is a text node in a <pre> — detent renders no markdown, so a task
   file looks like the text file it is, and wraps rather than scrolling
   sideways.

   The head is a number and a name, which is why the name is the size of a
   title and the folder and the path beside it are not: the path is what
   somebody opens the file with, and it stays legible without competing. */
table a { color: var(--accent); }
.task-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 12px; }
.task-head strong { font-size: 17px; }
.task-head .number { font-variant-numeric: tabular-nums; }
pre.body { white-space: pre-wrap; overflow-wrap: break-word; margin: 0; font: inherit; color: var(--text-2); }

/* What its attempts did, the first block of the detail (§12): one record per
   journal line, the head a row of plain facts and anything longer than a row a
   line of its own — the rule a queue card follows, for the same reason. This
   head wraps, because the drawer is a column of text rather than a quarter of
   one. The record's border is the one the detail keeps: it is what separates
   one run from the next, and there is nothing boxed inside it. */
.runs { display: grid; gap: 10px; }
.run-record { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.run-record .facts { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.run-record > .line { margin-top: 6px; overflow-wrap: anywhere; }

/* What each pass cost, as a block each rather than a row each. Pass / Cost /
   Tokens / Model was a table of four columns in a drawer that is 680px at its
   widest, and the Model column broke \`claude · claude-opus-5\` across four
   lines, one word per line.

   **A model name is an identifier and reads as one thing**, so nothing breaks
   inside one: \`.id\` holds a name together, the parts of the line break
   between themselves, and a name wider than the block it is in scrolls — the
   rule \`.card .facts\` already follows, rather than a hyphen becoming a line
   ending. Two blocks side by side, one each, because what reading the work
   cost against what doing it cost is a comparison (ADR 0004); below 560px they
   stack, which is the width \`.field\` already stops being two columns at. */
.passes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin-top: 8px; }
.passes > * { min-width: 0; }
.pass .figure { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; overflow-x: auto; }
.pass .id { white-space: nowrap; }
@media (max-width: 560px) { .passes { grid-template-columns: minmax(0, 1fr); } }

/* What the agent is saying, under the task it is saying it about (ADR 0021).
   Bounded in height as well as in lines: the end of the output is the part
   somebody watching wants, and a panel that grows with a run pushes the rest of
   the page off the bottom of the screen. */
.log-panel { margin-top: 12px; }
.log-panel > .legend { color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
pre.log { max-height: 26rem; overflow: auto; margin-top: 10px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
pre.log:empty { display: none; }

.panel { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
.group { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
/* One heading for a block, wherever a block has one: the editor's groups, the
   detail's, and a pass inside a run. */
.group > .legend, .pass > .legend { color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
.field { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 6px 12px; align-items: center; margin-bottom: 8px; }
.field > label, .field > .name { color: var(--text-2); }
.field:last-child { margin-bottom: 0; }
@media (max-width: 560px) { .field { grid-template-columns: minmax(0, 1fr); } }
.pair { display: flex; gap: 8px; flex-wrap: wrap; }
.pair select { min-width: 9em; }
.pair input { flex: 1 1 10em; min-width: 0; }

/* A control with what it takes under it. **The sentence is beside the control,
   never inside it**: a placeholder is clipped at the width of its input, so
   \`the token — written to a file of its own, never read back\` arrived as
   \`the token — written to a\` and there is no width at which that is a
   sentence. A hint is a line of its own, wrapping like any other line, and the
   placeholder that is left is an example short enough to survive any width the
   panel takes. \`justify-items: start\` so a checkbox stays its own size; a
   text input takes the column up to a readable measure. */
.stack { display: grid; gap: 4px; justify-items: start; }
.stack > input:not([type="checkbox"]) { width: 100%; max-width: 30em; }
.hint { font-size: 12px; }
p.hint { margin: 0 0 10px; }

/* One editor over two panels, and the line in each that says it is open
   (ADR 0025). Like the lock above it: an icon and a word, and the colour
   repeats them. \`.status\` is an inline-flex, which beats the browser's own
   rule for \`hidden\`, so the attribute is said here. */
.mode { margin-bottom: 12px; }
.mode[hidden] { display: none; }
#notify-secret { margin: 16px 0 0; }
#notify-secret p { margin: 0; }
#notify-secret .field { margin: 10px 0 0; }
#notify-secret-note:empty { display: none; }
input, select, button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
input:disabled, select:disabled, button:disabled { opacity: .55; cursor: not-allowed; }
button { background: var(--accent); color: #ffffff; border-color: transparent; font-weight: 600; cursor: pointer; }
/* Leaving the editor discards, so the way out is not the loud button: the
   configuration is read until a person says otherwise (ADR 0020 part 2). */
button.quiet { background: var(--surface); color: var(--text); border-color: var(--line); font-weight: 400; }
#config-view .field { margin-bottom: 4px; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
.lock { color: var(--warning); margin-bottom: 12px; }
.lock:empty { display: none; }
ul.problems { margin: 10px 0 0; padding-left: 18px; color: var(--critical); }
ul.problems:empty { display: none; }
ul.problems code { font-size: 12px; }
`
