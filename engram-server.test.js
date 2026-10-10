import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ensureEngramServer } from './engram-server.js'

function response(ok, body = []) {
  return { ok, json: async () => body }
}

test('uses an already-running local HTTP service without spawning', async () => {
  let spawns = 0
  const port = 17437
  assert.equal(await ensureEngramServer({
    port,
    fetchImpl: async () => response(true, []),
    spawnImpl: () => { spawns++ },
  }), port)
  assert.equal(spawns, 0)
})

test('starts the installed executable detached on Windows and waits for readiness', async () => {
  let requests = 0
  let argsSeen
  let optionsSeen
  let unrefed = false
  const child = new EventEmitter()
  child.unref = () => { unrefed = true }
  const port = 17438
  await ensureEngramServer({
    port,
    platform: 'win32',
    existsSync: () => true,
    fetchImpl: async () => ++requests === 1 ? response(false) : response(true, []),
    spawnImpl: (...args) => { [argsSeen, optionsSeen] = [args, args[2]]; return child },
    sleep: async () => {},
  })
  assert.deepEqual(argsSeen[1], ['serve'])
  assert.equal(argsSeen[2].shell, false)
  assert.equal(argsSeen[2].detached, true)
  assert.equal(argsSeen[2].stdio, 'ignore')
  assert.equal(optionsSeen.env.ENGRAM_PORT, String(port))
  assert.equal(unrefed, true)
})

test('rejects malformed ports before making network or process calls', async () => {
  let called = false
  assert.throws(() => ensureEngramServer({
    port: '7437;bad',
    fetchImpl: async () => { called = true },
    spawnImpl: () => { called = true },
  }), /ENGRAM_PORT/)
  assert.equal(called, false)
})

test('does not report readiness for a non-array response and times out usefully', async () => {
  await assert.rejects(ensureEngramServer({
    port: 17439,
    timeoutMs: 2,
    fetchImpl: async () => response(true, {}),
    spawnImpl: () => new EventEmitter(),
    sleep: async () => {},
  }), /Engram no quedó disponible/)
})
