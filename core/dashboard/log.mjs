// What the agent is saying, under the task it is saying it about (ADR 0021),
// which is now inside the drawer that task opens in (ADR 0022). **A drawer is
// where it is drawn and not a change to how it is read**: the same one timer,
// the same request, and the same ask to carry on from the byte the last answer
// ended at.
//
// A run showed a line when a task started and a line when it ended, and
// between them — minutes, sometimes a quarter of an hour — nothing. This is the
// surface that fills in the gap, on the page somebody watching is already
// looking at: the end of the attempt log, a few seconds behind, which is what
// watching is.
//
// Four things keep it from growing without bound. The server is asked to carry
// on from the byte the last answer ended at, so a refresh every few seconds
// does not re-read what the page already has; a line that repeats the one
// before it and carries no content of its own is counted on that line rather
// than drawn again, because a model thinking prints the same event
// continuously; what is left is kept as a bounded number of lines and the
// oldest fall off the top; and each line is clipped, because a tool result the
// agent read in full is not a line somebody scans.
//
// The order of those two matters: the cap counts lines after the repetition has
// been collapsed, so a panel full of one event is not a panel that has pushed
// the agent's last real sentence off the top.
//
// **Every event is read for display and for nothing else.** The verdict, the
// cost, the tokens and the session come from the result object `agents.mjs`
// parses, exactly as they did before this file existed. Nothing here is a
// number anything depends on, which is why a line that will not parse is shown
// as it arrived rather than treated as a problem.
//
// And there are **three states, not two**. "Running" over a tail that has
// stopped moving is the symptom this surface exists to remove: only the agent's
// own turn writes a log, so a task can be running while what is running is the
// gauge, the link check, the acceptance pass or the merge — and none of those
// print here. So the sentence above the lines is made from what the page can
// actually tell: whether a run holds the task, which attempt that run is on,
// which attempt these lines are, whether the last of them is the agent's result
// object, and how long the file has been quiet. No phase is guessed, and none
// is recorded anywhere for this to read.

export const LOG_LINES = 400
export const LOG_CLIP = 220

// How long a log may be quiet before a running task is said to be quiet rather
// than watched. Longer than the pause between two things an agent prints and
// shorter than a gauge stage: under it, silence is this page being a few
// seconds behind; over it, silence is the thing worth saying.
export const LOG_QUIET = 20_000

