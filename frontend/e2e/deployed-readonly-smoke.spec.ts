import { expect, test } from '@playwright/test'

test.describe('deployed read-only smoke', () => {
  test.skip(
    process.env.DEPLOYED_READONLY_SMOKE !== 'true',
    'Run explicitly against an initialized deployment. This suite never writes application data.',
  )

  test('serves the Vue shell and keeps anonymous routes operable', async ({ page, request }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const setup = await request.get('/api/v1/setup/status')
    expect(setup.ok()).toBeTruthy()
    expect(await setup.json()).toMatchObject({ initialized: true })

    const registration = await request.get('/api/v1/auth/registration-status')
    expect(registration.ok()).toBeTruthy()
    expect(await registration.json()).toMatchObject({
      publicRegistrationEnabled: false,
      emailVerificationRequired: true,
      passwordLoginEnabled: true,
    })

    const readiness = await request.get('/actuator/health/readiness')
    expect(readiness.ok()).toBeTruthy()
    expect(await readiness.json()).toMatchObject({ status: 'UP' })

    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: '登录工作区' })).toBeVisible()
    await expect(page.getByLabel('邮箱')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('密码')).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
    await expect(page.getByText('请联系管理员获取邀请')).toBeVisible()

    await page.goto('/register')
    await expect(page).toHaveURL(/\/login$/)

    await page.goto('/app')
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/)

    await page.goto('/forgot-password')
    await expect(page.getByRole('heading', { name: '重置密码' })).toBeVisible()
    await expect(page.getByLabel('账号邮箱')).toHaveAttribute('type', 'email')

    await page.goto('/explore')
    await expect(page.getByRole('heading', { name: '发现值得长期关注的知识' })).toBeVisible()
    await expect(page.getByPlaceholder('搜索公开内容')).toBeVisible()
    await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible()

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await page.goto('/login')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    }

    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.ok()).toBeTruthy()
    expect(await manifest.json()).toMatchObject({ name: '知序', display: 'standalone' })
    expect((await request.get('/sw.js')).ok()).toBeTruthy()
    expect(pageErrors).toEqual([])
  })
})
