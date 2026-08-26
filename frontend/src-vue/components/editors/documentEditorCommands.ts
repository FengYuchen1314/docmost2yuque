import type { ContentCardKind } from '../../types/content-card'

export type DocumentBlockKind = 'PARAGRAPH' | 'H1' | 'H2' | 'QUOTE' | 'BULLET' | 'NUMBERED' | 'TODO' | 'CODE'
export type DocumentContentCardKind = Exclude<ContentCardKind, 'unknown'>
export type DocumentEditorCommandGroup = 'BASIC' | 'MEDIA' | 'CONTENT' | 'RELATION'

interface CommandBase {
  id: string
  group: DocumentEditorCommandGroup
  title: string
  description: string
  icon: string
  keywords: string
}

export type DocumentEditorCommand =
  | (CommandBase & { action: 'BLOCK'; blockKind: DocumentBlockKind })
  | (CommandBase & { action: 'CONTENT_CARD'; cardKind: DocumentContentCardKind })
  | (CommandBase & { action: 'REFERENCE' })

export interface DocumentEditorCommandGroupView {
  id: DocumentEditorCommandGroup
  label: string
  commands: DocumentEditorCommand[]
}

export const DOCUMENT_EDITOR_COMMANDS: DocumentEditorCommand[] = [
  { id: 'paragraph', group: 'BASIC', action: 'BLOCK', blockKind: 'PARAGRAPH', title: '正文', description: '普通文本段落', icon: 'mdi-format-paragraph', keywords: 'paragraph text zhengwen duanluo' },
  { id: 'heading-1', group: 'BASIC', action: 'BLOCK', blockKind: 'H1', title: '标题 1', description: '页面内的主标题', icon: 'mdi-format-header-1', keywords: 'heading title h1 biaoti' },
  { id: 'heading-2', group: 'BASIC', action: 'BLOCK', blockKind: 'H2', title: '标题 2', description: '页面内的二级标题', icon: 'mdi-format-header-2', keywords: 'heading title h2 biaoti' },
  { id: 'quote', group: 'BASIC', action: 'BLOCK', blockKind: 'QUOTE', title: '引用', description: '突出显示引用内容', icon: 'mdi-format-quote-close', keywords: 'quote yinyong' },
  { id: 'bullet-list', group: 'BASIC', action: 'BLOCK', blockKind: 'BULLET', title: '无序列表', description: '创建项目符号列表', icon: 'mdi-format-list-bulleted', keywords: 'bullet list unordered liebiao' },
  { id: 'numbered-list', group: 'BASIC', action: 'BLOCK', blockKind: 'NUMBERED', title: '有序列表', description: '创建编号列表', icon: 'mdi-format-list-numbered', keywords: 'number ordered list youxu liebiao' },
  { id: 'todo', group: 'BASIC', action: 'BLOCK', blockKind: 'TODO', title: '待办', description: '创建可勾选的任务', icon: 'mdi-checkbox-marked-outline', keywords: 'todo task checkbox daiban' },
  { id: 'code-block', group: 'BASIC', action: 'BLOCK', blockKind: 'CODE', title: '代码块', description: '保留缩进与换行', icon: 'mdi-code-braces-box', keywords: 'code daima' },
  { id: 'image', group: 'MEDIA', action: 'CONTENT_CARD', cardKind: 'image', title: '图片', description: '上传或插入一张图片', icon: 'mdi-image-outline', keywords: 'image photo picture tupian' },
  { id: 'attachment', group: 'MEDIA', action: 'CONTENT_CARD', cardKind: 'attachment', title: '附件', description: '上传文件并保留下载入口', icon: 'mdi-paperclip', keywords: 'attachment file pdf fujian' },
  { id: 'video', group: 'MEDIA', action: 'CONTENT_CARD', cardKind: 'video', title: '视频', description: '插入视频地址或上传视频', icon: 'mdi-play-box-outline', keywords: 'video shipin' },
  { id: 'bookmark', group: 'CONTENT', action: 'CONTENT_CARD', cardKind: 'bookmark', title: '网页书签', description: '展示链接标题、摘要与来源', icon: 'mdi-bookmark-outline', keywords: 'bookmark url web link shuqian wangye' },
  { id: 'web-embed', group: 'CONTENT', action: 'CONTENT_CARD', cardKind: 'iframe', title: '网页嵌入', description: '在文稿中嵌入 HTTPS 页面', icon: 'mdi-application-brackets-outline', keywords: 'iframe embed web wangye qianru' },
  { id: 'callout', group: 'CONTENT', action: 'CONTENT_CARD', cardKind: 'callout', title: '提示块', description: '插入信息、成功、警告或危险提示', icon: 'mdi-lightbulb-outline', keywords: 'callout alert notice tip tishi' },
  { id: 'status', group: 'CONTENT', action: 'CONTENT_CARD', cardKind: 'status', title: '状态卡', description: '展示事项状态和补充说明', icon: 'mdi-list-status', keywords: 'status state zhuangtai' },
  { id: 'sensitive-text', group: 'CONTENT', action: 'CONTENT_CARD', cardKind: 'sensitive-text', title: '加密内容', description: '在浏览器本地加密敏感文本', icon: 'mdi-shield-lock-outline', keywords: 'secret sensitive encrypted jiami' },
  { id: 'page-reference', group: 'RELATION', action: 'REFERENCE', title: '页面引用', description: '引用知识库中的其他文稿', icon: 'mdi-vector-link', keywords: 'reference page doc link yinyong yemian guanxi' },
]

const GROUP_LABELS: Record<DocumentEditorCommandGroup, string> = {
  BASIC: '基础',
  MEDIA: '媒体',
  CONTENT: '内容',
  RELATION: '关联',
}

const GROUP_ORDER: DocumentEditorCommandGroup[] = ['BASIC', 'MEDIA', 'CONTENT', 'RELATION']

export function filterDocumentEditorCommands(query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return DOCUMENT_EDITOR_COMMANDS
  return DOCUMENT_EDITOR_COMMANDS.filter((command) =>
    `${command.title} ${command.description} ${command.keywords}`.toLocaleLowerCase().includes(normalized),
  )
}

export function groupDocumentEditorCommands(commands: DocumentEditorCommand[]): DocumentEditorCommandGroupView[] {
  return GROUP_ORDER.flatMap((group) => {
    const values = commands.filter((command) => command.group === group)
    return values.length ? [{ id: group, label: GROUP_LABELS[group], commands: values }] : []
  })
}

export function blockCommandFor(kind: DocumentBlockKind) {
  return DOCUMENT_EDITOR_COMMANDS.find(
    (command): command is Extract<DocumentEditorCommand, { action: 'BLOCK' }> =>
      command.action === 'BLOCK' && command.blockKind === kind,
  )
}
