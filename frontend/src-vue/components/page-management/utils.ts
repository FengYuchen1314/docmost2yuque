import type { DocumentSettings, Page } from '../../../src/types'
import type { Capability } from './types'

export function normalizeDocumentSettings(value: Page['documentSettings']): DocumentSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    pageWidth: record.pageWidth === 'WIDE' ? 'WIDE' : 'STANDARD',
    fontFamily: record.fontFamily === 'SERIF' ? 'SERIF' : 'SANS',
    fontSize: record.fontSize === 'SMALL' || record.fontSize === 'LARGE' ? record.fontSize : 'MEDIUM',
    paragraphSpacing: record.paragraphSpacing === 'COMPACT' || record.paragraphSpacing === 'RELAXED' ? record.paragraphSpacing : 'NORMAL',
    showOutline: record.showOutline !== false,
  }
}

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 180)
}

export function safeHttpsUrl(value: string) {
  if (!value.trim()) return ''
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function toIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function toLocalInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function contentTypeLabel(value: Page['contentType']) {
  return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' })[value]
}

export function revisionKindLabel(value: string) {
  return ({ AUTO: '自动保存', MANUAL: '手工版本', MIGRATION: '迁移版本' } as Record<string, string>)[value] ?? value
}

export function capabilityLabel(value: Capability) {
  return ({ READ: '读取', EDIT: '编辑', MANAGE: '管理资源', COMMENT: '评论', PUBLISH: '发布', SHARE: '分享', COPY: '复制', DOWNLOAD: '下载', EXPORT: '导出', DELETE: '删除', RESTORE: '恢复', MANAGE_PERMISSIONS: '管理权限', VIEW_ANALYTICS: '查看统计' } as Record<Capability, string>)[value]
}

export function roleLabel(value: string | null) {
  if (!value) return '自定义能力'
  return ({ READER: '只读', VIEWER: '只读', EDITOR: '可编辑', MEMBER: '可编辑', MANAGER: '管理者', ADMIN: '管理者', OWNER: '所有者' } as Record<string, string>)[value] ?? value
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  try {
    if (!document.execCommand?.('copy')) throw new Error('copy unavailable')
  } finally {
    textarea.remove()
  }
}

export function historyCopyPath(path: string, revisionNo: number) {
  const suffix = `-v${revisionNo}-copy`
  const base = path.slice(0, Math.max(1, 180 - suffix.length)).replace(/-+$/, '') || 'page'
  return `${base}${suffix}`
}
