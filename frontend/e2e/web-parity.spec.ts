import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const administrator = {
  email: 'browser-admin@example.test',
  password: 'Browser-Admin-Password-2026!',
  workspace: '浏览器验收空间',
}

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'compact-desktop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const

test('fresh deployment, authenticated shell and responsive themes remain operable', async ({ page, browser }) => {
  const pageErrors: string[] = []
  const wcagViolations: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '创建实例管理员' })).toBeVisible()
  await expect(page.getByText('无需邮件验证')).toBeVisible()
  await page.getByLabel('管理员邮箱').fill(administrator.email)
  await page.getByLabel('空间名称').fill(administrator.workspace)
  await page.locator('input[type="password"]').nth(0).fill(administrator.password)
  await page.locator('input[type="password"]').nth(1).fill(administrator.password)
  await page.getByRole('button', { name: '创建并进入' }).click()

  await expect(page).toHaveURL(/\/app(?:\/|$)/)
  await expect(page.locator('.app-frame')).toBeVisible()
  await expect(page.getByRole('link', { name: '工作台' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: '小记' })).toBeVisible()
  await expect(page.getByRole('link', { name: '模板中心' })).toBeVisible()
  await expect(page.getByRole('link', { name: '导入与导出' })).toBeVisible()
  await expect(page.getByRole('link', { name: administrator.workspace }).first()).toBeVisible()
  const seeded = await seedFeatureRoutes(page)

  const routes = [
    ['/app/notes', '把灵感留在它溜走之前'],
    ['/app/notifications', '与你有关的动态'],
    ['/app/trash', '全局回收站'],
    ['/app/feed', '你关心的知识更新'],
    ['/app/profile', '个人主页与知识花园'],
    ['/app/account', '账号设置'],
    ['/app/open-platform', '把知识安全地连接出去'],
    ['/app/templates', '模板中心'],
    ['/app/transfers', '导入与导出'],
    ['/app/admin', '管理后台'],
  ] as const
  for (const [route, heading] of routes) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
    await assertDocumentSemantics(page, route)
    await collectWcag(page, route, wcagViolations)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const featureRoutes = [
    { route: `/app/w/${seeded.workspaceId}/teams/${seeded.teamId}`, ready: seeded.teamName, kind: 'heading' },
    { route: `/app/w/${seeded.workspaceId}/settings`, ready: seeded.workspaceName, kind: 'heading' },
    { route: `/app/kb/${seeded.knowledgeBaseId}`, ready: seeded.knowledgeBaseName, kind: 'heading' },
    { route: `/app/kb/${seeded.knowledgeBaseId}/settings`, ready: seeded.knowledgeBaseName, kind: 'heading' },
    { route: `/app/kb/${seeded.knowledgeBaseId}/pages/${seeded.documentId}`, ready: '文稿标题', kind: 'label' },
    { route: `/app/kb/${seeded.knowledgeBaseId}/pages/${seeded.whiteboardId}`, ready: '文稿标题', kind: 'label' },
    { route: `/app/kb/${seeded.knowledgeBaseId}/pages/${seeded.spreadsheetId}`, ready: '文稿标题', kind: 'label' },
    { route: `/app/kb/${seeded.knowledgeBaseId}/pages/${seeded.databaseId}`, ready: '文稿标题', kind: 'label' },
    { route: `/p/${seeded.publicationId}`, ready: seeded.documentTitle, kind: 'heading' },
    { route: `/s/${seeded.shareToken}`, ready: seeded.documentTitle, kind: 'heading' },
  ] as const
  for (const item of featureRoutes) {
    await page.goto(item.route)
    await waitForRouteReady(page, item)
    await assertDocumentSemantics(page, item.route)
    await collectWcag(page, item.route, wcagViolations)
    await page.screenshot({
      path: `test-results/visual/feature-${featureRouteName(item.route)}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }

  await page.goto(`/app/kb/${seeded.knowledgeBaseId}`)
  await waitForRouteReady(page, featureRoutes[2])
  const catalogTree = page.getByRole('tree', { name: '知识库目录' })
  const catalogGroup = catalogTree.getByRole('treeitem', { name: '浏览器验收', exact: true })
  const catalogDocument = catalogTree.getByRole('treeitem', { name: new RegExp(seeded.documentTitle) })
  await catalogGroup.focus()
  await page.keyboard.press('ArrowDown')
  await expect(catalogDocument).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(catalogGroup).toBeFocused()

  await page.goto(`/app/kb/${seeded.knowledgeBaseId}/pages/${seeded.documentId}`)
  await waitForRouteReady(page, featureRoutes[4])
  const editorBlock = page.getByRole('textbox', { name: '文稿块 1' })
  await editorBlock.focus()
  await page.keyboard.press('End')
  await page.keyboard.type(' /')
  const cardDialog = page.getByRole('dialog', { name: '内容卡片' })
  const cardSearch = page.getByRole('combobox', { name: '搜索内容卡片' })
  await expect(cardDialog).toBeVisible()
  await expect(cardSearch).toBeFocused()
  const firstCommand = await cardSearch.getAttribute('aria-activedescendant')
  expect(firstCommand).toBeTruthy()
  await page.keyboard.press('End')
  await expect.poll(() => cardSearch.getAttribute('aria-activedescendant')).not.toBe(firstCommand)
  await page.keyboard.press('Home')
  await expect.poll(() => cardSearch.getAttribute('aria-activedescendant')).toBe(firstCommand)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '图片', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cardSearch).toBeVisible()
  await expect(cardSearch).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(cardDialog).toBeHidden()
  await expect(editorBlock).toBeFocused()
  await expect(page.locator('.save-state[role="status"]')).toBeVisible()

  const publishButton = page.getByRole('button', { name: '更新发布' })
  await expect(publishButton).toBeEnabled()
  await publishButton.press('Enter')
  const managementDialog = page.getByRole('dialog', { name: '文稿管理' })
  await expect(managementDialog).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label'))).toBe('文稿管理')
  await page.keyboard.press('Escape')
  await expect(managementDialog).toBeHidden()
  await expect(publishButton).toBeFocused()

  await page.goto('/app')
  await expect(page.locator('.app-frame')).toBeVisible()
  await page.keyboard.press('Control+K')
  await expect(page.locator('.search-backdrop')).toBeVisible()
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-backdrop')).toBeHidden()

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await page.goto('/app')
      await expect(page.locator('.app-frame')).toBeVisible()
      await assertNoHorizontalPageOverflow(page, `${viewport.name}-${colorScheme}`)
      if (viewport.width <= 800) {
        await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible()
        await page.getByRole('button', { name: '打开导航' }).click()
        await expect(page.locator('.app-sidebar')).toHaveClass(/mobile-open/)
        await page.getByRole('button', { name: '关闭导航' }).click()
      }
      const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
      expect(scheme, `${viewport.name} should honor ${colorScheme}`).toContain(colorScheme)
      if (viewport.name === 'desktop' || viewport.name === 'mobile') {
        await collectWcag(page, `app-${viewport.name}-${colorScheme}`, wcagViolations)
      }
      await page.screenshot({
        path: `test-results/visual/app-${viewport.name}-${colorScheme}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }
  }

  const visualRoutes = [
    { route: '/app/notes', ready: '把灵感留在它溜走之前', kind: 'heading' },
    featureRoutes[0],
    featureRoutes[1],
    featureRoutes[2],
    featureRoutes[4],
    featureRoutes[5],
    featureRoutes[6],
    featureRoutes[7],
    featureRoutes[8],
    featureRoutes[9],
  ] as const
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      for (const item of visualRoutes) {
        await page.goto(item.route)
        await waitForRouteReady(page, item)
        const context = `${featureRouteName(item.route)}-${viewport.name}-${colorScheme}`
        await assertNoHorizontalPageOverflow(page, context)
        await assertDocumentSemantics(page, context)
        if (item.route.endsWith(`/pages/${seeded.databaseId}`)) {
          for (const viewName of ['表格', '看板', '画廊', '日历']) {
            const viewButton = page.locator('.database-views').getByRole('button', { name: viewName, exact: true })
            await viewButton.click()
            await expect(viewButton).toHaveClass(/active/)
            if (viewport.name === 'desktop' || viewport.name === 'mobile') {
              await collectWcag(page, `${context}-${viewName}`, wcagViolations)
            }
            await page.screenshot({
              path: `test-results/visual/${context}-database-${viewName}.png`,
              fullPage: true,
              animations: 'disabled',
            })
          }
        } else {
          if (viewport.name === 'desktop' || viewport.name === 'mobile') {
            await collectWcag(page, context, wcagViolations)
          }
          await page.screenshot({
            path: `test-results/visual/${context}.png`,
            fullPage: true,
            animations: 'disabled',
          })
        }
      }
    }
  }

  const anonymous = await browser.newContext({ locale: 'zh-CN', colorScheme: 'light' })
  const login = await anonymous.newPage()
  await login.goto('/register')
  await expect(login).toHaveURL(/\/login$/)
  await expect(login.getByRole('heading', { name: '登录知序' })).toBeVisible()
  await expect(login.getByLabel('密码')).toBeVisible()
  await expect(login.getByText('请联系管理员获取邀请')).toBeVisible()
  for (const viewport of viewports) {
    await login.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const colorScheme of ['light', 'dark'] as const) {
      await login.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await login.goto('/login')
      await assertNoHorizontalPageOverflow(login, `login-${viewport.name}-${colorScheme}`)
      await login.screenshot({
        path: `test-results/visual/login-${viewport.name}-${colorScheme}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }
  }
  await anonymous.close()

  expect(wcagViolations, `WCAG violations:\n${wcagViolations.join('\n')}`).toEqual([])
  expect(pageErrors, `uncaught browser errors:\n${pageErrors.join('\n')}`).toEqual([])
})

interface SeededFeatureRoutes {
  workspaceId: string
  workspaceName: string
  teamId: string
  teamName: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentId: string
  documentTitle: string
  whiteboardId: string
  spreadsheetId: string
  databaseId: string
  publicationId: string
  shareToken: string
}

async function seedFeatureRoutes(page: Page): Promise<SeededFeatureRoutes> {
  const workspaces = await apiGet<Array<{ id: string }>>(page, '/api/v1/workspaces')
  expect(workspaces[0]?.id, 'bootstrap should create a personal workspace').toBeTruthy()
  await apiPost(page, '/api/v1/social/profile/save', {
    slug: 'browser-admin',
    displayName: '浏览器验收管理员',
    bio: '用于公开阅读、分享和响应式浏览器验收。',
    avatarUrl: null,
    coverUrl: null,
    theme: 'PAPER',
    navigation: [],
    seoTitle: '浏览器验收管理员',
    seoDescription: '自动化验收公开主页',
    discoverable: true,
    rssEnabled: true,
  })
  const workspaceName = '浏览器验收组织'
  const organization = await apiPost<{ id: string }>(page, '/api/v1/workspaces/create', { name: workspaceName })
  const workspaceId = organization.id
  const teamName = '浏览器验收团队'
  const team = await apiPost<{ id: string }>(page, '/api/v1/teams/create', {
    workspaceId,
    name: teamName,
    slug: 'browser-acceptance-team',
    visibility: 'WORKSPACE',
  })
  const knowledgeBaseName = '浏览器验收知识库'
  const knowledgeBase = await apiPost<{ id: string }>(page, '/api/v1/knowledge-bases/create', {
    workspaceId,
    name: knowledgeBaseName,
    slug: 'browser-acceptance-kb',
    ownerType: 'TEAM',
    ownerId: team.id,
    visibility: 'PRIVATE',
    publishMode: 'MANUAL',
  })
  const documentTitle = '浏览器验收文稿'
  const document = await apiPost<{ id: string }>(page, '/api/v1/pages/create', {
    knowledgeBaseId: knowledgeBase.id,
    title: documentTitle,
    path: 'browser-document',
    contentType: 'DOCUMENT',
    visibilityOverride: 'PUBLIC',
    content: { type: 'doc', content: [{ type: 'paragraph', text: '用于公开阅读、分享和编辑器无障碍验收。' }] },
  })
  const whiteboard = await apiPost<{ id: string }>(page, '/api/v1/pages/create', {
    knowledgeBaseId: knowledgeBase.id,
    title: '浏览器验收画板',
    path: 'browser-whiteboard',
    contentType: 'WHITEBOARD',
    content: { type: 'whiteboard', viewport: { x: 0, y: 0, zoom: 1 }, elements: [{ id: 'shape-1', kind: 'STICKY', x: 24, y: 32, width: 180, height: 110, text: '画板验收', color: '#fff1a8' }] },
  })
  const spreadsheet = await apiPost<{ id: string }>(page, '/api/v1/pages/create', {
    knowledgeBaseId: knowledgeBase.id,
    title: '浏览器验收电子表格',
    path: 'browser-spreadsheet',
    contentType: 'SPREADSHEET',
    content: { type: 'workbook', activeSheetId: 'sheet-1', sheets: [{ id: 'sheet-1', name: '验收表', rows: [['事项', '状态'], ['浏览器验收', '通过']], styles: {}, frozenRows: 1, frozenColumns: 0, hiddenRows: [], hiddenColumns: [], protectedCells: [], dropdowns: {}, filter: '' }] },
  })
  const database = await apiPost<{ id: string }>(page, '/api/v1/pages/create', {
    knowledgeBaseId: knowledgeBase.id,
    title: '浏览器验收数据表',
    path: 'browser-database',
    contentType: 'DATABASE',
    content: {
      type: 'database',
      fields: [{ id: 'name', name: '名称', type: 'TEXT' }, { id: 'status', name: '状态', type: 'SELECT', options: ['进行中', '已完成'] }, { id: 'date', name: '日期', type: 'DATE' }],
      rows: [{ id: 'row-1', values: { name: '浏览器覆盖', status: '进行中', date: '2026-08-25' }, createdAt: '2026-08-25T00:00:00Z' }],
      view: 'TABLE', filter: '', sortFieldId: null, activeViewId: 'view-table',
      views: [
        { id: 'view-table', name: '表格', type: 'TABLE', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['name', 'status', 'date'] },
        { id: 'view-kanban', name: '看板', type: 'KANBAN', filter: '', sortFieldId: null, groupFieldId: 'status', visibleFieldIds: ['name', 'status', 'date'] },
        { id: 'view-gallery', name: '画廊', type: 'GALLERY', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['name', 'status', 'date'] },
        { id: 'view-calendar', name: '日历', type: 'CALENDAR', filter: '', sortFieldId: null, groupFieldId: 'date', visibleFieldIds: ['name', 'status', 'date'] },
      ],
      form: { enabled: false, title: '提交信息', description: '', submitLabel: '提交', successMessage: '提交成功', fieldIds: [], requiredFieldIds: [] },
    },
  })
  const pageIds = [document.id, whiteboard.id, spreadsheet.id, database.id]
  await apiPost(page, '/api/v1/catalog/create', { knowledgeBaseId: knowledgeBase.id, nodeType: 'GROUP', titleOverride: '浏览器验收', expectedRevision: 0 })
  for (let index = 0; index < pageIds.length; index += 1) {
    await apiPost(page, '/api/v1/catalog/create', { knowledgeBaseId: knowledgeBase.id, nodeType: 'DOCUMENT', pageId: pageIds[index], expectedRevision: index + 1 })
  }
  const publication = await apiPost<{ id: string }>(page, '/api/v1/pages/publish', {
    pageId: document.id,
    idempotencyKey: 'browser-acceptance-publication',
  })
  const share = await apiPost<{ token: string }>(page, '/api/v1/shares/create', {
    resourceType: 'PAGE',
    resourceId: document.id,
    shareType: 'PUBLIC',
    role: 'READER',
    requireApproval: false,
    allowCopy: true,
    allowDownload: false,
    allowExport: false,
    allowComment: false,
    allowSearchIndex: false,
  })
  return {
    workspaceId, workspaceName, teamId: team.id, teamName,
    knowledgeBaseId: knowledgeBase.id, knowledgeBaseName,
    documentId: document.id, documentTitle,
    whiteboardId: whiteboard.id, spreadsheetId: spreadsheet.id, databaseId: database.id,
    publicationId: publication.id, shareToken: share.token,
  }
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  const value = await page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: 'include' })
    const text = await response.text()
    if (!response.ok) throw new Error(`${requestPath} returned ${response.status}: ${text}`)
    return text ? JSON.parse(text) as unknown : null
  }, path)
  return value as T
}

async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  const value = await page.evaluate(async ({ requestPath, requestBody }) => {
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
    return text ? JSON.parse(text) as unknown : null
  }, { requestPath: path, requestBody: body })
  return value as T
}

function featureRouteName(route: string) {
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 140)
}

async function waitForRouteReady(page: Page, item: { ready: string; kind: string }) {
  if (item.kind === 'label') await expect(page.getByLabel(item.ready)).toBeVisible()
  else await expect(page.getByRole('heading', { name: item.ready, exact: true }).first()).toBeVisible()
}

async function assertNoHorizontalPageOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth, `${context} has horizontal page overflow`).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

async function assertDocumentSemantics(page: Page, context: string) {
  const violations = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const accessibleName = (element: Element) => {
      const labelledBy = element.getAttribute('aria-labelledby')
      return element.getAttribute('aria-label')?.trim()
        || element.getAttribute('title')?.trim()
        || (labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim() : '')
        || element.textContent?.trim()
        || ''
    }
    const values: string[] = []
    for (const button of document.querySelectorAll('button')) {
      if (visible(button) && !accessibleName(button)) values.push(`visible button without an accessible name: ${button.outerHTML.slice(0, 240)}`)
    }
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) values.push(`image without alt: ${image.getAttribute('src') ?? ''}`)
    }
    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      if (visible(dialog) && !accessibleName(dialog)) values.push(`${dialog.getAttribute('role')} without an accessible name`)
    }
    if (!document.querySelector('main')) values.push('page has no main landmark')
    return [...new Set(values)]
  })
  expect(violations, `${context} semantic violations:\n${violations.join('\n')}`).toEqual([])
}

async function collectWcag(page: Page, context: string, sink: string[]) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 30).map((node) => ({
      target: node.target.map(String),
      data: node.any.map((check) => check.data).filter(Boolean),
    })),
  }))
  if (violations.length > 0) sink.push(`${context}: ${JSON.stringify(violations)}`)
}
