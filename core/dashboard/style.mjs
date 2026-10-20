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
.escalated .icon, .look .icon { color: var(--warning); }
.rejected .icon { color: var(--serious); }
.error .icon { color: var(--critical); }
.skipped .icon, .info .icon { color: var(--muted); }
ul.doubts { margin: 4px 0 0; padding-left: 18px; color: var(--text-2); }
.empty { padding: 12px; color: var(--muted); }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0 24px; }
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

/* The queue, as cards: one card per task, the number and its name on the one
   row that reads like a title, and every fact on a line under it.

   **A card's rows do not wrap.** flex-wrap: nowrap on both of them, so what is
   laid out in a row stays in one row rather than silently becoming a second
   line inside it — which is what the rows this replaces did to "abandoned by
   hand" in failed/, where it sat under the height of its own row and was never
   seen. Anything longer than a row is a .line instead, full width, wrapping
   normally. Nothing is hidden to achieve it: a long name is clipped visibly and
   is also on the path line below it in full, and a row of facts scrolls. */
.cards { display: grid; gap: 8px; margin-bottom: 8px; }
.cards .empty { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; }
.card { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.card-head, .card-head a { display: flex; flex-wrap: nowrap; align-items: baseline; gap: 6px; min-width: 0; }
.card-head a { color: var(--accent); text-decoration: none; }
.card-head .number { font-variant-numeric: tabular-nums; }
.card-head .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .facts { display: flex; flex-wrap: nowrap; align-items: baseline; gap: 4px 14px; overflow-x: auto; margin-top: 4px; }
.card .facts > span { white-space: nowrap; }
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

/* One task, opened from any table that lists it (ADR 0020 part 3). Its body is
   a text node in a <pre> — detent renders no markdown, so a task file looks
   like the text file it is, and wraps rather than scrolling sideways. */
table a { color: var(--accent); }
.task-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 12px; }
pre.body { white-space: pre-wrap; overflow-wrap: break-word; margin: 0; font: inherit; color: var(--text-2); }

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
.group > .legend { color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
.field { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 6px 12px; align-items: center; margin-bottom: 8px; }
.field > label, .field > .name { color: var(--text-2); }
.field:last-child { margin-bottom: 0; }
@media (max-width: 560px) { .field { grid-template-columns: minmax(0, 1fr); } }
.pair { display: flex; gap: 8px; flex-wrap: wrap; }
.pair select { min-width: 9em; }
.pair input { flex: 1 1 10em; min-width: 0; }
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
