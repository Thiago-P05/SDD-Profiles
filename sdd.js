export const agentNames = ['orchestrator', 'explore', 'builder', 'judge', 'build']
export const markdownAgents = ['orchestrator', 'builder', 'judge']
export const builtinAgents = ['build', 'explore']
export const efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max']

const modelPattern = /^[\w.-]+\/[\w./-]+$/

function fail(message) {
  throw new Error(message)
}

function skipLineComment(source, i) {
  while (i < source.length && source[i] !== '\n') i += 1
  return i
}

function skipBlockComment(source, i) {
  const end = source.indexOf('*/', i + 2)
  return end < 0 ? source.length : end + 2
}

function skipTrivia(source, i, end = source.length) {
  while (i < end) {
    const char = source[i]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i)
      continue
    }
    if (char === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i)
      continue
    }
    break
  }
  return i
}

function skipString(source, i, end = source.length) {
  i += 1
  while (i < end) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === '"') return i + 1
    i += 1
  }
  return end
}

function readJsonString(source, i, end = source.length) {
  if (source[i] !== '"') return null
  const after = skipString(source, i, end)
  try {
    return { value: JSON.parse(source.slice(i, after)), after }
  } catch {
    return null
  }
}

function findMatchingBrace(source, open, end = source.length) {
  let depth = 0
  let i = open
  while (i < end) {
    const char = source[i]
    if (char === '"') {
      i = skipString(source, i, end)
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i)
      continue
    }
    if (char === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i)
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

function findRootObject(source) {
  let i = 0
  if (source.charCodeAt(0) === 0xfeff) i = 1
  i = skipTrivia(source, i)
  if (source[i] !== '{') return null
  const close = findMatchingBrace(source, i)
  if (close < 0) return null
  return { open: i, close }
}

function findObjectProperty(source, key, from, to, keyDepth) {
  let i = from
  let depth = keyDepth
  while (i < to) {
    i = skipTrivia(source, i, to)
    if (i >= to) break
    if (source[i] === '"') {
      const parsed = readJsonString(source, i, to)
      if (!parsed) {
        i += 1
        continue
      }
      const colon = skipTrivia(source, parsed.after, to)
      if (colon < to && source[colon] === ':' && depth === keyDepth && parsed.value === key) {
        const valueStart = skipTrivia(source, colon + 1, to)
        if (valueStart < to && source[valueStart] === '{') {
          const close = findMatchingBrace(source, valueStart, to)
          if (close < 0) return null
          return { open: valueStart, close }
        }
      }
      i = parsed.after
      continue
    }
    if (source[i] === '{') {
      depth += 1
      i += 1
      continue
    }
    if (source[i] === '}') {
      depth -= 1
      i += 1
      continue
    }
    i += 1
  }
  return null
}

function findTopLevelProperty(body, key) {
  let i = 0
  let depth = 0
  while (i < body.length) {
    i = skipTrivia(body, i)
    if (i >= body.length) break
    if (body[i] === '"') {
      const parsed = readJsonString(body, i)
      if (!parsed) {
        i += 1
        continue
      }
      const colon = skipTrivia(body, parsed.after)
      if (colon < body.length && body[colon] === ':' && depth === 0 && parsed.value === key) {
        const valueStart = skipTrivia(body, colon + 1)
        if (valueStart < body.length && body[valueStart] === '"') {
          const value = readJsonString(body, valueStart)
          if (!value) return { kind: 'other' }
          return { kind: 'string', value: value.value, start: valueStart, end: value.after }
        }
        return { kind: 'other' }
      }
      i = parsed.after
      continue
    }
    if (body[i] === '{') {
      depth += 1
      i += 1
      continue
    }
    if (body[i] === '}') {
      depth -= 1
      i += 1
      continue
    }
    i += 1
  }
  return null
}

function replaceStringProperty(body, key, nextValue) {
  const property = findTopLevelProperty(body, key)
  if (!property || property.kind !== 'string') return null
  return `${body.slice(0, property.start)}${JSON.stringify(nextValue)}${body.slice(property.end)}`
}

function parseStoredModel(modelValue, variantValue) {
  if (typeof variantValue === 'string') {
    const hash = modelValue.lastIndexOf('#')
    return {
      model: hash > 0 ? modelValue.slice(0, hash) : modelValue,
      variant: variantValue,
    }
  }
  const hash = modelValue.lastIndexOf('#')
  if (hash > 0) return { model: modelValue.slice(0, hash), variant: modelValue.slice(hash + 1) }
  return { model: modelValue, variant: '' }
}

function findAgentsBlock(source, name) {
  const root = findRootObject(source)
  if (!root) fail('No se encontró el objeto agents en opencode.jsonc')
  const agents = findObjectProperty(source, 'agents', root.open + 1, root.close, 1)
  if (!agents) fail('No se encontró el objeto agents en opencode.jsonc')
  const block = findObjectProperty(source, name, agents.open + 1, agents.close, 2)
  if (!block) fail(`No se encontró el bloque de ${name} en opencode.jsonc`)
  return block
}

export function setBuiltin(source, name, model, variant) {
  const block = findAgentsBlock(source, name)
  const body = source.slice(block.open + 1, block.close)
  const modelProperty = findTopLevelProperty(body, 'model')
  if (!modelProperty) fail(`Falta model en el bloque de ${name} en opencode.jsonc`)
  if (modelProperty.kind !== 'string') fail(`El model de ${name} no es un string en opencode.jsonc`)
  const variantProperty = findTopLevelProperty(body, 'variant')
  if (variantProperty?.kind === 'other') fail(`El variant de ${name} no es un string en opencode.jsonc`)
  const current = parseStoredModel(modelProperty.value, variantProperty?.kind === 'string' ? variantProperty.value : undefined)
  if (current.model === model && current.variant === variant) return source
  const nextModel = variantProperty?.kind === 'string' ? model : `${model}#${variant}`
  let nextBody = replaceStringProperty(body, 'model', nextModel)
  if (nextBody == null) fail(`No se pudo actualizar ${name} en opencode.jsonc`)
  if (variantProperty?.kind === 'string') {
    nextBody = replaceStringProperty(nextBody, 'variant', variant)
    if (nextBody == null) fail(`No se pudo actualizar ${name} en opencode.jsonc`)
  }
  if (nextBody === body) fail(`No se pudo actualizar ${name} en opencode.jsonc`)
  return `${source.slice(0, block.open + 1)}${nextBody}${source.slice(block.close)}`
}

export function updateFrontmatter(source, model, variant) {
  const start = source.match(/^---\r?\n/)
  if (!start) fail('Agente sin frontmatter')
  const rest = source.slice(start[0].length)
  const end = rest.match(/\r?\n---(?=\r?\n|$)/)
  if (!end) fail('Frontmatter incompleto')
  const header = rest.slice(0, end.index)
  if (!/^model:[^\r\n]*/m.test(header)) fail('Agente sin modelo')
  const combined = `${model}#${variant}`
  let nextHeader = header.replace(/^model:[^\r\n]*/m, `model: ${combined}`)
  if (/^variant:[^\r\n]*/m.test(nextHeader)) {
    nextHeader = nextHeader.replace(/^variant:[^\r\n]*/m, `variant: ${variant}`)
  }
  return `${start[0]}${nextHeader}${rest.slice(end.index)}`
}

export function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !profile.agents || typeof profile.agents !== 'object' || Array.isArray(profile.agents)) {
    fail('Perfil inválido')
  }
  const agents = {}
  for (const agent of agentNames) {
    const setting = profile.agents[agent]
    if (!setting || typeof setting !== 'object' || Array.isArray(setting) || !modelPattern.test(setting.model) || !efforts.includes(setting.variant)) {
      fail(`Modelo o esfuerzo inválido: ${agent}`)
    }
    agents[agent] = { model: setting.model, variant: setting.variant }
  }
  return { agents }
}

export function planActivation(profile, { configSource, agentSources }) {
  const normalized = normalizeProfile(profile)
  const agentsAfter = {}
  for (const agent of markdownAgents) {
    const before = agentSources?.[agent]
    if (typeof before !== 'string') fail(`No se encontró el agente ${agent}`)
    agentsAfter[agent] = updateFrontmatter(before, normalized.agents[agent].model, normalized.agents[agent].variant)
  }
  let configAfter = configSource
  for (const agent of builtinAgents) {
    configAfter = setBuiltin(configAfter, agent, normalized.agents[agent].model, normalized.agents[agent].variant)
  }
  return { configAfter, agentsAfter }
}

export function applyUpdates(updates, writeFile) {
  const applied = []
  let inFlight = null
  try {
    for (const update of updates) {
      if (update.after === update.before) continue
      inFlight = update
      writeFile(update.file, update.after)
      applied.push(update)
      inFlight = null
    }
  } catch (error) {
    const toRollback = inFlight ? [...applied, inFlight] : applied
    for (const update of toRollback.reverse()) writeFile(update.file, update.before)
    throw error
  }
}
