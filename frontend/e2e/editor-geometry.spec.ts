import { expect, test, type Locator, type Page } from '@playwright/test'

const administrator = {
  email: 'editor-geometry@example.test',
  password: 'Editor-Geometry-Password-2026!',
  workspace: '编辑器几何验收空间',
}

test.describe('Vue editor geometry at the Yuque desktop reference viewport', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

  test('keeps the 52px page header and 42px document toolbar in one 1440x900 focus shell', async ({ page, request }) => {
    const statusResponse = await request.get('/api/v1/setup/status')
    expect(statusResponse.ok()).toBeTruthy()
    const setup = await statusResponse.json() as { initialized: boolean }
    test.skip(setup.initialized, 'This write-capable geometry fixture requires a fresh disposable deployment.')

    await page.goto('/setup')
    await page.getByLabel('管理员邮箱').fill(administrator.email)
    await page.getByLabel('首个工作区名称').fill(administrator.workspace)
    await page.getByLabel('密码', { exact: true }).fill(administrator.password)
    await page.getByLabel('确认密码', { exact: true }).fill(administrator.password)
    await page.getByRole('button', { name: '创建并进入' }).click()
    await expect(page).toHaveURL(/\/app(?:\/|$)/)

    const workspaces = await apiGet<Array<{ id: string }>>(page, '/api/v1/workspaces')
    const workspaceId = workspaces[0]?.id
    expect(workspaceId).toBeTruthy()
    const knowledgeBase = await apiPost<{ id: string }>(page, '/api/v1/knowledge-bases/create', {
      workspaceId,
      name: '编辑器几何验收知识库',
      slug: 'editor-geometry-kb',
      ownerType: 'WORKSPACE',
      ownerId: workspaceId,
      visibility: 'PRIVATE',
      publishMode: 'MANUAL',
    })
    const document = await apiPost<{ id: string }>(page, '/api/v1/pages/create', {
      knowledgeBaseId: knowledgeBase.id,
      title: '编辑器几何验收文档',
      path: 'editor-geometry-document',
      contentType: 'DOCUMENT',
      content: { type: 'doc', content: [{ type: 'paragraph', text: '用于固定生产编辑器几何，不包含任何语雀私有内容。' }] },
    })

    await page.goto(`/app/kb/${knowledgeBase.id}/pages/${document.id}`)
    await expect(page.getByLabel('文稿标题')).toHaveValue('编辑器几何验收文档')

    const header = await visibleBox(page.locator('header.editor-header'))
    const toolbar = await visibleBox(page.locator('.editor-toolbar'))
    const canvas = await visibleBox(page.locator('.document-canvas'))
    const outline = await visibleBox(page.locator('aside[aria-label="文稿大纲"]'))

    expect(roundedBox(header)).toMatchObject({ x: 0, y: 0, width: 1440, height: 52 })
    expect(roundedBox(toolbar)).toMatchObject({ x: 0, y: 52, width: 1440, height: 42 })
    expect(Math.round(canvas.width)).toBe(750)
    expect(roundedBox(outline)).toMatchObject({ y: 94, width: 196 })

    const geometry = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      headerHeight: getComputedStyle(document.querySelector<HTMLElement>('.editor-header')!).height,
      toolbarHeight: getComputedStyle(document.querySelector<HTMLElement>('.editor-toolbar')!).height,
    }))
    expect(geometry).toMatchObject({
      viewport: { width: 1440, height: 900 },
      headerHeight: '52px',
      toolbarHeight: '42px',
    })
    expect(geometry.scrollWidth).toBeLessThanOrEqual(1440)
  })
})

async function visibleBox(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

function roundedBox(box: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
}

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
