import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatSubagentModel, purposes, subagentDetailAlert } from './subagents.js'

test('subagent menu investigates with explore and does not offer planner', () => {
  assert.deepEqual(Object.keys(purposes), ['explore', 'builder', 'judge'])
  assert.equal(purposes.explore, 'Investigar el código; no divide el trabajo')
  assert.equal(purposes.planner, undefined)
})

test('subagent detail is informational and keeps purpose, model, effort', () => {
  const detail = subagentDetailAlert('builder', {
    purpose: purposes.builder,
    model: 'xai/grok-4',
    variant: 'high',
  })
  assert.equal(detail.title, 'builder')
  assert.match(detail.message, /Implementar una tarea delegada/)
  assert.match(detail.message, /Modelo: xai\/grok-4/)
  assert.match(detail.message, /Esfuerzo: high/)
  assert.match(detail.message, /@builder/)
  assert.match(detail.message, /solo informa/)
  assert.doesNotMatch(detail.message, /^Invocar: @/m)
  assert.equal(detail.message.includes('no lanza el subagente'), true)
})

test('formatSubagentModel splits variant and falls back to heredado', () => {
  assert.deepEqual(formatSubagentModel('xai/grok-4#medium'), { model: 'xai/grok-4', variant: 'medium' })
  assert.deepEqual(formatSubagentModel(''), { model: 'heredado', variant: 'heredado' })
  assert.deepEqual(formatSubagentModel('xai/grok-4'), { model: 'xai/grok-4', variant: 'heredado' })
})

test('/subagents detail uses dialog.alert instead of a fake Invocar action', () => {
  const source = fs.readFileSync(new URL('./tui.js', import.meta.url), 'utf8')
  assert.match(source, /dialog\.alert\(subagentDetailAlert/)
  assert.doesNotMatch(source, /Invocar: @/)
  assert.doesNotMatch(source, /value: 'mention'/)
})
