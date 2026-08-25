export interface DisplayOption<T extends string = string> {
  title: string
  value: T
}

const VISIBILITY_LABELS: Record<string, string> = {
  PRIVATE: '私有',
  WORKSPACE: '空间内可见',
  PUBLIC: '公开',
  INHERIT: '继承上级设置',
}

const PUBLISH_MODE_LABELS: Record<string, string> = {
  MANUAL: '手动发布',
  AUTO: '自动发布',
  INHERIT: '继承知识库设置',
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  MANAGER: '管理员',
  MEMBER: '成员',
  EXTERNAL: '外部成员',
  EDITOR: '可编辑',
  READER: '可阅读',
}

const OWNER_TYPE_LABELS: Record<string, string> = {
  PERSONAL: '个人',
  TEAM: '团队',
  WORKSPACE: '空间',
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  DOCUMENT: '文档',
  WHITEBOARD: '白板',
  SPREADSHEET: '电子表格',
  DATABASE: '数据表',
}

const PUBLICATION_STATUS_LABELS: Record<string, string> = {
  UNPUBLISHED: '未发布',
  PUBLISHED: '已发布',
  CHANGED: '有未发布更新',
}

const THEME_LABELS: Record<string, string> = {
  PAPER: '纸张',
  MINIMAL: '极简',
  MAGAZINE: '杂志',
  DARK: '深色',
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: '文本',
  NUMBER: '数字',
  SELECT: '单选',
  MULTI_SELECT: '多选',
  DATE: '日期',
  PERSON: '成员',
  CHECKBOX: '复选框',
  URL: '链接',
  EMAIL: '邮箱',
  FILE: '附件',
  FORMULA: '公式',
  RELATION: '关联',
  ROLLUP: '汇总',
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  WORKSPACE: '空间',
  TEAM: '团队',
  KNOWLEDGE_BASE: '知识库',
  PAGE: '文稿',
  QUICK_NOTE: '小记',
  TEMPLATE: '模板',
  ATTACHMENT: '附件',
  USER: '用户',
  PUBLICATION: '发布版本',
}

function displayLabel(labels: Record<string, string>, value: unknown): string {
  if (typeof value !== 'string' || !value) return '未知'
  return labels[value.toUpperCase()] ?? '未知'
}

export const visibilityLabel = (value: unknown) => displayLabel(VISIBILITY_LABELS, value)
export const publishModeLabel = (value: unknown) => displayLabel(PUBLISH_MODE_LABELS, value)
export const roleLabel = (value: unknown) => displayLabel(ROLE_LABELS, value)
export const ownerTypeLabel = (value: unknown) => displayLabel(OWNER_TYPE_LABELS, value)
export const contentTypeLabel = (value: unknown) => displayLabel(CONTENT_TYPE_LABELS, value)
export const publicationStatusLabel = (value: unknown) => displayLabel(PUBLICATION_STATUS_LABELS, value)
export const themeLabel = (value: unknown) => displayLabel(THEME_LABELS, value)
export const fieldTypeLabel = (value: unknown) => displayLabel(FIELD_TYPE_LABELS, value)
export const resourceTypeLabel = (value: unknown) => displayLabel(RESOURCE_TYPE_LABELS, value)

export function displayOptions<T extends string>(
  values: readonly T[],
  label: (value: T) => string,
): DisplayOption<T>[] {
  return values.map((value) => ({ title: label(value), value }))
}
