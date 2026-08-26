import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import type { Page } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import PageManagementDialog from './PageManagementDialog.vue'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('PageManagementDialog compact shells', () => {
  it('uses a 680px share dialog', () => {
    wrapper = mountDialog('SHARE')
    const dialog = wrapper.findComponent({ name: 'VDialog' })
    expect(dialog.props('maxWidth')).toBe(680)
    expect(wrapper.text()).toContain('分享')
  })

  it('uses a 600px right drawer for settings and exposes every management tab', () => {
    wrapper = mountDialog('PROPERTIES')
    const drawer = wrapper.findComponent({ name: 'VNavigationDrawer' })
    expect(drawer.props('width')).toBe('600')
    expect(wrapper.find('.settings-tabs').text()).toContain('设置')
    expect(wrapper.find('.settings-tabs').text()).toContain('权限')
    expect(wrapper.find('.settings-tabs').text()).toContain('附件')
    expect(wrapper.find('.settings-tabs').text()).toContain('版本历史')
  })
})

function mountDialog(initialTab: 'SHARE' | 'PROPERTIES') {
  return mount(PageManagementDialog, {
    attachTo: document.body,
    props: { modelValue: true, page: pageFixture(), initialTab },
    global: {
      plugins: [vuetify],
      stubs: {
        VDialog: defineComponent({
          name: 'VDialog',
          props: { maxWidth: [Number, String], modelValue: Boolean },
          emits: ['update:modelValue'],
          template: '<div class="dialog-stub"><slot /></div>',
        }),
        VNavigationDrawer: defineComponent({
          name: 'VNavigationDrawer',
          props: { width: [Number, String], modelValue: Boolean },
          emits: ['update:modelValue'],
          template: '<aside class="drawer-stub"><slot /></aside>',
        }),
        AttachmentsPanel: { template: '<div>attachments</div>' },
        HistoryPanel: { template: '<div>history</div>' },
        PermissionsPanel: { template: '<div>permissions</div>' },
        PropertiesPanel: { template: '<div>properties</div>' },
        PublicationPanel: { template: '<div>publication</div>' },
        SharesPanel: { template: '<div>shares</div>' },
      },
    },
  })
}

function pageFixture(): Page {
  return {
    id: 'page', workspaceId: 'workspace', knowledgeBaseId: 'kb', title: '示例文档', icon: null, cover: null,
    contentType: 'DOCUMENT', path: 'example', publishMode: 'MANUAL', publishedRevisionId: null, publishedAt: null,
    visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1, draftRevision: 3,
    content: { type: 'doc', content: [] }, plainText: '', createdBy: 'user', updatedBy: 'user',
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', deletedAt: null,
  }
}
