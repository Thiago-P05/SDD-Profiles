import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  agentNames,
  applyUpdates,
  markdownAgents,
  normalizeProfile,
  planActivation,
  setBuiltin,
  updateFrontmatter,
} from './sdd.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sampleConfig = fs.readFileSync(path.join(here, 'fixtures', 'opencode.sample.jsonc'), 'utf8')
const sampleAgent = fs.readFileSync(path.join(here, 'fixtures', 'agent.sample.md'), 'utf8')

function profile(overrides = {}) {
  const agents = {
    orchestrator: { model: 'provider/model-orch', variant: 'low' },
    explore: { model: 'provider/model-explore', variant: 'xhigh' },
    builder: { model: 'provider/model-build', variant: 'high' },
    judge: { model: 'provider/model-judge', variant: 'high' },
    build: { model: 'provider/model-build', variant: 'high' },
    ...overrides,
  }
  return { agents }
}

function agentSources(overrides = {}) {
  return Object.fromEntries(markdownAgents.map((name) => [name, overrides[name] ?? sampleAgent]))
}

test('setBuiltin is idempotent when combined model#variant already matches', () => {
  const next = setBuiltin(sampleConfig, 'build', 'provider/model-build', 'high')
  assert.equal(next, sampleConfig)
})

test('setBuiltin updates combined hash and preserves JSONC, MCP and extra fields', () => {
  const next = setBuiltin(sampleConfig, 'build', 'provider/model-build', 'low')
  assert.match(next, /"model": "provider\/model-build#low"/)
  assert.match(next, /"keep": "yes"/)
  assert.match(next, /"options": \{ "nested": true \}/)
  assert.match(next, /\/\/ builtin primary/)
  assert.match(next, /"model": "provider\/do-not-touch#max"/)
  assert.match(next, /"model": "leave-me"/)
  assert.match(next, /"mcp":  \{/)
  assert.equal(next.includes('provider/model-build#high'), false)
  const mcpIndex = next.indexOf('"mcp"')
  const extraIndex = next.indexOf('"extra"')
  assert.equal(next.slice(mcpIndex), sampleConfig.slice(sampleConfig.indexOf('"mcp"')))
  assert.equal(next.slice(extraIndex), sampleConfig.slice(sampleConfig.indexOf('"extra"')))
})

test('setBuiltin does not touch a nested build object outside agents', () => {
  const next = setBuiltin(sampleConfig, 'explore', 'provider/model-explore', 'medium')
  assert.match(next, /"model": "provider\/model-explore#medium"/)
  assert.match(next, /"build": \{\s*"model": "provider\/do-not-touch#max"/)
})

test('setBuiltin finds model after nested objects and comments with braces', () => {
  const source = `{
  "agents": {
    "build": {
      // } should not end the block
      "options": { "nested": { "again": 1 } },
      "model": "provider/model-build#high"
    }
  }
}`
  const next = setBuiltin(source, 'build', 'provider/other-build', 'max')
  assert.match(next, /"model": "provider\/other-build#max"/)
  assert.match(next, /"options": \{ "nested": \{ "again": 1 \} \}/)
  assert.match(next, /\/\/ \} should not end the block/)
})

test('setBuiltin keeps split variant field instead of hashing model', () => {
  const source = `{
  "agents": {
    "build": {
      "model": "provider/model-build",
      "variant": "high"
    }
  }
}`
  const same = setBuiltin(source, 'build', 'provider/model-build', 'high')
  assert.equal(same, source)
  const next = setBuiltin(source, 'build', 'provider/model-next', 'low')
  assert.match(next, /"model": "provider\/model-next"/)
  assert.match(next, /"variant": "low"/)
  assert.doesNotMatch(next, /model-next#/)
})

test('setBuiltin preserves CRLF and extra spacing around model', () => {
  const source = '{\r\n  "agents": {\r\n    "build": {\r\n      "model":  "provider/model-build#high"\r\n    }\r\n  }\r\n}\r\n'
  const same = setBuiltin(source, 'build', 'provider/model-build', 'high')
  assert.equal(same, source)
  const next = setBuiltin(source, 'build', 'provider/model-build', 'xhigh')
  assert.equal(next.includes('\r\n'), true)
  assert.match(next, /"model":  "provider\/model-build#xhigh"/)
})

test('updateFrontmatter is idempotent and preserves extra YAML and body', () => {
  const same = updateFrontmatter(sampleAgent, 'provider/model-old', 'low')
  assert.equal(same, sampleAgent)
  const next = updateFrontmatter(sampleAgent, 'provider/model-new', 'xhigh')
  assert.match(next, /^model: provider\/model-new#xhigh$/m)
  assert.match(next, /description: Sample agent/)
  assert.match(next, /mode: subagent/)
  assert.match(next, /effect: deny/)
  assert.match(next, /literal model: provider\/model-old#low/)
})

test('updateFrontmatter accepts CRLF frontmatter', () => {
  const source = '---\r\nmodel: provider/model-old#low\r\n---\r\n\r\nBody\r\n'
  const same = updateFrontmatter(source, 'provider/model-old', 'low')
  assert.equal(same, source)
  const next = updateFrontmatter(source, 'provider/model-new', 'high')
  assert.equal(next, '---\r\nmodel: provider/model-new#high\r\n---\r\n\r\nBody\r\n')
})

test('planActivation succeeds when jsonc models already match and only markdown changes', () => {
  const planned = planActivation(profile({
    builder: { model: 'provider/model-new', variant: 'max' },
  }), { configSource: sampleConfig, agentSources: agentSources() })
  assert.equal(planned.configAfter, sampleConfig)
  assert.match(planned.agentsAfter.builder, /model: provider\/model-new#max/)
  assert.match(planned.agentsAfter.orchestrator, /model: provider\/model-orch#low/)
})

test('planActivation is fully idempotent when everything already matches', () => {
  const sources = agentSources({
    orchestrator: updateFrontmatter(sampleAgent, 'provider/model-orch', 'low'),
    builder: updateFrontmatter(sampleAgent, 'provider/model-build', 'high'),
    judge: updateFrontmatter(sampleAgent, 'provider/model-judge', 'high'),
  })
  const planned = planActivation(profile(), { configSource: sampleConfig, agentSources: sources })
  assert.equal(planned.configAfter, sampleConfig)
  for (const agent of markdownAgents) assert.equal(planned.agentsAfter[agent], sources[agent])
})

test('planActivation does not rewrite MCP when builtins change', () => {
  const planned = planActivation(profile({
    build: { model: 'provider/model-next', variant: 'medium' },
  }), { configSource: sampleConfig, agentSources: agentSources() })
  assert.match(planned.configAfter, /"model": "provider\/model-next#medium"/)
  assert.equal(
    planned.configAfter.slice(planned.configAfter.indexOf('"mcp"')),
    sampleConfig.slice(sampleConfig.indexOf('"mcp"')),
  )
})

test('applyUpdates skips unchanged files and rolls back partial writes', () => {
  const files = {
    'builder.md': 'old-md',
    'opencode.jsonc': 'old-config',
  }
  applyUpdates([
    { file: 'builder.md', before: 'old-md', after: 'old-md' },
    { file: 'opencode.jsonc', before: 'old-config', after: 'old-config' },
  ], (file, content) => {
    files[file] = content
    assert.fail(`should not write ${file}`)
  })
  assert.equal(files['builder.md'], 'old-md')

  const writes = []
  const failing = {
    'builder.md': 'old-md',
    'opencode.jsonc': 'old-config',
  }
  assert.throws(() => applyUpdates([
    { file: 'builder.md', before: 'old-md', after: 'new-md' },
    { file: 'opencode.jsonc', before: 'old-config', after: 'new-config' },
  ], (file, content) => {
    writes.push([file, content])
    if (file === 'opencode.jsonc' && content === 'new-config') throw new Error('disk full')
    failing[file] = content
  }), /disk full/)
  assert.equal(failing['builder.md'], 'old-md')
  assert.equal(failing['opencode.jsonc'], 'old-config')
  assert.deepEqual(writes, [
    ['builder.md', 'new-md'],
    ['opencode.jsonc', 'new-config'],
    ['opencode.jsonc', 'old-config'],
    ['builder.md', 'old-md'],
  ])
})

test('applyUpdates rolls back the in-progress file when the writer mutates then throws', () => {
  const files = {
    'builder.md': 'old-md',
    'opencode.jsonc': 'old-config',
  }
  let exploded = false
  assert.throws(() => applyUpdates([
    { file: 'builder.md', before: 'old-md', after: 'new-md' },
    { file: 'opencode.jsonc', before: 'old-config', after: 'new-config' },
  ], (file, content) => {
    if (!exploded && file === 'opencode.jsonc' && content === 'new-config') {
      files[file] = 'new-con'
      exploded = true
      throw new Error('partial write')
    }
    files[file] = content
  }), /partial write/)
  assert.equal(files['builder.md'], 'old-md')
  assert.equal(files['opencode.jsonc'], 'old-config')
})

test('tui.js plans activation before writing and does not fail unchanged jsonc', () => {
  const source = fs.readFileSync(new URL('./tui.js', import.meta.url), 'utf8')
  assert.match(source, /planActivation\(/)
  assert.match(source, /applyUpdates\(/)
  assert.match(source, /return normalizeProfile\(profile\)/)
  assert.match(source, /JSON\.stringify\(normalizeProfile\(profile\), null, 2\)/)
  assert.doesNotMatch(source, /La activación no cambió opencode\.jsonc/)
  assert.doesNotMatch(source, /\[\^}\]\*\?/)
})

test('agent lists and saved schema do not include planner', () => {
  assert.deepEqual(agentNames, ['orchestrator', 'explore', 'builder', 'judge', 'build'])
  assert.deepEqual(markdownAgents, ['orchestrator', 'builder', 'judge'])
  assert.equal(agentNames.includes('planner'), false)
  assert.equal(markdownAgents.includes('planner'), false)
})

test('normalizeProfile drops a retired planner field and keeps the other models', () => {
  const raw = profile({
    planner: { model: 'provider/model-plan', variant: 'medium' },
  })
  const normalized = normalizeProfile(raw)
  assert.equal(normalized.agents.planner, undefined)
  assert.deepEqual(Object.keys(normalized.agents), ['orchestrator', 'explore', 'builder', 'judge', 'build'])
  assert.equal(normalized.agents.orchestrator.model, 'provider/model-orch')
  assert.equal(normalized.agents.explore.model, 'provider/model-explore')
  assert.equal(normalized.agents.explore.variant, 'xhigh')
  assert.equal(normalized.agents.builder.model, 'provider/model-build')
  assert.equal(normalized.agents.judge.variant, 'high')
  assert.equal(normalized.agents.build.model, 'provider/model-build')
})

test('planActivation ignores an extra planner field and does not require planner.md', () => {
  const planned = planActivation(profile({
    planner: { model: 'provider/obsolete', variant: 'max' },
  }), { configSource: sampleConfig, agentSources: agentSources() })
  assert.equal(Object.hasOwn(planned.agentsAfter, 'planner'), false)
  assert.match(planned.agentsAfter.orchestrator, /model: provider\/model-orch#low/)
  assert.match(planned.agentsAfter.builder, /model: provider\/model-build#high/)
  assert.match(planned.agentsAfter.judge, /model: provider\/model-judge#high/)
  assert.equal(planned.configAfter, sampleConfig)
})

test('planActivation still rejects a profile missing a required agent even if planner is present', () => {
  const raw = profile({ planner: { model: 'provider/model-plan', variant: 'medium' } })
  delete raw.agents.builder
  assert.throws(() => planActivation(raw, { configSource: sampleConfig, agentSources: agentSources() }), /builder/)
})

test('planActivation throws before applyUpdates when a builtin block is missing', () => {
  const broken = '{\n  "agents": {\n    "explore": { "model": "provider/model-explore#xhigh" }\n  }\n}\n'
  let planned = null
  assert.throws(() => {
    planned = planActivation(profile(), { configSource: broken, agentSources: agentSources() })
  }, /No se encontró el bloque de build/)
  assert.equal(planned, null)
})
