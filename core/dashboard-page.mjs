// The dashboard page: several modules, one document. Nothing is loaded from
// outside, every value is set as text so a task title or a reviewer's doubt can
// never become markup, and a status always reads as an icon and a word — colour
// only repeats it.
//
// The source is `core/dashboard/`: the sections and the fragment that names one
// (ADR 0020 part 1), the strip of what is wrong that no section hides, the
// stylesheet, the rendering, the queue as cards, one task opened by its number
// in a drawer over the section it was opened from (ADR 0022),
// what its agent is saying while it says it (ADR 0021), the configuration —
// read until a person says otherwise, and written on request (ADR 0020
// part 2) — and notifications, which is that same file in a block of its own
// plus the one control whose value is written and never read back (ADR 0025).
// They are
// composed here at import time, so what is served stays one page, one request,
// no second asset, and the content security policy is unchanged (ADR 0020
// part 4).

import { CONFIGURATION } from './dashboard/configuration.mjs'
import { LOG } from './dashboard/log.mjs'
import { NOTIFICATIONS } from './dashboard/notifications.mjs'
import { QUEUE } from './dashboard/queue.mjs'
import { BODY, SHOW } from './dashboard/sections.mjs'
import { STYLE } from './dashboard/style.mjs'
import { TASK } from './dashboard/task.mjs'
import { VIEW } from './dashboard/view.mjs'
import { WARNINGS } from './dashboard/warnings.mjs'

// The one timer on the page: the snapshot, the configuration view beside it,
// and the end of what an open task's agent is printing — a view may refresh.
// **An open editor never does**, and neither does a task's body: a form whose
// values moved under the person filling it in would be a third state between
// what the file says and what the page shows (ADR 0015, narrowed by ADR 0020
// part 2), and a task body does not change under a reader the way a run's
// numbers do (ADR 0020 part 3). What the agent is saying is the exception that
// proves the rule — it is the one part of a task that *does* change under a
// reader, which is the whole reason it is drawn (ADR 0021).
export const POLL = { call: 'refresh', every: 3000 }

// Wiring, and the only code that runs at load. `showSection` first: the
// fragment decides what is visible — which section, and whether a task is open
// over it — before anything is fetched. Then one read and one timer: the read
// draws the configuration view with everything else, and the editor is built
// only when somebody asks for it.
//
// The buttons on the page. Three are the configuration's: the one that asks for
// the editor, the write, and the way out that is not a write. The fourth is the
// drawer's way out, beside Escape, because a panel covering content needs one
// that is visibly a close control (ADR 0022). The fifth is the one write that
// does not go into `product.json` — a channel's secret, which is typed on the
// page and never read back to it (ADR 0025).
const BUTTONS = [
  ['config-edit', 'openEditor'], ['config-save', 'save'], ['config-discard', 'discard'],
  ['notify-secret-set', 'sendSecret'],
  ['task-close', 'closeTask'],
]

const START = `${BUTTONS.map(([id, handler]) => `document.getElementById('${id}').addEventListener('click', ${handler})`).join('\n')}
showSection()
refresh()
setInterval(${POLL.call}, ${POLL.every})
`

export const SCRIPT = [SHOW, WARNINGS, VIEW, QUEUE, TASK, LOG, CONFIGURATION, NOTIFICATIONS, START].join('\n')

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>detent</title>
<style>
${STYLE}</style>
</head>
<body>
${BODY}
<script>
${SCRIPT}</script>
</body>
</html>
`
