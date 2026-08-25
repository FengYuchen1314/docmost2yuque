export interface ApiProblem {
  status: number
  code: string
  title: string
  detail: string
}

export class ApiError extends Error {
  readonly problem: ApiProblem

  constructor(problem: ApiProblem) {
    super(problem.detail || problem.title)
    this.name = 'ApiError'
    this.problem = problem
  }
}

interface CsrfToken {
  headerName: string
  parameterName: string
  token: string
}

let csrf: CsrfToken | null = null

async function loadCsrf(): Promise<CsrfToken> {
  if (csrf) return csrf
  csrf = await request<CsrfToken>('/api/v1/auth/csrf')
  return csrf
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) throw await responseError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export interface DownloadedFile { blob: Blob; filename: string | null }

export async function downloadPost(path: string, body: unknown, authenticated = true): Promise<DownloadedFile> {
  const token = authenticated ? await loadCsrf() : null
  const headers: Record<string, string> = { Accept: '*/*', 'Content-Type': 'application/json' }
  if (token) headers[token.headerName] = token.token
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await responseError(response)
  return { blob: await response.blob(), filename: dispositionFilename(response.headers.get('Content-Disposition')) }
}

export async function post<T>(path: string, body: unknown, authenticated = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authenticated) {
    const token = await loadCsrf()
    headers[token.headerName] = token.token
  }
  return request<T>(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

export async function upload<T>(path: string, body: FormData): Promise<T> {
  const token = await loadCsrf()
  return request<T>(path, {
    method: 'POST',
    headers: { [token.headerName]: token.token },
    body,
  })
}

export function resetCsrf(): void {
  csrf = null
}

export function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.problem.detail : error instanceof Error ? error.message : '发生了未知错误'
}

async function responseError(response: Response): Promise<ApiError> {
  let problem: ApiProblem
  try {
    problem = (await response.json()) as ApiProblem
  } catch {
    problem = { status: response.status, code: 'HTTP_ERROR', title: response.statusText, detail: '请求失败，请稍后重试' }
  }
  return new ApiError(problem)
}

function dispositionFilename(value: string | null): string | null {
  if (!value) return null
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
  if (encoded) { try { return decodeURIComponent(encoded) } catch { return encoded } }
  return /filename="?([^";]+)"?/i.exec(value)?.[1]?.trim() ?? null
}
