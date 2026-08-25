import { expect, test, type Page } from '@playwright/test'

const administrator = {
  email: 'empty-editor-admin@example.test',
  password: 'Empty-Editor-Password-2026!',
}

test('new empty document and structured editors open without a blank-page crash', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/')
  await page.getByLabel('管理员邮箱').fill(administrator.email)
  await page.getByLabel('空间名称').fill('空白编辑器回归空间')
  await page.locator('input[type="password"]').nth(0).fill(administrator.password)
  await page.locator('input[type="password"]').nth(1).fill(administrator.password)
  await page.getByRole('button', { name: '创建并进入' }).click()
  await expect(page).toHaveURL(/\/app(?:\/|$)/)

  const workspaces = await apiGet<Array<{ id: string }>>(page, '/api/v1/workspaces')
  const workspaceId = workspaces[0]?.id
  expect(workspaceId).toBeTruthy()
  const knowledgeBase = await apiPost<{ id: string }>(page, '/api/v1/knowledge-bases/create', {
    workspaceId,
    name: '空白编辑器回归知识库',
    slug: 'empty-editor-regression',
    ownerType: 'WORKSPACE',
    ownerId: workspaceId,
    visibility: 'PRIVATE',
    publishMode: 'MANUAL',
  })

  const editors = [
    { type: '文档', ready: page.locator('.block-document-editor') },
    { type: '画板', ready: page.locator('.board-editor') },
    { type: '电子表格', ready: page.locator('.sheet-editor') },
    { type: '数据表', ready: page.locator('.database-editor') },
  ] as const

  for (const editor of editors) {
    await page.goto(`/app/kb/${knowledgeBase.id}`)
    await page.getByRole('button', { name: '新建内容' }).first().click()
    await expect(page.getByRole('heading', { name: '选择内容类型' })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(`^${editor.type}`) }).click()
    await expect(page).toHaveURL(new RegExp(`/app/kb/${knowledgeBase.id}/pages/`))
    await expect(page.getByLabel('文稿标题')).toBeVisible()
    await expect(editor.ready).toBeVisible()
  }

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
  expect(consoleErrors, `browser console errors:\n${consoleErrors.join('\n')}`).toEqual([])
})

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: 'include' })
    const text = await response.text()
    if (!response.ok) throw new Error(`${requestPath} returned ${response.status}: ${text}`)
    return (text ? JSON.parse(text) : null) as T
  }, path)
}

async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  return page.evaluate(async ({ requestPath, requestBody }) => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { credentials: 'include' })
    if (!csrfResponse.ok) throw new Error(`CSRF request returned ${csrfResponse.status}`)
    const csrf = await csrfResponse.json() as { headerName: string; token: string }
    const response = await fetch(requestPath, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
      body: JSON.stringify(requestBody),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${requestPath} returned ${response.status}: ${text}`)
    return (text ? JSON.parse(text) : null) as T
  }, { requestPath: path, requestBody: body })
}
