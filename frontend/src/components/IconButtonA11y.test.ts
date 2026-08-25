import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('../**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

describe('icon button accessibility contract', () => {
  it('gives every icon-only control an explicit accessible name', () => {
    const violations: string[] = []

    for (const [path, sourceText] of Object.entries(sources)) {
      if (path.endsWith('.test.tsx')) continue
      for (const openingTag of jsxControlOpeningTags(sourceText)) {
        if (hasIconButtonClass(openingTag.value) && !hasAccessibleName(openingTag.value) && !isManagedDialogClose(openingTag.value)) {
          violations.push(`${path}:${lineAt(sourceText, openingTag.offset)}`)
        }
      }
    }

    expect(violations, `缺少 aria-label/aria-labelledby:\n${violations.join('\n')}`).toEqual([])
  })
})

function jsxControlOpeningTags(source: string) {
  const result: Array<{ value: string; offset: number }> = []
  const starts = /<(?:button|a|Link)\b/g
  let match: RegExpExecArray | null
  while ((match = starts.exec(source))) {
    const end = openingTagEnd(source, match.index)
    if (end < 0) break
    result.push({ value: source.slice(match.index, end + 1), offset: match.index })
    starts.lastIndex = end + 1
  }
  return result
}

function openingTagEnd(source: string, start: number) {
  let braces = 0
  let quote = ''
  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? ''
    if (escaped) {
      escaped = false
      continue
    }
    if (quote) {
      if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') quote = character
    else if (character === '{') braces += 1
    else if (character === '}') braces = Math.max(0, braces - 1)
    else if (character === '>' && braces === 0) return index
  }
  return -1
}

function hasIconButtonClass(openingTag: string) {
  const className = /\bclassName\s*=/.exec(openingTag)
  if (!className) return false
  return /(^|[^a-z-])(icon-button|page-icon-button)([^a-z-]|$)/i.test(openingTag.slice(className.index))
}

function hasAccessibleName(openingTag: string) {
  return /\baria-(?:label|labelledby)\s*=/.test(openingTag)
}

function isManagedDialogClose(openingTag: string) {
  return /\bonClick\s*=\s*{onClose}/.test(openingTag)
}

function lineAt(source: string, offset: number) {
  return source.slice(0, offset).split('\n').length
}
