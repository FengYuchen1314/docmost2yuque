import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { vuetify } from '../../plugins/vuetify'
import StructuredEditor from './StructuredEditor.vue'

describe('StructuredEditor', () => {
  it('normalizes and opens the legacy empty whiteboard without a blank-screen error', async () => {
    const wrapper = mount(StructuredEditor, { props: { type: 'WHITEBOARD', modelValue: JSON.stringify({ type: 'whiteboard', content: [] }) }, global: { plugins: [vuetify] }, attachTo: document.body })
    expect(wrapper.text()).toContain('无限白板')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    wrapper.unmount()
  })

  it('creates a usable workbook when persisted content is empty', () => {
    const wrapper = mount(StructuredEditor, { props: { type: 'SPREADSHEET', modelValue: JSON.stringify({ type: 'spreadsheet', content: [] }) }, global: { plugins: [vuetify] } })
    expect(wrapper.find('input[aria-label="A1"]').exists()).toBe(true)
  })
})
