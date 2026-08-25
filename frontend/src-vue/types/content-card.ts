export type ContentCardKind =
  | 'bookmark'
  | 'code'
  | 'attachment'
  | 'image'
  | 'video'
  | 'iframe'
  | 'callout'
  | 'status'
  | 'sensitive-text'
  | 'unknown'

export type ContentCardSource = 'node' | 'token' | 'json' | 'legacy' | 'unknown'

export interface ContentCardAttributes {
  cardId: string
  instanceId: string
  version: number
  data: Record<string, unknown>
}

/** Canonical representation persisted in a ProseMirror-compatible JSON document. */
export interface ContentCardNode {
  type: 'contentCard'
  attrs: ContentCardAttributes
}

/**
 * Persisted card input is deliberately unknown: the renderer accepts canonical
 * nodes, legacy flat objects, old {{card:...}} tokens, and JSON strings.
 */
export type ContentCardInput = unknown

export interface NormalizedContentCard extends ContentCardAttributes {
  kind: ContentCardKind
  source: ContentCardSource
  valid: boolean
  warnings: string[]
  raw?: string
}

export interface ContentCardDefinition {
  kind: Exclude<ContentCardKind, 'unknown'>
  cardId: string
  title: string
  description: string
  icon: string
  color: string
  aliases?: string[]
}

export interface ContentCardAction {
  action: 'open' | 'download' | 'copy' | 'unlock' | 'hide'
  card: NormalizedContentCard
  url?: string
}

export interface ContentCardError {
  card: NormalizedContentCard
  operation: 'normalize' | 'copy' | 'decrypt' | 'upload' | 'create'
  message: string
}

export interface ContentCardUploadedAsset {
  url: string
  name?: string
  size?: number
  mimeType?: string
  poster?: string
}

export type ContentCardUploadKind = 'attachment' | 'image' | 'video'

export interface ContentCardUploadEvent {
  kind: ContentCardUploadKind
  file: File
}

export interface ContentCardUploadCompleteEvent extends ContentCardUploadEvent {
  asset: ContentCardUploadedAsset
}

export interface ContentCardCreateEvent {
  kind: Exclude<ContentCardKind, 'unknown'>
  card: NormalizedContentCard
  node: ContentCardNode
  token: string
}

export type ContentCardUploadHandler = (
  file: File,
  kind: ContentCardUploadKind,
) => Promise<ContentCardUploadedAsset>

export interface SensitiveCardEnvelope extends Record<string, unknown> {
  ciphertext: string
  salt: string
  iv: string
  kdf: 'PBKDF2-SHA256'
  iterations: number
  hint?: string
}
