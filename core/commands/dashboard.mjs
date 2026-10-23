// detent dashboard — a page that watches this product, on localhost.
//
// It reads a product and writes its configuration between runs (ADR 0015).
// GET and HEAD serve the page, the snapshot, the configuration, one task and
// the end of what that task's agent is printing; the writes are
// `POST /configuration.json` and `POST /secret.json`, and every other method
// gets 405. It listens on 127.0.0.1 only, and the page it serves loads nothing
// from anywhere else.
//
// The second write is the asymmetric one (ADR 0025): a notification channel's
// token goes in and nothing ever comes out. There is no `GET /secret.json`,
// and `configuration.json` reports whether a secret is set rather than what it
// is — so the only path a token travels on this machine ends in an HTTPS
// request from `core/notify/telegram.mjs`.

import { createServer } from 'node:http'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { readConfiguration, writeChannelSecret, writeConfiguration } from '../configure.mjs'
import { PAGE } from '../dashboard-page.mjs'
import { snapshot } from '../snapshot.mjs'
import { openLog, openTask } from '../task-detail.mjs'

export const options = { port: { type: 'string', default: '4100' } }

// The one path that writes, and the one request body worth reading. A
// configuration is a few hundred bytes; a megabyte of it is somebody else's
// idea, and reading it to the end before refusing is the only part this
// server gets to decline.
const CONFIGURATION = '/configuration.json'
const LIMIT = 1 << 20

// The second write, and the only one whose body never comes back: a channel's
// secret (ADR 0025). It is `POST` only — there is no `GET /secret.json`,
// because the one thing this path exists to guarantee is that nothing reads a
// token out of this server. What is set and where is in the configuration, as a
// state with no value in it.
const SECRET = '/secret.json'

// One task, by number. The path is fixed and the number is a query parameter
// matched as digits, so nothing a browser asks for becomes a path and nothing
// outside the queue is reachable (ADR 0020 part 3).
const TASK = '/task.json'

// And the end of what its agent is printing, by the same number and a byte
// offset to carry on from (ADR 0021). The offset is what keeps a page that
// refreshes every few seconds from asking for what it already has. It goes no
// further than this machine: a transcript holds whatever the agent read, and
// this server is on loopback.
const LOG = '/log.json'

// A refusal is still an answer: which status each one gets. A number that is
// not digits is the request's fault; a number in no folder is nothing's fault;
// a queue that will not read is the product's, which is why it is not a 404 —
// the task is not missing, the queue is broken.
const REFUSED = { number: 400, unknown: 404, queue: 500 }

