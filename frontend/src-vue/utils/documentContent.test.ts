import { describe, expect, it } from 'vitest'
import { createContentCardNode } from '../components/content-cards/contentCardModel'
import { documentToMarkdown, isEditableDocument, isPlainTextDocument, markdownToDocument } from './documentContent'

describe('document content compatibility adapter', () => {
  it('round-trips supported structure and canonical content cards through the editor source', () => {
    const card = createContentCardNode('callout', { tone: 'info', title: '提示', text: '卡片正文' }, {
      instanceId: '11111111-1111-4111-8111-111111111111',
      version: 2,
    })
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '加粗', marks: [{ type: 'bold' }] }, { type: 'text', text: '正文' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', text: '条目' }] }] },
        card,
      ],
    }

    const markdown = documentToMarkdown(content)
    expect(markdown).toContain('# 标题')
    expect(markdown).toContain('**加粗**正文')
    expect(markdown).toContain('- 条目')
    expect(markdown).toContain('{{card:callout|id=11111111-1111-4111-8111-111111111111|v=2|data=')

    const restored = markdownToDocument(markdown) as { content: Array<{ type: string; attrs?: { cardId?: string; instanceId?: string } }> }
    expect(restored.content.map((node) => node.type)).toEqual(['heading', 'paragraph', 'bulletList', 'contentCard'])
    expect(restored.content[3]?.attrs).toMatchObject({ cardId: 'callout', instanceId: '11111111-1111-4111-8111-111111111111' })
  })

  it('only enables plain-text collaboration for a single unmarked paragraph', () => {
    expect(isPlainTextDocument({ type: 'doc', content: [{ type: 'paragraph', text: '正文' }] })).toBe(true)
    expect(isPlainTextDocument({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, text: '标题' }] })).toBe(false)
    expect(isPlainTextDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '加粗', marks: [{ type: 'bold' }] }] }] })).toBe(false)
  })

  it('protects unsupported nodes instead of silently flattening them', () => {
    expect(isEditableDocument({ type: 'doc', content: [{ type: 'paragraph', text: '正文' }] })).toBe(true)
    expect(isEditableDocument({ type: 'doc', content: [{ type: 'table', content: [] }] })).toBe(false)
  })

  it('protects supported nodes and marks when their attributes would be lost', () => {
    expect(isEditableDocument({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { alignment: 'center' }, text: '居中内容' }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: '/guide', target: '_blank' } }] }],
      }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{ type: 'paragraph', text: '正文', sourceId: 'must-not-be-dropped' }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文', marks: [{ type: 'bold', metadata: true }] }] }],
    })).toBe(false)
  })

  it('protects supported node names when their nesting cannot round-trip', () => {
    expect(isEditableDocument({
      type: 'doc',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [
            { type: 'paragraph', text: '第一段' },
            { type: 'paragraph', text: '第二段' },
          ],
        }],
      }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{ type: 'paragraph', text: '正文', marks: [{ type: 'bold' }] }],
    })).toBe(false)
  })

  it('protects shapes that the text adapter cannot round-trip byte-for-byte', () => {
    expect(isEditableDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }],
      }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '叠加格式', marks: [{ type: 'bold' }, { type: 'italic' }] }],
      }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '段内' },
          createContentCardNode('callout', { text: '卡片' }),
        ],
      }],
    })).toBe(false)
    expect(isEditableDocument({
      type: 'doc',
      content: [{ type: 'paragraph', text: '**应保持为字面文本**' }],
    })).toBe(false)
  })

  it('keeps backend and imported empty-document shapes editable', () => {
    expect(isEditableDocument({ type: 'doc', content: [] })).toBe(true)
    expect(isEditableDocument({ type: 'doc', content: [{ type: 'paragraph', content: [] }] })).toBe(true)
    expect(isEditableDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', text: '第一段' },
        { type: 'paragraph', content: [] },
        { type: 'paragraph', text: '第三段' },
      ],
    })).toBe(true)
  })
})