export const LOG = `// The end of an attempt's log, from log.json — polled, unlike the rest of the
// task, because it is the one part of a task that changes under a reader.
const LOG_LINES = ${LOG_LINES}
const LOG_CLIP = ${LOG_CLIP}
const LOG_QUIET = ${LOG_QUIET}

// Which log the lines on the page belong to, and where to carry on from.
let logTask = null
let logAttempt = null
let logFrom = 0
// What is on the page, as a line each: its text, whether it carries content of
// its own, how many of it arrived in a row and when the page read the first and
// the last of them. A line and a count of that line, because twenty copies of
// one line are not twenty lines of reading.
let logLines = []
// Whether the last line that arrived is the agent's result object — the one
// event that says its turn is over. Read for the sentence above the lines and
// for nothing else: the journal's copy of that object is parsed where it always
// was, and nothing on this page is a number anything depends on.
let logDone = false
// One read at a time: the timer must not overlap the read that opening a task
// started, or both would answer from the same offset and say it twice.
let logReading = false

const clip = (text) => {
  const one = String(text === null || text === undefined ? '' : text).replace(/\\s+/g, ' ').trim()
  return one.length > LOG_CLIP ? one.slice(0, LOG_CLIP) + '…' : one
}

// One line of the stream, as a line for a person — and whether it carries
// content of its own. An event detent has no reading for is its type, and a
// line that is not an event at all is itself: this is a view of what the agent
// printed, so it never refuses to show it.
//
// **\`bare\` is the test for collapsing, and it is about content rather than
// about a type.** A line is bare when the event had nothing in it to show: a
// type detent has no reading for, which prints as the type and nothing else, or
// an assistant turn with nothing renderable in it. Nothing names an event type
// here — a reading of one agent's stream is not detent's to invent. Everything
// the agent actually said or asked a tool for carries content, so two of them
// are two lines however alike they look: two calls to the same tool are two
// calls, and two turns are two turns.
function saying(raw) {
  let event = null
  try {
    event = JSON.parse(raw)
  } catch (error) {
    return { text: raw, bare: false }
  }
  if (!event || typeof event !== 'object') return { text: raw, bare: false }
  const content = event.message && Array.isArray(event.message.content) ? event.message.content : []
  if (event.type === 'system') return { text: '· ' + (event.subtype === 'init' ? 'started' + (event.model ? ' on ' + event.model : '') : event.subtype || 'system'), bare: false }
  if (event.type === 'assistant') {
    const text = content.map(said).filter(Boolean).join('\\n')
    return text ? { text, bare: false } : { text: '· thinking', bare: true }
  }
  if (event.type === 'user') return { text: content.map(back).filter(Boolean).join('\\n'), bare: false }
  if (event.type === 'result') return { text: '· finished: ' + (event.subtype || '—') + (typeof event.total_cost_usd === 'number' ? ' · $' + event.total_cost_usd.toFixed(4) : ''), bare: false }
  return { text: '· ' + (event.type || raw), bare: true }
}

// A line that has just arrived, added to the lines already on the page — or
// counted on the last of them. **A bare line that repeats the one before it
// does not get a line of its own**: the stream prints the same event
// continuously while a model thinks, so the panel filled with twenty copies of
// one word and the last thing the agent said went off the top. Nothing with
// content is ever collapsed, whatever it repeats.
//
// \`at\` is when the page *read* the line, not when the agent wrote it: the log
// carries no times, and asking an event for one would be reading this stream
// for meaning (ADR 0021). So what a collapsed line can report is the stretch
// the page watched it over — which is the thing worth knowing about it, because
// four minutes of the same nothing and four seconds of it are different news
// for somebody deciding whether to look at the task.
function logAdd(lines, raw, at) {
  const line = saying(raw)
  const last = lines[lines.length - 1]
  if (line.bare && last && last.bare && last.text === line.text) {
    last.count += 1
    last.to = at
    return lines
  }
  lines.push({ text: line.text, bare: line.bare, count: 1, from: at, to: at })
  return lines
}

// How a line reads: itself, or itself with how many there were and over how
// long. Lines that arrived in one read say that rather than a duration of
// nothing — the page cannot say how long the agent took over what it had
// already finished printing by the time the panel was opened.
function logShow(line) {
  if (line.count < 2) return line.text
  const over = line.to - line.from
  return line.text + ' ×' + line.count + ' · ' + (over < 1000 ? 'in one read' : 'over ' + logSince(over))
}

// What the agent said, or asked a tool for.
function said(piece) {
  if (!piece || typeof piece !== 'object') return ''
  if (piece.type === 'text') return clip(piece.text)
  if (piece.type === 'tool_use') return '→ ' + (piece.name || 'tool') + ' ' + clip(JSON.stringify(piece.input === undefined ? {} : piece.input))
  return ''
}

// Whether a line is the agent's last — the result object it prints when its
// turn is over. One field of it is read, and no number in it: what it costs and
// what it says are the journal's, from the same object, parsed where they
// always were (ADR 0021).
function isResult(raw) {
  try {
    const event = JSON.parse(raw)
    return Boolean(event) && typeof event === 'object' && event.type === 'result'
  } catch (error) {
    return false
  }
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

// How long since anything arrived, as somebody would read it off a clock.
function logSince(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return seconds + 's'
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'
}

// Whether what is on the page is happening now — and when the lines are not
// moving, which kind of not-moving it is. Said in a sentence rather than
// implied by a colour or by the lines themselves, because a frozen tail under
// the word "running" is the thing this surface was built to stop.
//
// Every branch is a fact the page holds: a run claims the task or none does,
// the claim names an attempt, these lines are an attempt, the last of them is
// the result object or is not, the file changed recently or has not. Nothing
// below names the phase a run is in — detent records none, and a guessed one
// would be wrong in exactly the cases worth reading.
function logState(d) {
  if (!d.running) {
    if (d.attempt === null) {
      return el('span', { class: 'status info' }, icon('·'),
        'nothing has run this task, or detent prune has cleared what it said')
    }
    return el('span', { class: 'status info' }, icon('·'),
      'not running — this is what attempt ' + d.attempt + ' said, not something happening now')
  }

  const attempt = d.running.attempt || d.attempt || 1
  const where = 'running now in ' + d.running.repo + ', attempt ' + attempt
  const elsewhere = ' — the agent is not printing: the rest of a run writes no log, so what is running is the gauge, the acceptance pass or the merge'
  // Running with no log at all, or with one belonging to an earlier attempt:
  // nothing is arriving here and the box would otherwise look like a run that
  // had gone quiet.
  if (d.attempt === null) {
    return el('span', { class: 'status look' }, icon('!'),
      where + ' — nothing is being written here: the run could not open a log, or detent prune has cleared it')
  }
  if (d.attempt !== attempt) {
    return el('span', { class: 'status look' }, icon('!'),
      where + ', and the lines below are attempt ' + d.attempt + elsewhere)
  }
  // The agent printed its result object: its turn is over, and whatever is
  // keeping the task claimed is not it.
  if (logDone) {
    return el('span', { class: 'status look' }, icon('!'),
      where + ', and the agent has finished printing' + elsewhere)
  }
  if (typeof d.quiet === 'number' && d.quiet >= LOG_QUIET) {
    return el('span', { class: 'status look' }, icon('!'),
      where + ' — nothing has arrived for ' + logSince(d.quiet) + '; the agent is mid-turn, and a tool call prints nothing here until it returns')
  }
  return el('span', { class: 'status passed' }, icon('▶'),
    where + ' — the end of what it has printed, a few seconds behind')
}

async function refreshLog() {
  // No task open: the drawer is closed, the one timer still runs, and there is
  // nothing here for it to read. Whatever the panel last read stays in it
  // rather than being emptied — the drawer being closed is the reason nobody
  // is looking at it, and reopening the same task shows what it already had.
  const number = taskFor(location.hash, SECTION_IDS)
  if (number === null || logReading) return
  logReading = true
  const panel = document.getElementById('task-log-panel')
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
      logDone = false
    }
    logFrom = d.to
    if (d.text) {
      const arrived = d.text.split('\\n').filter(Boolean)
      // One read is one reading of the clock: every line in it arrived
      // together, which is what a collapsed line of them says.
      const at = Date.now()
      for (const raw of arrived) logAdd(logLines, raw, at)
      // And the cap counts lines a person can read, so it is applied to what
      // collapsing left rather than to what arrived.
      logLines = logLines.slice(-LOG_LINES)
      logDone = isResult(arrived[arrived.length - 1])
    }
    document.getElementById('task-log-state').replaceChildren(logState(d))
    const pre = document.getElementById('task-log')
    pre.textContent = logLines.map(logShow).join('\\n')
    // The end is the part somebody watching wants to be looking at.
    pre.scrollTop = pre.scrollHeight
  } catch (error) {
    document.getElementById('task-log-state').replaceChildren(el('span', { class: 'status error' }, icon('✕'), 'cannot read what task ' + number + ' is saying: ' + error.message))
  } finally {
    logReading = false
  }
}
`
