import { describe, expect, it } from 'vitest'
import {
  contentTypeLabel,
  displayOptions,
  fieldTypeLabel,
  ownerTypeLabel,
  publicationStatusLabel,
  publishModeLabel,
  resourceTypeLabel,
  roleLabel,
  themeLabel,
  visibilityLabel,
} from './displayLabels'

describe('display labels', () => {
  it('translates persisted API enums without changing their values', () => {
    expect(displayOptions(['PRIVATE', 'PUBLIC'] as const, visibilityLabel)).toEqual([
      { title: '私有', value: 'PRIVATE' },
      { title: '公开', value: 'PUBLIC' },
    ])
    expect(displayOptions(['MANUAL', 'AUTO'] as const, publishModeLabel)).toEqual([
      { title: '手动发布', value: 'MANUAL' },
      { title: '自动发布', value: 'AUTO' },
    ])
  })

  it('covers the user-facing resource, ownership, role and status enums', () => {
    expect(ownerTypeLabel('PERSONAL')).toBe('个人')
    expect(roleLabel('EXTERNAL')).toBe('外部成员')
    expect(contentTypeLabel('SPREADSHEET')).toBe('电子表格')
    expect(publicationStatusLabel('CHANGED')).toBe('有未发布更新')
    expect(themeLabel('MAGAZINE')).toBe('杂志')
    expect(fieldTypeLabel('ROLLUP')).toBe('汇总')
    expect(resourceTypeLabel('KNOWLEDGE_BASE')).toBe('知识库')
  })

  it('does not leak an unknown backend token into the interface', () => {
    expect(visibilityLabel('FUTURE_VISIBILITY')).toBe('未知')
    expect(roleLabel(null)).toBe('未知')
  })
})
