import type { Page, Team } from '../../../src/types'

export type PageManagementTab = 'PROPERTIES' | 'PERMISSIONS' | 'ATTACHMENTS' | 'HISTORY' | 'PUBLISH' | 'SHARE'

export interface PageHistory {
  id: string
  pageId: string
  revisionNo: number
  revisionKind: string
  description: string | null
  title: string
  content: unknown
  plainText: string
  schemaVersion: number
  createdBy: string
  createdAt: string
}

export interface PageHistoryPage {
  items: PageHistory[]
  nextOffset: number
  hasMore: boolean
}

export interface PublicationState {
  pageId: string
  draftRevision: number
  publicationId: string | null
  publishedDraftRevision: number | null
  published: boolean
  upToDate: boolean
  effectivePublishMode: 'MANUAL' | 'AUTO'
  automaticJobStatus: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | null
}

export interface PagePublication {
  id: string
  workspaceId: string
  knowledgeBaseId: string
  pageId: string
  sourceDraftRevision: number
  contentType: Page['contentType']
  title: string
  content: unknown
  plainText: string
  metadata: unknown
  schemaVersion: number
  publishedBy: string
  publishedAt: string
  supersededAt: string | null
}

export interface PublicationHistoryPage {
  items: PagePublication[]
  nextOffset: number
  hasMore: boolean
}

export interface ShareView {
  id: string
  workspaceId: string
  resourceType: 'PAGE' | 'KNOWLEDGE_BASE' | 'QUICK_NOTE'
  resourceId: string
  shareType: 'PUBLIC' | 'INVITE_LINK'
  passwordProtected: boolean
  role: 'READER' | 'COMMENTER' | 'EDITOR'
  requireApproval: boolean
  expiresAt: string | null
  allowCopy: boolean
  allowDownload: boolean
  allowExport: boolean
  allowComment: boolean
  allowSearchIndex: boolean
  policyVersion: number
  createdBy: string
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatedShare { share: ShareView; token: string }

export interface ShareAccessRequest {
  id: string
  shareId: string
  requesterId: string
  requesterEmail: string
  requesterDisplayName: string | null
  policyVersion: number
  message: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AttachmentView {
  id: string
  workspaceId: string
  pageId: string | null
  originalName: string
  mediaType: string
  sizeBytes: number
  checksumSha256: string
  uploadedBy: string
  extractionStatus: 'EXTRACTED' | 'EMPTY' | 'UNSUPPORTED' | 'TOO_LARGE' | 'FAILED' | 'METADATA_ONLY'
  extractedAt: string | null
  createdAt: string
  contentUrl: string
}

export interface PageLabel { id: string; name: string; color: string; position: number; createdBy: string; createdAt: string }
export interface PageLabels { pageId: string; revision: number; labels: PageLabel[] }

export type Capability = 'READ' | 'EDIT' | 'MANAGE' | 'COMMENT' | 'PUBLISH' | 'SHARE' | 'COPY' | 'DOWNLOAD' | 'EXPORT' | 'DELETE' | 'RESTORE' | 'MANAGE_PERMISSIONS' | 'VIEW_ANALYTICS'
export interface AuthorizationDecision { workspaceId: string; resourceType: string; resourceId: string; capabilities: Capability[]; visibility: string; permissionVersion: number; sources: string[] }
export interface AclEntry { id: string; workspaceId: string; resourceType: string; resourceId: string; subjectType: 'USER' | 'GROUP' | 'TEAM' | 'PUBLIC' | 'INVITE' | 'API_CLIENT'; subjectId: string | null; role: string | null; effect: 'ALLOW' | 'DENY'; capabilities: Capability[]; createdBy: string; createdAt: string; updatedAt: string }
export interface WorkspaceMember { userId: string; email: string; displayName: string | null; role: string }
export interface UserGroup { id: string; workspaceId: string; name: string; description: string | null; memberCount: number; createdBy: string; createdAt: string; updatedAt: string }
export type { Team }
