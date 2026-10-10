import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jsx } from '@opentui/solid/jsx-runtime'
import { Plugin } from '@opencode/plugin/tui'
import { KeymapLayer } from './keymap-layer.js'
import { ensureEngramServer } from './engram-server.js'
import {
  agentNames as names,
  applyUpdates,
  efforts,
  markdownAgents,
  normalizeProfile,
  planActivation,
} from './sdd.js'
import { formatSubagentModel, purposes, subagentDetailAlert } from './subagents.js'

const root = path.join(os.homedir(), '.config', 'opencode')
const profileDir = path.join(root, 'full-chatgipiti-profiles')
const configFile = path.join(root, 'opencode.jsonc')
const agentDir = path.join(root, 'agent')

function fail(message) {
  throw new Error(message)
}

function profileFile(name) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) fail('Nombre de perfil inválido. Usá letras, números, guiones o guion bajo.')
  return path.join(profileDir, `${name}.json`)
}

function load(name) {
  const file = profileFile(name)
  if (!fs.existsSync(file)) fail(`No existe el perfil ${name}`)
  let profile
  try {
    profile = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    fail(`No se pudo leer el perfil ${name}`)
  }
  if (!profile || typeof profile !== 'object' || !profile.agents) fail(`Perfil inválido: ${name}`)
  return normalizeProfile(profile)
}

function save(name, profile) {
  fs.mkdirSync(profileDir, { recursive: true })
  fs.writeFileSync(profileFile(name), JSON.stringify(normalizeProfile(profile), null, 2) + '\n')
}

function selected(result) {
  if (result == null || result === false) return undefined
  return typeof result === 'object' && result !== null && 'value' in result ? result.value : result
}

async function pick(ctx, title, options) {
  if (!options.length) fail('No hay opciones disponibles')
  return selected(await ctx.ui.dialog.select({ title, options }))
}

function toastError(ctx, error) {
  ctx.ui.toast.show({
    title: 'FULL CHATGIPITI',
    message: error instanceof Error ? error.message : String(error),
    variant: 'error',
  })
}

