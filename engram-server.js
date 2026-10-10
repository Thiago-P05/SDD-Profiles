import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const installedEngram = path.join(os.homedir(), 'go', 'bin', 'engram.exe')
const startupByPort = new Map()

function resolvePort(value) {
  const raw = value == null || value === '' ? '7437' : String(value)
  if (!/^\d+$/.test(raw)) throw new Error('ENGRAM_PORT debe ser un puerto válido (1–65535)')
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ENGRAM_PORT debe ser un puerto válido (1–65535)')
  }
  return port
}

function recentUrl(port) {
  return `http://127.0.0.1:${port}/observations/recent?limit=1`
}

async function isReady(port, fetchImpl) {
  try {
    const response = await fetchImpl(recentUrl(port), { signal: AbortSignal.timeout(700) })
    if (!response.ok) return false
    return Array.isArray(await response.json())
  } catch {
    return false
  }
}

async function waitForReady(port, fetchImpl, child, timeoutMs, sleep) {
  const deadline = Date.now() + timeoutMs
  let spawnFailed = false
  child?.once?.('error', () => { spawnFailed = true })
  while (Date.now() < deadline) {
    if (await isReady(port, fetchImpl)) return
    if (spawnFailed) {
      // Another TUI may have won the startup race; give its listener one probe.
      if (await isReady(port, fetchImpl)) return
      throw new Error('No se pudo iniciar Engram. Verificá que engram.exe esté instalado y disponible en PATH.')
    }
    await sleep(Math.min(150, Math.max(1, deadline - Date.now())))
  }
  throw new Error(`Engram no quedó disponible en 127.0.0.1:${port} dentro del tiempo esperado. Revisá la instalación de engram.`)
}

async function start({
  port,
  fetchImpl,
  spawnImpl,
  existsSync,
  platform,
  timeoutMs,
  sleep,
}) {
  if (await isReady(port, fetchImpl)) return port

  const executable = existsSync(installedEngram) ? installedEngram : 'engram'
  let child
  try {
    child = spawnImpl(executable, ['serve'], {
      shell: false,
      windowsHide: true,
      detached: platform === 'win32',
      stdio: 'ignore',
      env: { ...process.env, ENGRAM_PORT: String(port) },
    })
    child?.unref?.()
  } catch {
    throw new Error('No se pudo iniciar Engram. Verificá que engram.exe esté instalado y disponible en PATH.')
  }
  await waitForReady(port, fetchImpl, child, timeoutMs, sleep)
  return port
}

export function ensureEngramServer({
  port: portValue = process.env.ENGRAM_PORT,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  existsSync = fs.existsSync,
  platform = process.platform,
  timeoutMs = 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const port = resolvePort(portValue)
  if (typeof fetchImpl !== 'function') throw new Error('No está disponible fetch para consultar Engram')
  if (startupByPort.has(port)) return startupByPort.get(port)
  const pending = start({ port, fetchImpl, spawnImpl, existsSync, platform, timeoutMs, sleep })
    .finally(() => startupByPort.delete(port))
  startupByPort.set(port, pending)
  return pending
}
