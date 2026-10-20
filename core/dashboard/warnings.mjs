// What is wrong, from wherever you are standing.
//
// A single scroll had the property that everything was somewhere below you.
// Sections mean a person can be looking at a page that does not contain the
// thing that is wrong, so the three things that cannot wait live outside every
// section and are drawn on every read (ADR 0020's first consequence):
//
//   - a run whose process is gone, which needs `detent recover`
//   - a paused task, which is waiting for a person and for nothing else
//   - a queue that would not parse, which means the queue shown is empty
//     because it could not be read rather than because there is nothing in it
//
// Each one says which section holds the detail, and the link is a fragment:
// going there changes no request.

// Read from the snapshot and nothing else. This is the function the page runs —
// it is serialised into the script below, so what a test calls and what a
// browser calls are the same code.
export function warnings(s) {
  const list = []
  for (const run of s.active) {
    if (run.alive) continue
    list.push({
      level: 'error',
      icon: '✕',
      section: 'repositories',
      text: 'the run on ' + run.repo + ' is gone — task ' + run.task + ', attempt ' + run.attempt
        + '. Nothing is working on it: detent recover',
    })
  }
  const paused = s.queue.hold.length
  if (paused > 0) {
    list.push({
      level: 'look',
      icon: '▲',
      section: 'queue',
      text: (paused === 1 ? 'one task is paused' : paused + ' tasks are paused') + ', waiting for you',
    })
  }
  for (const problem of s.queueProblems) {
    list.push({ level: 'error', icon: '✕', section: 'queue', text: 'the queue will not parse: ' + problem })
  }
  return list
}

export const WARNINGS = `// What is wrong, outside every section (ADR 0020).
${warnings}

function renderWarnings(s) {
  document.getElementById('alerts').replaceChildren(...warnings(s).map((w) => el('div', { class: 'alert status ' + w.level },
    el('span', { class: 'icon', 'aria-hidden': 'true' }, w.icon),
    el('span', {}, w.text),
    el('a', { href: '#' + w.section }, SECTION_NAMES[w.section]))))
}
`