async function catalog(ctx) {
  try {
    const location = ctx.location ?? ctx.data.location.default()
    await Promise.all([
      ctx.data.location.agent.sync(location),
      ctx.data.location.model.sync(location),
    ])
    return {
      agents: ctx.data.location.agent.list(location) ?? [],
      models: ctx.data.location.model.list(location) ?? [],
    }
  } catch (error) {
    fail(`No se pudo leer el catálogo de agentes/modelos: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function agentId(entry) {
  return entry?.id ?? entry?.name
}

function modelString(agent) {
  const model = agent?.model
  if (typeof model === 'string') return model
  if (model?.providerID && (model.model || model.id || model.modelID)) {
    const id = model.model ?? model.id ?? model.modelID
    return `${model.providerID}/${id}${model.variant ? `#${model.variant}` : ''}`
  }
  return ''
}

function currentSettings(agents) {
  const settings = { agents: {} }
  for (const name of names) {
    const agent = agents.find((entry) => agentId(entry) === name)
    const raw = modelString(agent)
    const hash = raw.lastIndexOf('#')
    const model = hash > 0 ? raw.slice(0, hash) : raw
    const variant = hash > 0 ? raw.slice(hash + 1) : 'medium'
    if (!model) fail(`No se encontró el modelo actual de ${name} en el catálogo`)
    settings.agents[name] = { model, variant }
  }
  return settings
}

function activate(_name, profile) {
  const agentSources = Object.fromEntries(markdownAgents.map((agent) => {
    const file = path.join(agentDir, `${agent}.md`)
    return [agent, fs.readFileSync(file, 'utf8')]
  }))
  const configSource = fs.readFileSync(configFile, 'utf8')
  const planned = planActivation(profile, { configSource, agentSources })
  applyUpdates([
    ...markdownAgents.map((agent) => ({
      file: path.join(agentDir, `${agent}.md`),
      before: agentSources[agent],
      after: planned.agentsAfter[agent],
    })),
    { file: configFile, before: configSource, after: planned.configAfter },
  ], (file, content) => fs.writeFileSync(file, content))
}

async function memories(ctx) {
  const cwd = ctx.location?.directory ?? ctx.data.location.default()?.directory ?? process.cwd()
  let project = path.basename(cwd).toLowerCase()
  const local = path.join(cwd, '.engram', 'config.json')
  if (fs.existsSync(local)) {
    try {
      const value = JSON.parse(fs.readFileSync(local, 'utf8')).project_name
      if (typeof value === 'string' && value.trim()) project = value.trim()
    } catch { /* usar el nombre del directorio */ }
  }
  let observations
  const port = Number(process.env.ENGRAM_PORT ?? 7437)
  try {
    await ensureEngramServer({ port })
    const response = await fetch(`http://127.0.0.1:${port}/observations/recent?project=${encodeURIComponent(project)}&limit=50`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) fail(`Engram respondió ${response.status}`)
    observations = await response.json()
  } catch (error) {
    fail(`No se pudieron consultar las memorias: ${error instanceof Error ? error.message : 'error de conexión con Engram'}`)
  }
  if (!Array.isArray(observations)) fail('Respuesta inesperada de Engram')
  while (true) {
    const choice = await pick(ctx, `Memorias: ${project}`, observations.length
      ? observations.map((memory) => ({
          title: `[${memory.id}] ${memory.title ?? memory.topic_key ?? 'Sin título'}`.slice(0, 60),
          value: String(memory.id),
          description: memory.type ?? 'manual',
        }))
      : [{ title: 'Sin memorias', value: 'empty', disabled: true }])
    if (!choice || choice === 'empty') return
    const memory = observations.find((item) => String(item.id) === choice)
    if (!memory) return
    await ctx.ui.dialog.alert({ title: memory.title ?? 'Memoria', message: String(memory.content ?? 'Sin contenido') })
  }
}

async function profiles(ctx) {
  while (true) {
    const available = fs.existsSync(profileDir)
      ? fs.readdirSync(profileDir).filter((name) => /^[a-z0-9][a-z0-9_-]*\.json$/i.test(name)).map((name) => name.slice(0, -5))
      : []
    const choice = await pick(ctx, 'FULL CHATGIPITI · Perfiles SDD', [
      { title: 'Crear perfil desde configuración actual', value: 'create' },
      ...available.map((name) => ({ title: name, value: name, description: 'Editar o activar' })),
      { title: 'Memorias Engram', value: 'engram' },
    ])
    if (!choice) return
    try {
      if (choice === 'engram') {
        await memories(ctx)
        continue
      }
      let name = choice
      if (choice === 'create') {
        const raw = await ctx.ui.dialog.prompt({ title: 'Nombre del nuevo perfil', placeholder: 'mi-perfil' })
        if (!raw) continue
        name = String(raw).trim()
        if (!name) continue
        if (fs.existsSync(profileFile(name))) fail('El perfil ya existe')
        save(name, currentSettings((await catalog(ctx)).agents))
      }
      while (true) {
        const profile = load(name)
        const action = await pick(ctx, `Perfil · ${name}`, [
          ...names.map((agent) => ({
            title: agent,
            value: agent,
            description: `${profile.agents[agent]?.model ?? 'Sin modelo'} · ${profile.agents[agent]?.variant ?? ''}`,
          })),
          { title: 'Activar perfil', value: 'activate' },
        ])
        if (!action) break
        if (action === 'activate') {
          activate(name, profile)
          ctx.ui.toast.show({
            title: 'FULL CHATGIPITI',
            message: `Perfil ${name} aplicado. Reiniciá OpenCode.`,
            variant: 'success',
          })
          break
        }
        const setting = profile.agents[action]
        if (!setting) fail(`El perfil ${name} no define ${action}`)
        const field = await pick(ctx, `${name} · ${action}`, [
          { title: `Cambiar modelo: ${setting.model}`, value: 'model' },
          { title: `Cambiar esfuerzo: ${setting.variant}`, value: 'variant' },
        ])
        if (!field) continue
        if (field === 'variant') {
          const effort = await pick(ctx, `Esfuerzo · ${action}`, efforts.map((value) => ({ title: value, value })))
          if (!effort) continue
          setting.variant = effort
          save(name, profile)
        } else if (field === 'model') {
          const { models } = await catalog(ctx)
          const choices = models.map((model) => {
            const id = model.id ?? model.modelID ?? model.model
            const title = model.name ?? id
            const provider = model.providerID
            if (!title || !provider || !id) return null
            return { title: `${provider}/${id}`, value: `${provider}/${id}`, description: title === id ? undefined : title }
          }).filter(Boolean)
          if (!choices.length) fail('El catálogo de modelos está vacío o no se pudo resolver')
          const model = await pick(ctx, `Modelo · ${action}`, choices)
          if (!model) continue
          setting.model = model
          save(name, profile)
        }
      }
    } catch (error) {
      toastError(ctx, error)
    }
  }
}

async function subagents(ctx) {
  let agents = []
  try {
    agents = (await catalog(ctx)).agents
  } catch (error) {
    toastError(ctx, error)
  }
  while (true) {
    const choice = await pick(ctx, 'FULL CHATGIPITI · Subagentes', Object.entries(purposes).map(([name, purpose]) => {
      const agent = agents.find((entry) => agentId(entry) === name)
      return { title: name, value: name, description: `${purpose} · ${modelString(agent) || 'modelo heredado'}` }
    }))
    if (!choice) return
    const agent = agents.find((entry) => agentId(entry) === choice)
    const { model, variant } = formatSubagentModel(modelString(agent))
    await ctx.ui.dialog.alert(subagentDetailAlert(choice, {
      purpose: purposes[choice],
      model,
      variant,
    }))
  }
}

function commands(ctx) {
  return {
    mode: 'global',
    commands: [
      {
        id: 'full-chatgipiti.sdd',
        title: 'FULL CHATGIPITI · Perfiles SDD',
        description: 'Crear, editar y activar modelos de tus agentes',
        group: 'FULL CHATGIPITI',
        palette: true,
        slash: { name: 'sdd' },
        run: () => profiles(ctx).catch((error) => toastError(ctx, error)),
      },
      {
        id: 'full-chatgipiti.subagents',
        title: 'FULL CHATGIPITI · Subagentes',
        description: 'Ver subagentes, modelos e invocación',
        group: 'FULL CHATGIPITI',
        palette: true,
        slash: { name: 'subagents' },
        run: () => subagents(ctx).catch((error) => toastError(ctx, error)),
      },
    ],
  }
}

export default Plugin.define({
  id: 'full-chatgipiti.cli',
  setup(ctx) {
    // keymap.layer() is owned by the calling Solid component. The slot render
    // only returns a child; layer() runs when that child mounts under Keymap.Provider.
    return ctx.ui.slot({
      append: 'app',
      render: () => jsx(KeymapLayer, { keymap: ctx.keymap, factory: () => commands(ctx) }),
    })
  },
})
