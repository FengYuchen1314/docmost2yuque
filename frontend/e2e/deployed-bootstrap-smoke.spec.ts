import { expect, test } from '@playwright/test'

test.describe('deployed bootstrap smoke', () => {
  test.skip(
    process.env.DEPLOYED_BOOTSTRAP_SMOKE !== 'true',
    'Run explicitly against a fresh deployment before the first administrator is created.',
  )

  test('offers the first-email administrator flow without consuming it', async ({ page, request }) => {
    const statusResponse = await request.get('/api/v1/setup/status')
    expect(statusResponse.ok()).toBeTruthy()
    expect(await statusResponse.json()).toEqual({ initialized: false, registrationMode: 'CLOSED' })

    await page.goto('/')

    await expect(page).toHaveURL(/\/setup$/)
    await expect(page.getByText('首次部署', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '创建实例管理员' })).toBeVisible()
    await expect(page.getByText('第一个完成注册的邮箱将成为实例所有者，无需邮件验证。')).toBeVisible()
    await expect(page.getByLabel('管理员邮箱')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('空间名称')).toBeVisible()
    await expect(page.getByLabel(/^密码/)).toHaveAttribute('type', 'password')
    await expect(page.getByLabel('确认密码', { exact: true })).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: '创建并进入' })).toBeVisible()

    const afterResponse = await request.get('/api/v1/setup/status')
    expect(await afterResponse.json()).toEqual({ initialized: false, registrationMode: 'CLOSED' })
  })
})
