// What the agent is saying, under the task it is saying it about (ADR 0021).
//
// A run showed a line when a task started and a line when it ended, and
// between them — minutes, sometimes a quarter of an hour — nothing. This is the
// surface that fills in the gap, on the page somebody watching is already
// looking at: the end of the attempt log, a few seconds behind, which is what
// watching is.
//
// Three things keep it from growing without bound. The server is asked to carry
// on from the byte the last answer ended at, so a refresh every few seconds
// does not re-read what the page already has; what arrives is kept as a bounded
// number of lines and the oldest fall off the top; and each line is clipped,
// because a tool result the agent read in full is not a line somebody scans.
//
// **Every event is read for display and for nothing else.** The verdict, the
// cost, the tokens and the session come from the result object `agents.mjs`
// parses, exactly as they did before this file existed. Nothing here is a
// number anything depends on, which is why a line that will not parse is shown
// as it arrived rather than treated as a problem.

export const LOG_LINES = 400
export const LOG_CLIP = 220

export const LOG = `// The end of an attempt's log, from log.json — polled, unlike the rest of the
// task, because it is the one part of a task that changes under a reader.
const LOG_LINES = ${LOG_LINES}
const LOG_CLIP = ${LOG_CLIP}

// Which log the lines on the page belong to, and where to carry on from.
let logTask = null
let logAttempt = null
let logFrom = 0
let logLines = []
// One read at a time: the timer must not overlap the read that opening a task
// started, or both would answer from the same offset and say it twice.
let logReading = false

const clip = (text) => {
  const one = String(text === null || text === undefined ? '' : text).replace(/\\s+/g, ' ').trim()
  return one.length > LOG_CLIP ? one.slice(0, LOG_CLIP) + '…' : one
}

// One line of the stream, as a line for a person. An event detent has no
// reading for is its type, and a line that is not an event at all is itself:
// this is a view of what the agent printed, so it never refuses to show it.
function saying(raw) {
  let event = null
  try {
    event = JSON.parse(raw)
  } catch (error) {
    return raw
  }
  if (!event || typeof event !== 'object') return raw
  const content = event.message && Array.isArray(event.message.content) ? event.message.content : []
  if (event.type === 'system') return '· ' + (event.subtype === 'init' ? 'started' + (event.model ? ' on ' + event.model : '') : event.subtype || 'system')
  if (event.type === 'assistant') return content.map(said).filter(Boolean).join('\\n') || '· thinking'
  if (event.type === 'user') return content.map(back).filter(Boolean).join('\\n')
  if (event.type === 'result') return '· finished: ' + (event.subtype || '—') + (typeof event.total_cost_usd === 'number' ? ' · $' + event.total_cost_usd.toFixed(4) : '')
  return '· ' + (event.type || raw)
}

// What the agent said, or asked a tool for.
function said(piece) {
  if (!piece || typeof piece !== 'object') return ''
  if (piece.type === 'text') return clip(piece.text)
  if (piece.type === 'tool_use') return '→ ' + (piece.name || 'tool') + ' ' + clip(JSON.stringify(piece.input === undefined ? {} : piece.input))
  return ''
}

// And what came back, which is the half that says whether it worked.
function back(piece) {
  if (!piece || typeof piece !== 'object' || piece.type !== 'tool_result') return ''
  const content = piece.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((part) => part && typeof part.text === 'string' ? part.text : '').join(' ') : ''
  return '← ' + clip(text)
}

// Whether what is on the page is happening now. Said in a sentence rather than
// implied by a colour or by the lines moving: a task that is not running shows
// what its last attempt said, and a person must not have to guess which.
function logState(d) {
  if (d.running) {
    return el('span', { class: 'status passed' }, icon('▶'),
      'running now in ' + d.running.repo + ', attempt ' + (d.running.attempt || d.attempt || 1) + ' — the end of what it has printed, a few seconds behind')
  }
  if (d.attempt === null) {
    return el('span', { class: 'status info' }, icon('·'),
      'nothing has run this task, or detent prune has cleared what it said')
  }
  return el('span', { class: 'status info' }, icon('·'),
    'not running — this is what attempt ' + d.attempt + ' said, not something happening now')
}

async function refreshLog() {
  const panel = document.getElementById('task-log-panel')
  if (sectionFor(location.hash, SECTION_IDS) !== TASK_SECTION) return
  const number = taskFor(location.hash)
  // The section named with no task after it — the nav's own link, or digits
  // that are not digits. Whatever is open stays open, exactly as the detail
  // above it does: the two halves of one task must not disagree about which
  // task that is.
  if (number === null) {
    if (logTask === null) panel.hidden = true
    return
  }
  if (logReading) return
  logReading = true
  // Where this page got to, and only when the lines on it are this task's: a
  // byte offset into another task's log is an offset into nothing.
  const asked = number === logTask ? logFrom : null
  try {
    const response = await fetch('log.json?task=' + encodeURIComponent(number) + (asked === null ? '' : '&from=' + asked), { cache: 'no-store' })
    const d = await response.json()
    panel.hidden = false
    if (d.refused) {
      document.getElementById('task-log-state').replaceChildren(el('span', { class: 'status error' }, icon('✕'), d.message))
      document.getElementById('task-log').textContent = ''
      return
    }
    // A new attempt, or an answer that did not carry on from where this page
    // asked — a truncated file, a log that has been pruned — starts again
    // rather than appending the end of one thing to the middle of another.
    if (d.task !== logTask || d.attempt !== logAttempt || d.from !== asked) {
      logTask = d.task
      logAttempt = d.attempt
      logLines = []
    }
    logFrom = d.to
    if (d.text) {
      logLines = logLines.concat(d.text.split('\\n').filter(Boolean).map(saying)).slice(-LOG_LINES)
    }
    document.getElementById('task-log-state').replaceChildren(logState(d))
    const pre = document.getElementById('task-log')
    pre.textContent = logLines.join('\\n')
    // The end is the part somebody watching wants to be looking at.
    pre.scrollTop = pre.scrollHeight
  } catch (error) {
    document.getElementById('task-log-state').replaceChildren(el('span', { class: 'status error' }, icon('✕'), 'cannot read what task ' + number + ' is saying: ' + error.message))
  } finally {
    logReading = false
  }
}
`
