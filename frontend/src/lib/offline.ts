import type { Page } from '../types'

const DATABASE_NAME = 'zhixu-offline-v1'
const DATABASE_VERSION = 1
const PAGE_STORE = 'pages'
const UPDATE_STORE = 'page-updates'
export const OFFLINE_QUEUE_EVENT = 'zhixu:offline-queue-change'

export interface PageDraft {
  title: string
  body: string
}

export interface PendingPageUpdate {
  key: string
  userId: string
  pageId: string
  expectedRevision: number
  title: string
  content: unknown
  plainText: string
  contentType: Page['contentType']
  queuedAt: number
}

export interface FlushResult {
  sent: number
  remaining: number
  conflictPageIds: string[]
}

interface CachedPage {
  key: string
  userId: string
  cachedAt: number
  value: Page
}

export function toPendingPageUpdate(userId: string, page: Page, draft: PageDraft, queuedAt = Date.now()): PendingPageUpdate {
  return {
    key: scopedKey(userId, page.id),
    userId,
    pageId: page.id,
    expectedRevision: page.draftRevision,
    title: draft.title,
    content: page.contentType === 'DOCUMENT'
      ? { type: 'doc', content: [{ type: 'paragraph', text: draft.body }] }
      : parseStructuredBody(draft.body),
    plainText: draft.body,
    contentType: page.contentType,
    queuedAt,
  }
}

export function mergePendingPageUpdate(previous: PendingPageUpdate | undefined, next: PendingPageUpdate): PendingPageUpdate {
  if (!previous || previous.key !== next.key) return next
  return { ...next, expectedRevision: previous.expectedRevision }
}

export function optimisticPage(page: Page, update: PendingPageUpdate): Page {
  return {
    ...page,
    title: update.title,
    content: update.content,
    plainText: update.plainText,
    updatedAt: new Date(update.queuedAt).toISOString(),
  }
}

export async function cachePage(userId: string, page: Page): Promise<void> {
  const database = await openDatabase()
  await transactionDone(database, PAGE_STORE, 'readwrite', (store) => store.put({
    key: scopedKey(userId, page.id), userId, cachedAt: Date.now(), value: page,
  } satisfies CachedPage))
}

export async function readCachedPage(userId: string, pageId: string): Promise<Page | undefined> {
  const database = await openDatabase()
  const cached = await requestResult<CachedPage | undefined>(database.transaction(PAGE_STORE).objectStore(PAGE_STORE).get(scopedKey(userId, pageId)))
  return cached?.value
}

export async function queuePageUpdate(update: PendingPageUpdate): Promise<PendingPageUpdate> {
  const database = await openDatabase()
  const transaction = database.transaction(UPDATE_STORE, 'readwrite')
  const store = transaction.objectStore(UPDATE_STORE)
  const previous = await requestResult<PendingPageUpdate | undefined>(store.get(update.key))
  const merged = mergePendingPageUpdate(previous, update)
  store.put(merged)
  await transactionComplete(transaction)
  await publishQueueCount(update.userId)
  return merged
}

export async function pendingPageUpdateCount(userId: string): Promise<number> {
  return (await pendingPageUpdates(userId)).length
}

export async function flushPageUpdates(
  userId: string,
  send: (update: PendingPageUpdate) => Promise<Page>,
): Promise<FlushResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { sent: 0, remaining: await pendingPageUpdateCount(userId), conflictPageIds: [] }
  }
  let sent = 0
  const conflicts: string[] = []
  for (const update of await pendingPageUpdates(userId)) {
    try {
      const saved = await send(update)
      await cachePage(userId, saved)
      await removeIfUnchanged(update)
      sent += 1
    } catch (reason) {
      if (isRevisionConflict(reason)) conflicts.push(update.pageId)
      if (isNetworkFailure(reason)) break
      // A conflict or validation error stays queued so no local edit is discarded.
    }
  }
  const remaining = await publishQueueCount(userId)
  return { sent, remaining, conflictPageIds: conflicts }
}

export function isNetworkFailure(reason: unknown): boolean {
  return (typeof navigator !== 'undefined' && !navigator.onLine) || reason instanceof TypeError
}

async function pendingPageUpdates(userId: string): Promise<PendingPageUpdate[]> {
  const database = await openDatabase()
  const values = await requestResult<PendingPageUpdate[]>(database.transaction(UPDATE_STORE).objectStore(UPDATE_STORE).getAll())
  return values.filter((value) => value.userId === userId).sort((left, right) => left.queuedAt - right.queuedAt)
}

async function removeIfUnchanged(sent: PendingPageUpdate): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(UPDATE_STORE, 'readwrite')
  const store = transaction.objectStore(UPDATE_STORE)
  const current = await requestResult<PendingPageUpdate | undefined>(store.get(sent.key))
  if (current?.queuedAt === sent.queuedAt) store.delete(sent.key)
  await transactionComplete(transaction)
}

async function publishQueueCount(userId: string): Promise<number> {
  const count = await pendingPageUpdateCount(userId)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT, { detail: { count } }))
  return count
}

function isRevisionConflict(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'problem' in reason
    && (reason as { problem?: { code?: string } }).problem?.code === 'PAGE_REVISION_CONFLICT'
}

function scopedKey(userId: string, id: string): string {
  return `${userId}:${id}`
}

function parseStructuredBody(value: string): object {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('结构化内容不是有效的 JSON 对象')
  return parsed
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('当前环境不支持离线存储'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PAGE_STORE)) request.result.createObjectStore(PAGE_STORE, { keyPath: 'key' })
      if (!request.result.objectStoreNames.contains(UPDATE_STORE)) request.result.createObjectStore(UPDATE_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开离线存储'))
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('离线存储操作失败'))
  })
}

function transactionDone(database: IDBDatabase, storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => void): Promise<void> {
  const transaction = database.transaction(storeName, mode)
  action(transaction.objectStore(storeName))
  return transactionComplete(transaction)
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('离线存储事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('离线存储事务已取消'))
  })
}
