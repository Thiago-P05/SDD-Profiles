import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createKeymapSlotRender, isKeymapProviderMissing, KeymapLayer } from './keymap-layer.js'

test('cold slot render does not call keymap.layer until the child mounts', () => {
  let calls = 0
  const keymap = {
    layer() {
      calls += 1
    },
  }
  const factory = () => ({ mode: 'global', commands: [] })
  const render = createKeymapSlotRender(keymap, factory)
  const vnode = render()
  assert.equal(calls, 0)
  assert.equal(vnode.type, KeymapLayer)
  KeymapLayer(vnode.props)
  assert.equal(calls, 1)
})

test('Keymap.Provider missing on mount is not swallowed', () => {
  const keymap = {
    layer() {
      throw new Error('Keymap.Provider is missing')
    },
  }
  assert.equal(isKeymapProviderMissing(new Error('Keymap.Provider is missing')), true)
  assert.throws(() => KeymapLayer({ keymap, factory: () => ({}) }), /Keymap\.Provider/)
})

test('tui.js mounts KeymapLayer via jsx and does not swallow Provider errors', () => {
  const source = fs.readFileSync(new URL('./tui.js', import.meta.url), 'utf8')
  assert.match(source, /jsx\(KeymapLayer/)
  assert.doesNotMatch(source, /message\.includes\(['"]Keymap\.Provider['"]\)/)
  assert.doesNotMatch(source, /bindKeymapLayer/)
})
