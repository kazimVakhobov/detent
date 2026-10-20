import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ConfigError, MODEL_SUGGESTIONS, loadProduct, modelSuggestionsOf, queueOf, validateProduct } from '../core/product.mjs'

function minimal(overrides = {}) {
  return {
    version: 1,
    product: { name: 'acme' },
    repos: [{ name: 'acme-api', compare: 'dev' }],
    ...overrides,
  }
}

function problemsOf(raw) {
  return validateProduct(raw).problems
}

function assertProblem(raw, pattern) {
  const problems = problemsOf(raw)
  assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got:\n${problems.join('\n')}`)
}

test('the shape in DESIGN.md §11, minus what is not accepted yet, loads', () => {
  const { product, problems } = validateProduct(
    {
      version: 1,
      product: { name: 'acme', summary: 'freight marketplace' },
      branches: { integration: 'agent/dev', task: 'agent/task-{id}-{slug}' },
      concurrency: 2,
      attempts: 3,
      models: { implement: { agent: 'claude', model: 'claude-sonnet-5' }, accept: { agent: 'claude', model: 'claude-opus-5' } },
      repos: [
        {
          name: 'acme-api',
          path: 'acme-api',
          role: 'REST API backend, owns the database schema',
          stack: ['node', 'nestjs', 'postgres'],
          compare: 'dev',
          gauge: { exit: [{ stage: 'test', command: 'npm test' }], merge: [{ stage: 'build', command: 'npm run build' }] },
          models: { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'claude', model: 'claude-sonnet-5' } },
          neverCommit: ['shared-docs'],
        },
        { name: 'acme-web', compare: 'main' },
      ],
      edges: [{ from: 'acme-web', to: 'acme-api', kind: 'api-contract', source: 'model' }],
    },
    '/products/acme',
  )
  assert.deepEqual(problems, [])
  assert.equal(product.repos[0].dir, '/products/acme/acme-api')
  assert.deepEqual(product.repos[0].gauge.exit, [{ stage: 'test', command: 'npm test' }])
})

test('defaults fill what a minimal file leaves out', () => {
  const { product } = validateProduct(minimal(), '/p')
  assert.deepEqual(product.branches, { integration: 'agent/dev', task: 'agent/task-{id}-{slug}', staging: null })
  assert.equal(product.concurrency, 1)
  assert.equal(product.attempts, 3)
  assert.equal(product.repos[0].path, 'acme-api', 'path defaults to the name')
  assert.deepEqual(product.repos[0].gauge, { exit: [], merge: [], promote: [] }, 'no gauge is carried as empty, not refused')
})

test('the queue is where the product says, and tasks where it says nothing', () => {
  assert.equal(validateProduct(minimal(), '/p').product.queue, 'tasks', 'a product that says nothing keeps 0005')
  assert.equal(validateProduct(minimal({ queue: 'agent-loop/tasks' }), '/p').product.queue, 'agent-loop/tasks')
  assert.equal(validateProduct(minimal({ queue: './queue/' }), '/p').product.queue, 'queue', 'read as a path, like a repository\'s')

  // Validated exactly like repos[].path: a queue outside the product folder is
  // a problem naming the value it was given.
  assertProblem(minimal({ queue: '../shared/tasks' }), /^queue: "\.\.\/shared\/tasks" must stay inside the product folder$/)
  assertProblem(minimal({ queue: '/var/tasks' }), /^queue: "\/var\/tasks" must stay inside the product folder$/)
  assertProblem(minimal({ queue: '' }), /^queue: must be a relative path$/)
  assertProblem(minimal({ queue: 4 }), /^queue: must be a relative path$/)

  // And never inside a repository, whose tree a task file moving folders would
  // dirty — the folder the scan leaves alone is the one the queue sits in.
  assertProblem(minimal({ queue: 'acme-api/tasks' }), /^queue: "acme-api\/tasks" is inside acme-api — the queue sits beside the repositories, never in one$/)
  assertProblem(minimal({ queue: 'acme-api' }), /is inside acme-api/)
})

test('docs names a repository of the product, and null is the answer that there are none', () => {
  const withDocs = (docs) => minimal({ docs, repos: [{ name: 'acme-api', compare: 'dev' }, { name: 'acme-docs', compare: 'main' }] })

  assert.equal(validateProduct(minimal(), '/p').product.docs, null, 'a file that says nothing has none')
  assert.equal(validateProduct(minimal({ docs: null }), '/p').product.docs, null, 'and so does one that says so')
  assert.equal(validateProduct(withDocs('acme-docs'), '/p').product.docs, 'acme-docs')
  assertProblem(minimal({ docs: '' }), /^docs: must be a non-empty string$/)
  assertProblem(minimal({ docs: 4 }), /^docs: must be a non-empty string$/)
  assertProblem(minimal({ docs: 'acme docs' }), /^docs: "acme docs" must be letters, digits, "\.", "_" or "-" — it names a repository$/)

  // Read like every other reference to a repository: an edge pointing at
  // nothing is refused by the same sentence (ADR 0014).
  assertProblem(withDocs('acme-dcos'), /^docs: "acme-dcos" is not a repository in repos$/)
  assertProblem(minimal({ docs: 'acme-docs' }), /^docs: "acme-docs" is not a repository in repos$/)
})

test('queueOf reads the queue before the rest of the file can be judged', () => {
  assert.equal(queueOf({ version: 1, queue: 'agent-loop/tasks' }), 'agent-loop/tasks')
  assert.equal(queueOf({ version: 1 }), 'tasks', 'a file that says nothing')
  assert.equal(queueOf(null), 'tasks', 'and no file at all')
  assert.equal(queueOf({ queue: '../elsewhere' }), null, 'a queue that escapes has no location to look in')
})

test('a repository overrides a role, never the models as a whole', () => {
  const { product } = validateProduct(
    minimal({
      models: { implement: { agent: 'claude', model: 'cheap' }, accept: { agent: 'claude', model: 'reviewer' } },
      repos: [{ name: 'acme-api', compare: 'dev', models: { implement: { agent: 'claude', model: 'expensive' } } }],
    }),
  )
  assert.deepEqual(product.repos[0].models, { implement: { agent: 'claude', model: 'expensive' }, accept: { agent: 'claude', model: 'reviewer' } })
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'dev', models: { review: { agent: 'claude' } } }] }), /repos\[0\]\.models\.review: unknown key/)
})

test('a role names its agent; the model is optional', () => {
  assert.deepEqual(validateProduct(minimal({ models: { implement: { agent: 'claude' } } })).product.models, { implement: { agent: 'claude' } })
  assertProblem(minimal({ models: { implement: 'claude-opus-5' } }), /^models\.implement: must be \{ "agent": "claude", "model"\?: string \}/)
  assertProblem(minimal({ models: { implement: { model: 'x' } } }), /^models\.implement\.agent: must be "claude" — a role names its agent, got undefined/)
  assertProblem(minimal({ models: { implement: { agent: 'claude', model: '' } } }), /^models\.implement\.model: must be a non-empty string/)
  assertProblem(minimal({ models: { implement: { agent: 'claude', effort: 'high' } } }), /^models\.implement\.effort: unknown key/)
})

// The two agents this version withdrew are refused like any other name it does
// not offer — and the refusal says which decision took them and what brings
// one back, because a product that configured `codex` was configured correctly
// until 0018 (ADR 0018).
test('an agent this version does not offer is refused by name, with the decision that took it', () => {
  for (const agent of ['codex', 'gemini']) {
    const problem = problemsOf(minimal({ models: { implement: { agent } } }))[0]
    assert.match(problem, new RegExp(`^models\\.implement\\.agent: "${agent}" is not offered in this version — detent offers claude\\.`))
    assert.match(problem, /An agent is added once it has run a real task and its adapter was written against what it printed/)
    assert.match(problem, /docs\/adr\/0018-one-agent-in-the-first-version-and-what-readmits-another\.md$/)
  }
  // A typo is the same answer: it names what it was given rather than guessing.
  assertProblem(minimal({ models: { accept: { agent: 'cursor' } } }), /^models\.accept\.agent: "cursor" is not offered in this version/)
})

// ——— The offered model names are a suggestion (ADR 0019).

// The list as shipped: the order is part of it, because the aliases lead — they
// are the entries that do not go stale, and a run with one still gives the
// journal the model it resolved to.
test('detent ships the suggested names in one place, aliases first', () => {
  assert.deepEqual([...MODEL_SUGGESTIONS], [
    'opus',
    'sonnet',
    'haiku',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4-5',
    'claude-opus-4-8',
    'claude-fable-5',
  ])
})

// Present means exactly what it says, including empty: a name removed from a
// file's own list stays removed, and a file that says nothing is offered the
// shipped list, so nothing that exists today has to be edited to get them.
test('a file carrying modelSuggestions is offered its own list; one without it, the shipped one', () => {
  const offered = (raw) => validateProduct(raw, '/p').product.modelSuggestions

  assert.deepEqual(offered(minimal()), [...MODEL_SUGGESTIONS], 'a file that says nothing')
  assert.deepEqual(offered(minimal({ modelSuggestions: ['opus', 'mine-5'] })), ['opus', 'mine-5'])
  assert.deepEqual(offered(minimal({ modelSuggestions: [] })), [], 'an empty list offers nothing, rather than meaning "unset"')

  // The same question asked of a file nobody has validated — how the dashboard
  // reads it, exactly as it reads `queue`.
  assert.deepEqual([...modelSuggestionsOf({ version: 1 })], [...MODEL_SUGGESTIONS])
  assert.deepEqual([...modelSuggestionsOf(null)], [...MODEL_SUGGESTIONS], 'and no file at all')
  assert.deepEqual(modelSuggestionsOf({ modelSuggestions: ['sonnet'] }), ['sonnet'])
  assert.deepEqual(modelSuggestionsOf({ modelSuggestions: [] }), [])
  assert.deepEqual([...modelSuggestionsOf({ modelSuggestions: 'opus' })], [...MODEL_SUGGESTIONS],
    'a value that is not a list is not a list to offer; the validator names it')
})

test('modelSuggestions is refused by name when it is the wrong shape, with every other problem at once', () => {
  assertProblem(minimal({ modelSuggestions: 'opus' }), /^modelSuggestions: must be an array of non-empty strings$/)
  assertProblem(minimal({ modelSuggestions: ['opus', 4] }), /^modelSuggestions: must be an array of non-empty strings$/)
  assertProblem(minimal({ modelSuggestions: [''] }), /^modelSuggestions: must be an array of non-empty strings$/)
  assertProblem(minimal({ modelSuggestions: [' '] }), /^modelSuggestions: must be an array of non-empty strings$/)
  assertProblem(minimal({ modelSuggestion: ['opus'] }), /^modelSuggestion: unknown key/)

  // Beside the rest, each naming its path: the person fixing the file wants the
  // whole list, and this key arrived because somebody was handed seven problems
  // with no way to know what a model name looks like (ADR 0019).
  const problems = problemsOf(minimal({ modelSuggestions: 3, attempts: 0 }))
  assert.deepEqual(problems.map((p) => p.split(':')[0]).sort(), ['attempts', 'modelSuggestions'])
})

// The whole of the decision: the list is offered and never enforced. There is
// no refusal to assert here, which is the point — this is the test that fails
// if one is ever added.
test('a model name outside the list loads, is kept as written, and is what the agent is asked for', () => {
  const { product, problems } = validateProduct(
    minimal({
      modelSuggestions: ['opus'],
      models: { implement: { agent: 'claude', model: 'claude-sonnet-5-5' }, accept: { agent: 'claude', model: 'a-model-nobody-ships' } },
    }),
    '/p',
  )
  assert.deepEqual(problems, [])
  for (const name of ['claude-sonnet-5-5', 'a-model-nobody-ships']) {
    assert.ok(!MODEL_SUGGESTIONS.includes(name) && !product.modelSuggestions.includes(name), `${name} is not on either list`)
  }
  assert.equal(product.models.implement.model, 'claude-sonnet-5-5')
  assert.equal(product.repos[0].models.accept.model, 'a-model-nobody-ships', 'and it reaches the role a run invokes')
})

test('an unknown key is an error, at any depth, naming its path', () => {
  assertProblem(minimal({ concurency: 3 }), /^concurency: unknown key/)
  assertProblem(minimal({ product: { name: 'acme', owner: 'me' } }), /^product\.owner: unknown key/)
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'dev', gauge: { exit: [{ stage: 't', command: 'x', timeout: 5 }] } }] }), /^repos\[0\]\.gauge\.exit\[0\]\.timeout: unknown key/)
})

test('no field in branches can name a human branch', () => {
  assertProblem(minimal({ branches: { integration: 'dev' } }), /^branches\.integration: "dev" is outside agent\//)
  assertProblem(minimal({ branches: { integration: 'agent' } }), /^branches\.integration: "agent" is outside agent\//)
  assertProblem(minimal({ branches: { integration: 'agent/' } }), /^branches\.integration: "agent\/" cannot begin or end/)
  assertProblem(minimal({ branches: { integration: 'agentdev' } }), /outside agent\//)
  assertProblem(minimal({ branches: { task: 'task-{id}-{slug}' } }), /^branches\.task: .* outside agent\//)
})

test('branch values are checked as git ref names', () => {
  for (const bad of ['agent/de v', 'agent/..', 'agent/x.lock', 'agent/a~b', 'agent//dev', 'agent/.hidden', 'agent/x@{1}']) {
    assertProblem(minimal({ branches: { integration: bad } }), /^branches\.integration: /)
  }
})

test('the task template needs {id} and knows no other placeholder', () => {
  assertProblem(minimal({ branches: { task: 'agent/task-{slug}' } }), /must contain \{id\}/)
  assertProblem(minimal({ branches: { task: 'agent/task-{id}-{name}' } }), /unknown placeholder \{name\}/)
  assert.deepEqual(problemsOf(minimal({ branches: { task: 'agent/t/{id}' } })), [])
})

test('branches.staging is a second stop in the namespace, and gauge.promote a profile like the others', () => {
  const { product } = validateProduct(
    minimal({ branches: { staging: 'agent/staging' }, repos: [{ name: 'a', compare: 'dev', gauge: { promote: [{ stage: 'e2e', command: 'npm run e2e' }] } }] }),
  )
  assert.equal(product.branches.staging, 'agent/staging')
  assert.deepEqual(product.repos[0].gauge.promote, [{ stage: 'e2e', command: 'npm run e2e' }])
  assertProblem(minimal({ branches: { staging: 'staging' } }), /^branches\.staging: "staging" is outside agent\//)
  assertProblem(minimal({ branches: { staging: 'agent/dev' } }), /^branches\.staging: "agent\/dev" is the integration branch/)
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'dev', gauge: { promote: [{ stage: 'e2e' }] } }] }), /gauge\.promote\[0\]\.command/)
})

test('compare is required, and names a human branch', () => {
  assertProblem(minimal({ repos: [{ name: 'a' }] }), /^repos\[0\]\.compare: is required/)
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'agent/dev' }] }), /in the agent namespace/)
  assert.deepEqual(problemsOf(minimal({ repos: [{ name: 'a', compare: 'release/2026' }] })), [])
})

test('repositories are unique by name and by path, and stay inside the product', () => {
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'dev' }, { name: 'a', path: 'b', compare: 'dev' }] }), /"a" is declared twice/)
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'dev' }, { name: 'b', path: 'a', compare: 'dev' }] }), /repos\[1\]\.path: "a" is declared twice/)
  assertProblem(minimal({ repos: [{ name: 'a', path: '../elsewhere', compare: 'dev' }] }), /must stay inside the product folder/)
  assertProblem(minimal({ repos: [{ name: 'a', path: '/abs', compare: 'dev' }] }), /must stay inside the product folder/)
  assertProblem(minimal({ repos: [{ name: 'has space', compare: 'dev' }] }), /repos\[0\]\.name/)
  assertProblem(minimal({ repos: [] }), /^repos: must be a non-empty array/)
})

test('gauge stages are named, unique within a profile, and carry a command', () => {
  const gauge = (exit) => minimal({ repos: [{ name: 'a', compare: 'dev', gauge: { exit } }] })
  assertProblem(gauge([{ stage: 'test', command: 'a' }, { stage: 'test', command: 'b' }]), /"test" appears twice in exit/)
  assertProblem(gauge([{ stage: 'test' }]), /exit\[0\]\.command: must be a non-empty string/)
  assertProblem(gauge([{ stage: 'unit tests', command: 'x' }]), /exit\[0\]\.stage: "unit tests"/)
  assertProblem(gauge('npm test'), /gauge\.exit: must be an array/)
})

test('concurrency cannot exceed the number of repositories', () => {
  assertProblem(minimal({ concurrency: 2 }), /^concurrency: is 2, but there are only 1 repositories/)
  assertProblem(minimal({ concurrency: 0 }), /^concurrency: must be a positive integer/)
  assertProblem(minimal({ attempts: 2.5 }), /^attempts: must be a positive integer/)
})

test('every edge names known repositories and says where it came from', () => {
  const two = [{ name: 'a', compare: 'dev' }, { name: 'b', compare: 'dev' }]
  assertProblem(minimal({ repos: two, edges: [{ from: 'a', to: 'c', kind: 'x', source: 'scan' }] }), /edges\[0\]\.to: "c" is not a repository/)
  assertProblem(minimal({ repos: two, edges: [{ from: 'a', to: 'b', kind: 'x' }] }), /edges\[0\]\.source: must be "scan" or "model"/)
  assertProblem(minimal({ repos: two, edges: [{ from: 'a', to: 'a', kind: 'x', source: 'scan' }] }), /from a repository to itself/)
})

test('every problem is reported, not just the first', () => {
  const problems = problemsOf({ version: 2, product: {}, repos: [{ name: 'a' }], extra: true })
  assert.ok(problems.length >= 4, problems.join('\n'))
})

test('a missing product.json inside a repository says so, and does not send anyone one level up', () => {
  const plain = mkdtempSync(join(tmpdir(), 'detent-plain-'))
  const inRepo = mkdtempSync(join(tmpdir(), 'detent-inrepo-'))
  mkdirSync(join(inRepo, '.git'))

  const errorIn = (dir) => {
    try {
      loadProduct(dir)
      throw new Error('loadProduct did not throw')
    } catch (error) {
      return error
    }
  }
  const problemIn = (dir) => errorIn(dir).problems[0]
  const hintIn = (dir) => errorIn(dir).hint ?? ''

  // Standing somewhere ordinary: nothing here, and how a product folder is made.
  assert.match(problemIn(plain), /does not exist, and no repositories are here/)
  assert.match(hintIn(plain), /the repositories of one product/)
  assert.match(hintIn(plain), /detent init/)

  // Standing in a clone: the mistake is named, because it is the usual one.
  assert.match(problemIn(inRepo), /is a repository/)
  assert.match(hintIn(inRepo), /does not work from inside a repository/)
  // Never the parent as the fix: it is normally a projects directory, and
  // following that advice builds a product out of unrelated repositories.
  assert.ok(!hintIn(inRepo).includes(dirname(inRepo)), hintIn(inRepo))
  assert.match(hintIn(inRepo), /Not the folder above this one/)

  // A product folder kept under version control — the queue and the journal
  // are text worth a history — is where you should be standing, not a clone to
  // escape from. What settles it is the repositories inside, not the `.git`.
  const versioned = mkdtempSync(join(tmpdir(), 'detent-versioned-'))
  mkdirSync(join(versioned, '.git'))
  mkdirSync(join(versioned, 'acme-api', '.git'), { recursive: true })
  assert.match(hintIn(versioned), /1 repository is here: acme-api/)
  assert.ok(!/inside a repository/.test(hintIn(versioned)), hintIn(versioned))

  // Standing in the product folder: the hint explains what the file is, names
  // what it can see, and ends in the command. Whoever reads this has not met
  // the tool, so a list of keys would answer a question they did not ask.
  const product = mkdtempSync(join(tmpdir(), 'detent-productdir-'))
  for (const name of ['acme-api', 'acme-web', 'acme-docs']) mkdirSync(join(product, name, '.git'), { recursive: true })
  mkdirSync(join(product, 'notes'))
  const hint = hintIn(product)
  assert.match(hint, /3 repositories are here: acme-api, acme-docs, acme-web/, 'a folder that is not a repository is not counted')
  assert.match(hint, /the gauge that decides/, 'it says what the file is for')
  assert.match(hint, /tasks\/\{todo,hold,done,failed\}\//, 'and what the folder looks like')
  assert.match(hint, /detent init --no-agent/)

  // A long list wraps rather than running off the terminal.
  const many = mkdtempSync(join(tmpdir(), 'detent-many-'))
  for (let i = 0; i < 12; i += 1) mkdirSync(join(many, `acme-service-number-${i}`, '.git'), { recursive: true })
  const manyHint = hintIn(many)
  // Wrapping splits it across lines, so the claim is checked on the text and
  // the width on the lines.
  assert.match(manyHint.replace(/\n/g, ' '), /and 4 more/, 'eight are named, the rest counted')
  assert.ok(manyHint.split('\n').every((line) => line.length <= 80), 'no line runs off the terminal')
})

test('loadProduct reads .detent/product.json and throws a ConfigError naming the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detent-product-'))
  assert.throws(() => loadProduct(dir), (error) => error instanceof ConfigError && /does not exist/.test(error.problems[0]))

  mkdirSync(join(dir, '.detent'))
  writeFileSync(join(dir, '.detent', 'product.json'), '{ not json')
  assert.throws(() => loadProduct(dir), (error) => error instanceof ConfigError && /not valid JSON/.test(error.problems[0]))

  writeFileSync(join(dir, '.detent', 'product.json'), JSON.stringify(minimal({ branches: { integration: 'dev' } })))
  assert.throws(() => loadProduct(dir), (error) => error.file.endsWith(join('.detent', 'product.json')) && /branches\.integration/.test(error.message))

  writeFileSync(join(dir, '.detent', 'product.json'), JSON.stringify(minimal()))
  assert.equal(loadProduct(dir).repos[0].dir, join(dir, 'acme-api'))
})

test('notify is a command, or absent', () => {
  assert.equal(validateProduct(minimal()).product.notify, null)
  assert.equal(validateProduct(minimal({ notify: 'notify-send detent "$DETENT_MESSAGE"' })).product.notify, 'notify-send detent "$DETENT_MESSAGE"')
  assertProblem(minimal({ notify: '' }), /^notify: must be a non-empty string/)
  assertProblem(minimal({ notify: ['slack'] }), /^notify: must be a non-empty string/)
})

test('the acceptance pass runs on a different model from the one that implemented', () => {
  assertProblem(
    minimal({ models: { implement: { agent: 'claude', model: 'claude-opus-5' }, accept: { agent: 'claude', model: 'claude-opus-5' } } }),
    /^repos\[0\]\.models: implement and accept are both claude \(claude-opus-5\) — the acceptance pass runs on a different model/,
  )
  assertProblem(minimal({ models: { implement: { agent: 'claude' }, accept: { agent: 'claude' } } }), /both claude — /)
  assertProblem(
    minimal({ models: { implement: { agent: 'claude' } }, repos: [{ name: 'acme-api', compare: 'dev', models: { accept: { agent: 'claude' } } }] }),
    /^repos\[0\]\.models: implement and accept are both claude/,
  )
  // With one agent offered (ADR 0018) this is the only shape that passes: the
  // same agent on a different model. The rule is unchanged; what it costs is
  // written down in 0018.
  assert.deepEqual(problemsOf(minimal({ models: { implement: { agent: 'claude', model: 'a' }, accept: { agent: 'claude', model: 'b' } } })), [])
})

test('timeout: 30 minutes unless the product or a repository says otherwise', () => {
  assert.equal(validateProduct(minimal()).product.timeout, 30)
  assert.equal(validateProduct(minimal()).product.repos[0].timeout, 30)
  const { product } = validateProduct(
    minimal({ timeout: 45, repos: [{ name: 'a', compare: 'dev', timeout: 90 }, { name: 'b', compare: 'dev' }] }),
  )
  assert.deepEqual(product.repos.map((r) => r.timeout), [90, 45])
  assert.equal(validateProduct(minimal({ timeout: 0.5 })).product.timeout, 0.5)
  assertProblem(minimal({ timeout: 0 }), /^timeout: must be a positive number of minutes, got 0/)
  assertProblem(minimal({ timeout: '30m' }), /^timeout: must be a positive number of minutes/)
  assertProblem(minimal({ repos: [{ name: 'a', compare: 'dev', timeout: -1 }] }), /^repos\[0\]\.timeout: must be a positive number/)
})
