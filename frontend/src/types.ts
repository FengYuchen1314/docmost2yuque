export interface SetupStatus {
  initialized: boolean
}

export interface CurrentUser {
  userId: string
  email: string
  displayName?: string | null
  instanceAdmin: boolean
}

export interface RegistrationStatus {
  publicRegistrationEnabled: boolean
  emailVerificationRequired: boolean
  passwordLoginEnabled: boolean
  emailCodeLoginAvailable: boolean
}

export interface Workspace {
  id: string
  workspaceType: 'PERSONAL' | 'ORGANIZATION'
  name: string
  defaultVisibility: string
  defaultPublishMode: string
  membershipRole: string
}

export interface Team {
  id: string
  workspaceId: string
  name: string
  slug: string
  description: string | null
  avatar: string | null
  visibility: string
}

export interface KnowledgeBase {
  id: string
  workspaceId: string
  name: string
  slug: string
  description: string | null
  icon: string | null
  ownerType: string
  ownerId: string
  teamId: string | null
  homepagePageId: string | null
  visibility: string
  allowPublicIndex: boolean
  publishMode: string
  watermarkConfig: string
  appearanceConfig: string
  catalogConfig: string
  catalogRevision: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface DocumentSettings {
  pageWidth: 'STANDARD' | 'WIDE'
  fontFamily: 'SERIF' | 'SANS'
  fontSize: 'SMALL' | 'MEDIUM' | 'LARGE'
  paragraphSpacing: 'COMPACT' | 'NORMAL' | 'RELAXED'
  showOutline: boolean
}

export interface Page {
  id: string
  workspaceId: string
  knowledgeBaseId: string
  title: string
  icon: string | null
  cover: string | null
  contentType: 'DOCUMENT' | 'WHITEBOARD' | 'SPREADSHEET' | 'DATABASE'
  path: string
  publishMode: string
  publishedRevisionId: string | null
  publishedAt: string | null
  visibilityOverride: string
  documentSettings: DocumentSettings | Record<string, unknown>
  schemaVersion: number
  draftRevision: number
  content: unknown
  plainText: string
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface TrashItem {
  id: string
  workspaceId: string
  workspaceName: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  knowledgeBaseIcon: string | null
  title: string
  contentType: Page['contentType']
  path: string
  deletedBy: string
  deletedByName: string
  deletedByEmail: string
  deletedAt: string
  restoreAllowed: boolean
  deleteAllowed: boolean
}

export interface TrashPage {
  items: TrashItem[]
  nextOffset: number
  hasMore: boolean
}

export type PageReferenceKind = 'LINK' | 'MENTION' | 'EMBED' | 'BLOCK_REFERENCE' | 'RELATION'
export type PageEmbedMode = 'LINK' | 'TITLE' | 'CARD' | 'LIVE' | 'FIXED'

export interface PageReferenceSummary {
  referenceId: string
  direction: 'OUTGOING' | 'BACKLINK'
  sourceScope: 'DRAFT' | 'PUBLISHED'
  kind: PageReferenceKind
  mode: PageEmbedMode
  targetBlockId: string | null
  fixedPublicationId: string | null
  accessible: boolean
  pageId: string | null
  knowledgeBaseId: string | null
  title: string | null
  contentType: Page['contentType'] | null
  path: string | null
  updatedAt: string | null
}

export interface EmbeddedPageView {
  referenceId: string
  status: 'READY' | 'UNAVAILABLE' | 'MISSING_BLOCK'
  mode: PageEmbedMode
  pageId: string | null
  title: string | null
  contentType: Page['contentType'] | null
  content: unknown
  plainText: string | null
  targetBlockId: string | null
  publicationId: string | null
  snapshotAt: string | null
}

export interface KnowledgeGraph {
  rootPageId: string
  nodes: Array<{
    pageId: string
    knowledgeBaseId: string
    title: string
    contentType: Page['contentType']
  }>
  edges: Array<{
    referenceId: string
    sourcePageId: string
    targetPageId: string
    kind: PageReferenceKind
    mode: PageEmbedMode
  }>
  truncated: boolean
}

export interface ContentCardDefinition {
  id: string
  version: number
  title: string
  aliases: string[]
  category: string
  icon: string
  fullScreen: boolean
  interactive: boolean
  exportFormats: string[]
  initialData: Record<string, unknown>
  enabled: boolean
}

export interface PollState {
  cardInstanceId: string
  totalVoters: number
  options: Array<{ id: string; label: string; votes: number }>
  selectedOptionIds: string[]
  closed: boolean
}

export interface CheckinState {
  cardInstanceId: string
  localDate: string
  totalParticipants: number
  todayCount: number
  checkedIn: boolean
}

export interface CatalogNode {
  id: string
  knowledgeBaseId: string
  nodeType: 'DOCUMENT' | 'LINK' | 'GROUP'
  pageId: string | null
  parentId: string | null
  position: string
  titleOverride: string | null
  url: string | null
}

export interface CatalogTree {
  knowledgeBaseId: string
  revision: number
  nodes: CatalogNode[]
}

export interface WorkbenchItem {
  resourceId: string
  resourceType: 'PAGE'
  workspaceId: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  title: string
  path: string
  contentType: Page['contentType']
  publicationStatus: 'UNPUBLISHED' | 'PUBLISHED' | 'CHANGED'
  reason: 'EDITED' | 'VIEWED' | 'COLLABORATED' | 'FAVORITE' | 'CREATED'
  activityAt: string
  favorite: boolean
  collaborators: Array<{ userId: string; displayName: string | null; email: string }>
}

export interface WorkbenchPage {
  items: WorkbenchItem[]
  nextOffset: number
  hasMore: boolean
}

export interface QuickNoteTag {
  id: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface QuickNote {
  id: string
  workspaceId: string
  userId: string
  content: unknown
  plainText: string
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED'
  source: 'HOME' | 'QUICK_NOTE_PAGE' | 'API' | 'IMPORT'
  revision: number
  tags: QuickNoteTag[]
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt: string | null
}

export interface QuickNotePage {
  items: QuickNote[]
  nextOffset: number
  hasMore: boolean
}

export interface QuickNoteRevision {
  id: string
  quickNoteId: string
  revision: number
  kind: 'CREATE' | 'AUTO_SAVE' | 'COMMIT' | 'RESTORE'
  content: unknown
  plainText: string
  createdAt: string
}

export interface QuickNoteHistoryPage {
  items: QuickNoteRevision[]
  nextOffset: number
  hasMore: boolean
}

export interface KnowledgeBaseGroupItem {
  knowledgeBaseId: string
  name: string
  icon: string | null
  visibility: string
  ownerType: string
  position: string
}

export interface KnowledgeBaseGroup {
  id: string
  workspaceId: string
  name: string
  position: string
  items: KnowledgeBaseGroupItem[]
  createdAt: string
  updatedAt: string
}

export interface Notification {
  id: string
  workspaceId: string
  type: string
  actorId: string | null
  resourceType: string
  resourceId: string
  anchor: unknown
  payload: { preview?: string; commentId?: string; status?: string; requesterEmail?: string; publicationId?: string; title?: string; knowledgeBaseId?: string }
  occurrenceCount: number
  readAt: string | null
  createdAt: string
  updatedAt: string
}

export interface NotificationPage {
  items: Notification[]
  nextOffset: number
  hasMore: boolean
}

export interface Comment {
  id: string
  workspaceId: string
  pageId: string
  parentId: string | null
  anchor: unknown
  body: unknown
  plainText: string
  status: 'OPEN' | 'RESOLVED'
  createdBy: string
  creatorEmail: string
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  userId: string
  email: string
  displayName: string | null
  role: string
}

export interface SearchResult {
  documentId: string
  resourceId: string
  resourceType: 'PAGE' | 'KNOWLEDGE_BASE' | 'QUICK_NOTE' | 'TEMPLATE' | 'USER' | 'TEAM' | 'ATTACHMENT'
  sourceScope: 'DRAFT' | 'PUBLISHED' | 'CANONICAL'
  title: string
  snippet: string
  path: string | null
  contentType: string | null
  publicationId: string | null
  knowledgeBaseId: string | null
  ownerId?: string | null
  publicationStatus?: 'UNPUBLISHED' | 'PUBLISHED' | 'CHANGED' | null
  score: number
  updatedAt: string
}

export interface SearchResponse {
  results: SearchResult[]
  nextOffset: number
  hasMore: boolean
}

export interface DailyMetric {
  date: string
  views: number
  uniqueViews: number
  edits: number
  comments: number
  shares: number
  exports: number
  reactions: number
}

export interface AnalyticsReport {
  resourceType: 'PAGE' | 'KNOWLEDGE_BASE'
  resourceId: string
  from: string
  to: string
  totals: DailyMetric
  daily: DailyMetric[]
}

export interface Template {
  id: string
  workspaceId: string
  templateType: 'DOCUMENT' | 'KNOWLEDGE_BASE'
  name: string
  description: string | null
  category: string | null
  thumbnail: string | null
  sourceResourceId: string | null
  snapshot: unknown
  visibility: 'PRIVATE' | 'WORKSPACE'
  useCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TemplatePage {
  items: Template[]
  nextOffset: number
  hasMore: boolean
}

export interface TemplateInstance {
  templateId: string
  targetResourceType: 'PAGE' | 'KNOWLEDGE_BASE'
  targetResourceId: string
  resourceMapping: Record<string, string>
}

export interface TransferTask {
  id: string
  workspaceId: string
  taskType: 'IMPORT' | 'EXPORT'
  sourceFormat: 'MARKDOWN' | 'HTML' | 'TXT' | 'ZIP' | 'DOCX' | 'PDF' | 'JPG' | 'PNG' | 'SVG' | 'XLSX' | 'CSV' | 'NOTION' | 'CONFLUENCE'
  resourceType: 'PAGE' | 'KNOWLEDGE_BASE'
  resourceId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  progress: number
  originalFilename: string | null
  resultFilename: string | null
  resultMediaType: string | null
  artifactSize: number
  report: {
    importedCount?: number
    failedCount?: number
    pageCount?: number
    bytes?: number
    scope?: string
    error?: string
    resources?: Array<{ pageId: string; title: string; source: string }>
  }
  requestedBy: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  cancelRequested: boolean
}

export interface TransferTaskPage {
  items: TransferTask[]
  nextOffset: number
  hasMore: boolean
}

export interface PublicProfile {
  userId: string
  slug: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  coverUrl: string | null
  theme: 'PAPER' | 'MINIMAL' | 'MAGAZINE' | 'DARK'
  navigation: Array<{ label: string; url: string }>
  seoTitle: string | null
  seoDescription: string | null
  discoverable: boolean
  rssEnabled: boolean
  followerCount: number
  followingCount: number
  followed: boolean
  updatedAt: string
}

export interface GardenKnowledgeBase {
  id: string
  name: string
  slug: string
  description: string | null
  icon: string | null
}

export interface Garden {
  id: string
  userId: string
  ownerSlug: string
  ownerName: string
  slug: string
  title: string
  description: string | null
  icon: string | null
  coverUrl: string | null
  theme: PublicProfile['theme']
  navigation: PublicProfile['navigation']
  seoTitle: string | null
  seoDescription: string | null
  discoverable: boolean
  rssEnabled: boolean
  followerCount: number
  followed: boolean
  knowledgeBases: GardenKnowledgeBase[]
  updatedAt: string
}

export interface PublicContent {
  publicationId: string
  pageId: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  title: string
  path: string
  contentType: Page['contentType']
  preview: string
  authorId: string
  authorSlug: string
  authorName: string
  authorAvatar: string | null
  reactions: Partial<Record<'LIKE' | 'CLAP' | 'HEART' | 'INSIGHTFUL', number>>
  viewerReactions: Array<'LIKE' | 'CLAP' | 'HEART' | 'INSIGHTFUL'>
  publishedAt: string
}

export interface PublicReader {
  metadata: PublicContent
  content: unknown
  plainText: string
  schemaVersion: number
  documentSettings: DocumentSettings | Record<string, unknown>
  pageMetadata?: { icon?: string | null; cover?: string | null; labels?: string[] }
  appearanceConfig?: unknown
  watermarkConfig?: unknown
}

export interface Explore {
  trending: PublicContent[]
  latest: PublicContent[]
  creators: PublicProfile[]
  gardens: Garden[]
}

export interface FeedItem {
  reason: string
  content: PublicContent
}

export interface SocialPage<T> {
  items: T[]
  nextOffset: number
  hasMore: boolean
}

export interface FollowState {
  followed: boolean
  notificationsEnabled: boolean
}

export interface ApiKeyCredential {
  id: string
  workspaceId: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  secret: string | null
}

export interface OAuthClient {
  id: string
  workspaceId: string
  clientId: string
  name: string
  redirectUris: string[]
  scopes: string[]
  publicClient: boolean
  active: boolean
  createdAt: string
  updatedAt: string
  clientSecret: string | null
}

export interface OAuthAuthorizationInfo {
  clientId: string
  name: string
  redirectUri: string
  scopes: string[]
  publicClient: boolean
}

export interface WebhookSubscription {
  id: string
  workspaceId: string
  name: string
  endpointUrl: string
  events: string[]
  active: boolean
  consecutiveFailures: number
  suspendedAt: string | null
  createdAt: string
  updatedAt: string
  signingSecret: string | null
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  eventId: string
  eventType: string
  status: 'PENDING' | 'RETRYING' | 'DELIVERED' | 'DEAD'
  attempts: number
  nextAttemptAt: string
  responseStatus: number | null
  lastError: string | null
  deliveredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WebhookDeliveryPage {
  items: WebhookDelivery[]
  nextOffset: number
  hasMore: boolean
}
