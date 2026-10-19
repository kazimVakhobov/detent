// The dashboard page: several modules, one document. Nothing is loaded from
// outside, every value is set as text so a task title or a reviewer's doubt can
// never become markup, and a status always reads as an icon and a word — colour
// only repeats it.
//
// The source is `core/dashboard/`: the sections and the fragment that names one
// (ADR 0020 part 1), the strip of what is wrong that no section hides, the
// stylesheet, the rendering, one task opened by its number, and the
// configuration — read until a person says otherwise, and written on request
// (ADR 0020 part 2). They are composed here at import time, so what is
// served stays one page, one request, no second asset, and the content
// security policy is unchanged (ADR 0020 part 4).

import { CONFIGURATION } from './dashboard/configuration.mjs'
import { BODY, SHOW } from './dashboard/sections.mjs'
import { STYLE } from './dashboard/style.mjs'
import { TASK } from './dashboard/task.mjs'
import { VIEW } from './dashboard/view.mjs'
import { WARNINGS } from './dashboard/warnings.mjs'

// The one timer on the page: the snapshot, and the configuration view beside
// it — a view may refresh. **An open editor never does**, and neither does an
// opened task: a form whose values moved under the person filling it in would
// be a third state between what the file says and what the page shows
// (ADR 0015, narrowed by ADR 0020 part 2), and a task body does not change
// under a reader the way a run's numbers do (ADR 0020 part 3).
export const POLL = { call: 'refresh', every: 3000 }

// Wiring, and the only code that runs at load. `showSection` first: the
// fragment decides what is visible before anything is fetched. Then one read
// and one timer — the read draws the configuration view with everything else,
// and the editor is built only when somebody asks for it.
//
// The three buttons the configuration has: the one that asks for the editor,
// the write, and the way out that is not a write.
const BUTTONS = [['config-edit', 'openEditor'], ['config-save', 'save'], ['config-discard', 'discard']]

const START = `${BUTTONS.map(([id, handler]) => `document.getElementById('${id}').addEventListener('click', ${handler})`).join('\n')}
showSection()
refresh()
setInterval(${POLL.call}, ${POLL.every})
`

export const SCRIPT = [SHOW, WARNINGS, VIEW, TASK, CONFIGURATION, START].join('\n')

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
