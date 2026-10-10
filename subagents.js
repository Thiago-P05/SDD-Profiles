export const purposes = {
  explore: 'Investigar el código; no divide el trabajo',
  builder: 'Implementar una tarea delegada',
  judge: 'Revisar el resultado',
}

export function formatSubagentModel(raw) {
  const value = typeof raw === 'string' ? raw : ''
  const hash = value.lastIndexOf('#')
  const model = hash > 0 ? value.slice(0, hash) : (value || 'heredado')
  const variant = hash > 0 ? value.slice(hash + 1) : 'heredado'
  return { model, variant }
}

export function subagentDetailAlert(name, input) {
  const purpose = input?.purpose ?? purposes[name] ?? ''
  const model = input?.model ?? 'heredado'
  const variant = input?.variant ?? 'heredado'
  return {
    title: name,
    message: [
      purpose,
      `Modelo: ${model}`,
      `Esfuerzo: ${variant}`,
      `Invocación: escribí @${name} en el prompt. Este menú solo informa; no lanza el subagente.`,
    ].join('\n'),
  }
}
