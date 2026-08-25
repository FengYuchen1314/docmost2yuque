import { describe, expect, it } from 'vitest'
import type { Page } from '../types'
import { mergePendingPageUpdate, optimisticPage, toPendingPageUpdate } from './offline'

const page: Page = {
  id: 'page-1', workspaceId: 'workspace-1', knowledgeBaseId: 'kb-1', title: '旧标题', icon: null, cover: null,
  contentType: 'DOCUMENT', path: 'page-1', publishMode: 'MANUAL', publishedRevisionId: null,
  publishedAt: null, visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1, draftRevision: 7,
  content: { type: 'doc' }, plainText: '旧正文', createdBy: 'user-1', updatedBy: 'user-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null,
}

describe('offline page queue', () => {
  it('coalesces drafts but keeps the server revision of the first offline edit', () => {
    const first = toPendingPageUpdate('user-1', page, { title: '一', body: '正文一' }, 10)
    const later = toPendingPageUpdate('user-1', { ...page, draftRevision: 8 }, { title: '二', body: '正文二' }, 20)
    expect(mergePendingPageUpdate(first, later)).toMatchObject({ expectedRevision: 7, title: '二', plainText: '正文二', queuedAt: 20 })
  })

  it('creates a local optimistic page without inventing a server revision', () => {
    const update = toPendingPageUpdate('user-1', page, { title: '离线标题', body: '离线正文' }, 30)
    expect(optimisticPage(page, update)).toMatchObject({ title: '离线标题', plainText: '离线正文', draftRevision: 7 })
  })
})
