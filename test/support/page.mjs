// The page's own script, run against a document that is enough of one.
//
// The dashboard is served as one string of JavaScript, and what is worth
// asserting about the configuration panel is behaviour: which half of it is
// shown, what a run refuses, what is still in the editor after a refusal. So
// the test runs *that string* — the same one the browser is served — with a
// stub document under it and the real server in front of it, rather than
// reading its source and hoping. It is the same trick `sectionFor` and
// `warnings` are tested with, for the half of the script that touches a
// document.
//
// Not a test file; node --test loads it and finds nothing to run.

import { SCRIPT } from '../../core/dashboard-page.mjs'
import { BODY, SECTION_IDS } from '../../core/dashboard/sections.mjs'

// An element. Attributes and properties are kept apart the way the script uses
// them — `setAttribute` for what it draws, plain properties for `value`,
// `disabled` and `hidden`, which is how a browser tells them apart too.
class StubNode {
  constructor(tag, attrs = {}) {
    this.tag = tag
    this.attrs = { ...attrs }
    this.children = []
    this.handlers = new Map()
    this.hidden = Object.hasOwn(attrs, 'hidden')
    this.disabled = false
    this.selected = false
    this.placeholder = attrs.placeholder ?? ''
    this.className = attrs.class ?? ''
    // A browser answers `.id` as well as `getAttribute('id')`, and
    // `showSection` reads it to decide which section is the shown one.
    this.id = attrs.id ?? ''
  }

  setAttribute(key, value) {
    this.attrs[key] = String(value)
    if (key === 'class') this.className = String(value)
  }

  getAttribute(key) { return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null }
  removeAttribute(key) { delete this.attrs[key] }
  // A string child becomes a text node, as it does in a document: the page
  // hands `replaceChildren` sentences as well as elements.
  append(...nodes) { for (const node of nodes) this.children.push(adopt(node)) }
  replaceChildren(...nodes) { this.children = nodes.map(adopt) }
  addEventListener(type, handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]) }

  // What a click does, awaited: the handlers the page wired are async.
  click() { return Promise.all((this.handlers.get('click') ?? []).map((handler) => handler())) }

  get textContent() { return this.children.map((child) => child.textContent).join('') }
  set textContent(value) { this.children = value === '' || value === null || value === undefined ? [] : [new StubText(value)] }

  // A select answers with the option that is selected, which is how the page
  // reads one; an input answers with what was typed into it.
  get value() {
    if (this.typed !== undefined) return this.typed
    if (this.tag !== 'select') return ''
    const options = this.children.filter((child) => child.tag === 'option')
    const chosen = options.find((option) => option.selected) ?? options[0]
    return chosen ? chosen.attrs.value ?? '' : ''
  }

  set value(value) { this.typed = String(value) }

  // Everything under here, this node first: how a test finds the controls the
  // editor built, or asserts that the view built none.
  all(matches) {
    const found = []
    const walk = (node) => {
      if (!matches || matches(node)) found.push(node)
      for (const child of node.children) walk(child)
    }
    walk(this)
    return found
  }

  tags(...names) { return this.all((node) => names.includes(node.tag)) }
}

class StubText extends StubNode {
  constructor(data) {
    super('#text')
    this.data = String(data)
  }

  get textContent() { return this.data }
  set textContent(value) { this.data = String(value) }
}

const adopt = (node) => node instanceof StubNode ? node : new StubText(node)

// Every attribute on an opening tag. `hidden` has no value and is still an
// attribute, which is the whole point of reading the served markup rather than
// declaring the ids here: what the document starts as is what it is served as.
function attributes(text) {
  const attrs = {}
  for (const [, key, value] of text.matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) attrs[key] = value ?? ''
  return attrs
}

// The elements the page renders into, built from the markup it serves. An id
// the document has not got is an error rather than an empty node: a script
// that draws into nothing is the mistake this would otherwise hide.
function documentFrom(markup) {
  const byId = new Map()
  for (const [, tag, rest] of markup.matchAll(/<([a-z0-9]+)\b([^>]*)>/gi)) {
    const attrs = attributes(rest)
    if (attrs.id) byId.set(attrs.id, new StubNode(tag.toLowerCase(), attrs))
  }
  const nav = SECTION_IDS.map((id) => {
    const link = new StubNode('a', { href: `#${id}` })
    link.hash = `#${id}`
    return link
  })
  return {
    title: '',
    byId,
    nav,
    createElement: (tag) => new StubNode(tag),
    createTextNode: (data) => new StubText(data),
    getElementById(id) {
      if (!byId.has(id)) throw new Error(`the page draws into #${id}, which the document has not got`)
      return byId.get(id)
    },
    querySelectorAll(selector) {
      if (selector === 'main > section[id]') return SECTION_IDS.map((id) => byId.get(id))
      if (selector === 'nav a[href]') return nav
      throw new Error(`the stub document was asked for ${selector}`)
    },
  }
}

// The page's own fetch: relative to the server that served it, and the browser
// announces the origin on the write, which is the one the server insists on.
const browserFetch = (base) => (path, options = {}) => fetch(new URL(path, `${base}/`), {
  ...options,
  headers: { ...(options.headers ?? {}), ...(options.method === 'POST' ? { origin: base } : {}) },
})

// The served script, running. Every timer it sets is recorded rather than
// started — a test that waited three seconds would be testing the clock — and
// every request it makes is written down, so a test can say what the page read
// and when rather than only what it ended up showing.
export function openPage(base, { hash = '' } = {}) {
  const document = documentFrom(BODY)
  const timers = []
  const reads = []
  const browser = browserFetch(base)
  let pending = 0

  const traced = (path, options = {}) => {
    reads.push(`${options.method ?? 'GET'} ${path}`)
    pending += 1
    return browser(path, options).finally(() => { pending -= 1 })
  }

  const window = {
    listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler) },
  }
  // A fragment changing, and the browser telling the page about it: one is not
  // the other in a browser either, so a test that wants both says both.
  const location = { hash }

  const start = new Function('document', 'window', 'location', 'fetch', 'setInterval', 'Node',
    `${SCRIPT}\nreturn { refresh, loadConfig, refreshConfig, openEditor, save, discard, showSection, closeTask, inside: () => ({ config, editing, fields }) }`)

  const page = start(document, window, location, traced, (call, every) => timers.push({ call, every }), StubNode)

  return {
    ...page,
    document,
    timers,
    reads,
    location,
    node: (id) => document.getElementById(id),
    click: (id) => document.getElementById(id).click(),
    text: (id) => document.getElementById(id).textContent,
    // A key, to whatever the page listens with — and the fragment changing,
    // which is what a browser answers a clicked link or a typed address with.
    press: (key) => window.listeners.get('keydown')({ key }),
    go(to) {
      location.hash = to
      return window.listeners.get('hashchange')()
    },
    editing: () => page.inside().editing,
    // Whatever the page started on its own — the read it does at load — has
    // finished. Nothing here waits on a clock: the timers are recorded, not
    // started, so the only thing in flight is a request.
    async settle() {
      const tick = () => new Promise((resolve) => { setImmediate(resolve) })
      while (pending > 0) await tick()
      await tick()
      await tick()
    },
  }
}
