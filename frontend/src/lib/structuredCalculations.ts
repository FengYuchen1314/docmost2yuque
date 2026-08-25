export interface CalculatedSheet { rows: string[][] }
export interface CalculatedField { id: string; name: string; type: string; formula?: string }
export interface CalculatedRow { values: Record<string, unknown> }

export function displaySpreadsheetCell(sheet: CalculatedSheet, row: number, column: number, seen = new Set<string>()): string {
  const raw = sheet.rows[row]?.[column] ?? ''
  if (!raw.startsWith('=')) return raw
  const key = `${row}:${column}`
  if (seen.has(key)) return '#CYCLE!'
  seen.add(key)
  try {
    const expression = raw.slice(1)
      .replace(/(SUM|AVERAGE|MIN|MAX|COUNT)\(([A-Z]+\d+):([A-Z]+\d+)\)/gi, (_, fn: string, start: string, end: string) => {
        const a = cellCoordinates(start); const b = cellCoordinates(end)
        if (!a || !b) throw new Error('range')
        const values: number[] = []
        for (let currentRow = Math.min(a.row, b.row); currentRow <= Math.max(a.row, b.row); currentRow += 1) {
          for (let currentColumn = Math.min(a.column, b.column); currentColumn <= Math.max(a.column, b.column); currentColumn += 1) {
            const value = Number(displaySpreadsheetCell(sheet, currentRow, currentColumn, new Set(seen)))
            values.push(Number.isFinite(value) ? value : 0)
          }
        }
        if (fn.toUpperCase() === 'SUM') return String(values.reduce((sum, value) => sum + value, 0))
        if (fn.toUpperCase() === 'AVERAGE') return String(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length))
        if (fn.toUpperCase() === 'MIN') return String(Math.min(...values))
        if (fn.toUpperCase() === 'MAX') return String(Math.max(...values))
        return String(values.length)
      })
      .replace(/[A-Z]+\d+/gi, (reference) => {
        const point = cellCoordinates(reference)
        if (!point) throw new Error('reference')
        const value = Number(displaySpreadsheetCell(sheet, point.row, point.column, new Set(seen)))
        return String(Number.isFinite(value) ? value : 0)
      })
    return String(parseArithmetic(expression))
  } catch {
    return '#ERROR!'
  }
}

export function databaseFieldValue(fields: CalculatedField[], row: CalculatedRow, field: CalculatedField, seen = new Set<string>()): unknown {
  if (field.type !== 'FORMULA' && field.type !== 'ROLLUP') return row.values[field.id]
  if (seen.has(field.id)) return '#CYCLE!'
  seen.add(field.id)
  try {
    const expression = (field.formula || '').replace(/\{([^}]+)\}/g, (_, name: string) => {
      const source = fields.find((item) => item.name === name)
      if (!source) throw new Error('field')
      const value = Number(databaseFieldValue(fields, row, source, new Set(seen)))
      if (!Number.isFinite(value)) throw new Error('value')
      return String(value)
    })
    return parseArithmetic(expression)
  } catch {
    return '#ERROR!'
  }
}

export function formatSpreadsheetValue(value: string, format: string | undefined): string {
  const type = format || 'GENERAL'
  if (type === 'DATE') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value
  }
  const number = Number(value)
  if (!Number.isFinite(number) || value.trim() === '') return value
  if (type === 'NUMBER') return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 10 }).format(number)
  if (type === 'CURRENCY') return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(number)
  if (type === 'PERCENT') return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(number)
  return value
}

function cellCoordinates(reference: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference)
  if (!match) return null
  let column = 0
  for (const character of match[1]!.toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}

function parseArithmetic(source: string): number {
  const compact = source.replace(/\s+/g, '')
  const tokens = compact.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? []
  if (!tokens.length || tokens.join('') !== compact) throw new Error('tokens')
  let index = 0
  const primary = (): number => {
    const token = tokens[index++]
    if (token === '(') { const value = add(); if (tokens[index++] !== ')') throw new Error('parenthesis'); return value }
    if (token === '-') return -primary()
    const value = Number(token)
    if (!Number.isFinite(value)) throw new Error('number')
    return value
  }
  const multiply = (): number => {
    let value = primary()
    while (tokens[index] === '*' || tokens[index] === '/') { const operator = tokens[index++]; const right = primary(); value = operator === '*' ? value * right : value / right }
    return value
  }
  const add = (): number => {
    let value = multiply()
    while (tokens[index] === '+' || tokens[index] === '-') { const operator = tokens[index++]; const right = multiply(); value = operator === '+' ? value + right : value - right }
    return value
  }
  const value = add()
  if (index !== tokens.length || !Number.isFinite(value)) throw new Error('expression')
  return value
}