export function serve(product, { port = 4100, host = '127.0.0.1' } = {}) {
  const server = createServer((request, response) => {
    const headers = {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // Nothing from outside: no scripts, styles, fonts or images but its own.
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    }
    const text = (status, body) => {
      response.writeHead(status, { ...headers, 'content-type': 'text/plain' })
      response.end(body)
    }
    const json = (status, body) => {
      response.writeHead(status, { ...headers, 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }

    const url = new URL(request.url, 'http://localhost')
    const path = url.pathname

    if (request.method === 'POST' && path === CONFIGURATION) {
      return configure(product, request, json).catch((error) => text(500, `${error.message}\n`))
    }
    if (request.method === 'POST' && path === SECRET) {
      // Nothing is caught and printed from here that could carry the body: the
      // handler builds its own sentences, and a thrown one gets its message
      // and nothing of the request.
      return setSecret(product, request, json).catch((error) => text(500, `${error.message}\n`))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const allow = path === CONFIGURATION ? 'GET, HEAD, POST' : path === SECRET ? 'POST' : 'GET, HEAD'
      response.writeHead(405, { ...headers, allow, 'content-type': 'text/plain' })
      return response.end(`the dashboard reads, writes the configuration at POST ${CONFIGURATION}, and takes a channel's secret at POST ${SECRET}\n`)
    }
    // There is no reading it back, by construction and not by omission.
    if (path === SECRET) {
      response.writeHead(405, { ...headers, allow: 'POST', 'content-type': 'text/plain' })
      return response.end(`a secret is written here and never read back — POST ${SECRET}\n`)
    }

    if (path === '/') {
      response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' })
      return response.end(PAGE)
    }
    if (path === TASK || path === LOG) {
      try {
        const body = path === TASK
          ? openTask(product, url.searchParams.get('task'))
          : openLog(product, url.searchParams.get('task'), url.searchParams.get('from'))
        return json(body.refused ? REFUSED[body.refused] : 200, body)
      } catch (error) {
        return text(500, `${error.message}\n`)
      }
    }
    if (path === '/state.json' || path === CONFIGURATION) {
      try {
        const body = JSON.stringify(path === '/state.json' ? snapshot(product) : readConfiguration(product.dir))
        response.writeHead(200, { ...headers, 'content-type': 'application/json' })
        return response.end(body)
      } catch (error) {
        return text(500, `${error.message}\n`)
      }
    }
    text(404, 'not here\n')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve(server))
  })
}

async function configure(product, request, json) {
  const forged = notFromThePage(request)
  if (forged) return json(403, { refused: 'origin', message: `a write must come from the dashboard page itself — ${forged}` })

  let patch
  try {
    patch = JSON.parse(await body(request))
  } catch (error) {
    return json(400, { refused: 'body', message: `the request body is not the configuration: ${error.message}` })
  }

  const result = writeConfiguration(product.dir, patch)
  if (result.outcome === 'running') return json(409, { refused: 'running', message: result.message, active: result.active })
  if (result.outcome === 'invalid') return json(422, { refused: 'validation', message: result.message, problems: result.problems })
  if (result.outcome === 'unreadable') return json(500, { refused: 'unreadable', message: result.message })
  json(200, { written: true, configuration: result.configuration })
}

// A channel's secret, typed on the page (ADR 0025). The same origin check the
// configuration gets — a page the person did not open must not be able to
// replace the token a run sends with — and the same shape of answer. What comes
// back says whether it is set and where, and carries no value: the body of this
// request is the one thing on this server that is write-only.
async function setSecret(product, request, json) {
  const forged = notFromThePage(request)
  if (forged) return json(403, { refused: 'origin', message: `a write must come from the dashboard page itself — ${forged}` })

  let patch
  try {
    patch = JSON.parse(await body(request))
  } catch {
    // Not `error.message`: a JSON error quotes the text it choked on, and the
    // text here is a token.
    return json(400, { refused: 'body', message: 'the request body is not a secret to set' })
  }

  const result = writeChannelSecret(product.dir, patch)
  if (result.outcome === 'invalid') return json(422, { refused: 'validation', message: result.message })
  if (result.outcome === 'unknown') return json(422, { refused: 'channel', message: result.message })
  json(200, { written: true, message: result.message, secret: result.secret, configuration: readConfiguration(product.dir) })
}

// What a cross-site form cannot forge.
//
// Binding 127.0.0.1 stopped meaning anything the moment this server accepted a
// write: any site open in the same browser can post to localhost. It does not
// need a reply it is allowed to read — the write alone is the whole of the
// attack — so refusing to send CORS headers protects nothing. Two things are
// required instead, and a form on another site can produce neither:
//
//   - `origin` naming this server. The browser sets it on every POST and
//     script on a page cannot change it, so a form on example.com announces
//     example.com. It is compared against `host`, which is how the page was
//     loaded — 127.0.0.1 or localhost, on whichever port.
//   - `content-type: application/json`. A form may only send urlencoded,
//     multipart or text/plain; anything else turns the request into one the
//     browser preflights, and this server answers no preflight.
//
// Neither is authentication, and neither is meant to be: one person per
// workspace is condition 8, and what this keeps out is a page they did not
// open rather than a person who is not them.
function notFromThePage(request) {
  const { origin, host } = request.headers
  if (!host) return 'the request names no host'
  if (!origin) return 'it carries no origin header'
  if (origin !== `http://${host}`) return `it comes from ${origin}`
  const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return `its content-type is ${type || 'absent'}, which a form can send`
  return null
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > LIMIT) throw new Error(`more than ${LIMIT} bytes, which no configuration is`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function run(product, _positionals, values) {
  const port = Number(values.port)
  let server
  try {
    server = await serve(product, { port })
  } catch (error) {
    process.stderr.write(`detent dashboard: cannot listen on 127.0.0.1:${port} — ${error.code === 'EADDRINUSE' ? 'something is already there; try --port' : error.message}\n`)
    return 1
  }
  process.stdout.write(`watching ${product.name} at http://127.0.0.1:${server.address().port}/ — Ctrl-C to stop\n`)
  await new Promise((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  server.close()
  return 0
}
