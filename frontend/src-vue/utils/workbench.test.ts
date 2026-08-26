import { describe, expect, it } from 'vitest'
import type { WorkbenchItem } from '../../src/types'
import {
  contentTypePresentation,
  deduplicateWorkbenchItems,
  normalizeWorkbenchReason,
  quickNoteDocument,
  relativeTime,
} from './workbench'

const item = (id: string): WorkbenchItem => ({
  resourceId: id,
  resourceType: 'PAGE',
  workspaceId: 'workspace',
  knowledgeBaseId: 'kb',
  knowledgeBaseName: '知识库',
  title: id,
  path: id,
  contentType: 'DOCUMENT',
  publicationStatus: 'UNPUBLISHED',
  reason: 'EDITED',
  activityAt: '2026-08-26T00:00:00Z',
  favorite: false,
  collaborators: [],
})

describe('workbench presentation and paging helpers', () => {
  it('normalizes URL filters and removes duplicate resources across pages', () => {
    expect(normalizeWorkbenchReason('FAVORITE')).toBe('FAVORITE')
    expect(normalizeWorkbenchReason('UNKNOWN')).toBe('EDITED')
    expect(deduplicateWorkbenchItems([item('a'), item('b'), { ...item('a'), title: '更新' }])).toEqual([
      { ...item('a'), title: '更新' },
      item('b'),
    ])
  })

  it('uses content-specific labels and stable relative times', () => {
    expect(contentTypePresentation('WHITEBOARD')).toMatchObject({ label: '白板', icon: 'mdi-drawing-box' })
    const now = new Date('2026-08-26T10:00:00Z').getTime()
    expect(relativeTime('2026-08-26T09:55:00Z', now)).toBe('5 分钟前')
    expect(relativeTime('2026-08-24T10:00:00Z', now)).toBe('2 天前')
  })

  it('turns quick-note markdown affordances into structured content', () => {
    expect(quickNoteDocument('**重点**\n- [x] 已完成\n[语雀](https://www.yuque.com)')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '重点', marks: [{ type: 'bold' }] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成' }] }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: '语雀', marks: [{ type: 'link', attrs: { href: 'https://www.yuque.com', target: '_blank', rel: 'noopener noreferrer nofollow' } }] }] },
      ],
    })
  })
})
