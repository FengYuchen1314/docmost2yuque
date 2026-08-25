export interface ApiProblem { status: number; code: string; title: string; detail: string }
export class ApiError extends Error {
  constructor(public problem: ApiProblem) {
    super(problem.detail || problem.title)
    this.name = 'ApiError'
  }
}

interface CsrfToken { headerName: string; parameterName: string; token: string }
let csrf: CsrfToken | null = null

async function loadCsrf() {
  if (!csrf) csrf = await api<CsrfToken>('/api/v1/auth/csrf')
  return csrf
}
export function resetCsrf() { csrf = null }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init })
  if (!response.ok) {
    let payload: unknown
    try { payload = await response.json() } catch { payload = null }
    const record = payload && typeof payload === 'object' ? payload as Partial<ApiProblem> : null
    throw new ApiError({ status: record?.status ?? response.status, code: record?.code ?? 'HTTP_ERROR', title: record?.title ?? response.statusText, detail: record?.detail ?? `请求失败（${response.status}）` })
  }
  if (response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  return type.includes('application/json') ? response.json() as Promise<T> : await response.text() as T
}

export const get = <T>(path: string) => api<T>(path)
export async function post<T>(path: string, body: unknown, authenticated = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authenticated) { const token = await loadCsrf(); headers[token.headerName] = token.token }
  return api<T>(path, { method: 'POST', headers, body: JSON.stringify(body) })
}
export async function upload<T>(path: string, body: FormData) {
  const token = await loadCsrf()
  return api<T>(path, { method: 'POST', headers: { [token.headerName]: token.token }, body })
}

export async function download(path: string, body: unknown): Promise<void> {
  const token = await loadCsrf()
  return downloadResponse(path, body, { 'Content-Type': 'application/json', [token.headerName]: token.token })
}
export async function downloadPublic(path: string, body: unknown): Promise<void> {
  return downloadResponse(path, body, { 'Content-Type': 'application/json' })
}
async function downloadResponse(path: string, body: unknown, headers: Record<string, string>): Promise<void> {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) })
  if (!response.ok) throw new ApiError({ status: response.status, code: 'DOWNLOAD_FAILED', title: '下载失败', detail: `下载失败（${response.status}）` })
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)?.[1] ?? 'download'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = decodeURIComponent(encoded.replaceAll('"', ''))
  anchor.click()
  URL.revokeObjectURL(url)
}

export const messageOf = (error: unknown) => error instanceof ApiError ? error.problem.detail : error instanceof Error ? error.message : '操作失败，请稍后重试'
