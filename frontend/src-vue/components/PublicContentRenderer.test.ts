import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createContentCardNode, encodeContentCardToken } from './content-cards/contentCardModel'

vi.mock('./content-cards/ContentCardRenderer.vue', () => ({
  default: defineComponent({
    name: 'ContentCardRenderer',
    props: {
      card: { type: null, required: true },
      interactive: { type: Boolean, default: true },
      allowIframes: { type: Boolean, default: true },
    },
    template: '<div data-testid="public-card" :data-interactive="String(interactive)" :data-iframes="String(allowIframes)" />',
  }),
}))

import PublicContentRenderer from './PublicContentRenderer.vue'

function mountDocument(plainText: string, content: unknown = {}) {
  return mount(PublicContentRenderer, { props: { contentType: 'DOCUMENT', content, plainText } })
}

describe('PublicContentRenderer content cards', () => {
  it('routes token, JSON and damaged card lines through the locked-down card renderer', () => {
    const token = encodeContentCardToken(createContentCardNode('status', { value: 'DONE', label: '完成' }))
    const json = JSON.stringify(createContentCardNode('callout', { tone: 'INFO', text: '公告' }))
    const wrapper = mountDocument([token, json, '{{card:damaged-token', '{"cardId":"future-card", broken'].join('\n'))
    const cards = wrapper.findAll('[data-testid="public-card"]')
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      expect(card.attributes('data-interactive')).toBe('false')
      expect(card.attributes('data-iframes')).toBe('false')
    }
  })

  it('preserves canonical card order from structured document JSON', () => {
    const card = createContentCardNode('code', { language: 'ts', code: 'const safe = true' })
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '开始' }] },
        card,
        { type: 'paragraph', content: [{ type: 'text', text: '结束' }] },
      ],
    }
    const wrapper = mountDocument('不应覆盖结构化顺序', content)
    expect(wrapper.get('h2').text()).toBe('开始')
    expect(wrapper.find('[data-testid="public-card"]').exists()).toBe(true)
    expect(wrapper.get('.reader-paragraph').text()).toBe('结束')
  })

  it('renders normal Markdown-like lines as escaped semantic elements', () => {
    const wrapper = mountDocument([
      '# 标题',
      '> 引用',
      '- 列表项',
      '- [x] 已完成',
      '1. 第一步',
      '```ts',
      '<img src=x onerror=alert(1)>',
      '```',
      '<script>alert(1)</script>',
    ].join('\n'))
    expect(wrapper.get('h1').text()).toBe('标题')
    expect(wrapper.get('blockquote').text()).toBe('引用')
    expect(wrapper.get('pre code').text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('.public-task--done').exists()).toBe(true)
  })
})
