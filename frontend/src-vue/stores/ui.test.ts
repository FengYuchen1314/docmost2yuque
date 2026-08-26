import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from './ui'

describe('UI creation intent', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps the entry point resource type and destination together', () => {
    const ui = useUiStore()

    ui.openCreate({
      kind: 'KNOWLEDGE_BASE',
      workspaceId: 'workspace-1',
      source: 'SIDEBAR_KB',
    })

    expect(ui.createOpen).toBe(true)
    expect(ui.createRequest).toEqual({ kind: 'KNOWLEDGE_BASE', workspaceId: 'workspace-1', source: 'SIDEBAR_KB' })
  })

  it('replaces stale context when another create entry point opens', () => {
    const ui = useUiStore()
    ui.openCreate({ kind: 'KNOWLEDGE_BASE', workspaceId: 'workspace-1' })
    ui.closeCreate()
    ui.openCreate({ knowledgeBaseId: 'kb-2', source: 'KNOWLEDGE_BASE' })

    expect(ui.createRequest).toEqual({ knowledgeBaseId: 'kb-2', source: 'KNOWLEDGE_BASE' })
  })
})
