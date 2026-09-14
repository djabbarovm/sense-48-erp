import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
}

test('PR: chef создаёт → submit → согласование → APPROVED', async ({ page }) => {
  await login(page, 'chef@rooftop.test');
  await page.goto('/pr/new');
  await page.locator('#pr-what').fill('Лосось 20 кг');
  await page.locator('#pr-purpose').fill('Банкет 27.09');
  await page.locator('#pr-amount').fill('3000000');
  await page.locator('#pr-cc').selectOption({ label: 'RH-KITCHEN' });
  await page.getByRole('button', { name: 'Создать заявку' }).click();
  await page.waitForURL(/\/pr\/[0-9a-f-]{36}/);
  await expect(page.getByText('Черновик')).toBeVisible();

  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByText('На согласовании')).toBeVisible();
  await expect(page.getByText('BUSINESS_OWNER')).toBeVisible();
  const url = page.url();

  // chef — владелец RH-KITCHEN → может согласовать business-слот из My Approvals
  await page.goto('/approvals');
  await expect(page.getByText('Лосось 20 кг').first()).toBeVisible();

  // junior согласует FINANCE (tier 1)
  await login(page, 'junior@fos.test');
  await page.goto(url);
  const financeRow = page.locator('tr', { hasText: 'FINANCE' }).first();
  await financeRow.getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.locator('tr', { hasText: 'FINANCE' }).first()).toContainText('APPROVED');

  // chef согласует BUSINESS_OWNER
  const prId = url.match(/\/pr\/([0-9a-f-]{36})/)![1]!;
  await login(page, 'chef@rooftop.test');
  await page.goto('/approvals');
  await page
    .locator(`form:has(input[name="id"][value="${prId}"]):has(input[name="decision"][value="APPROVED"])`)
    .first()
    .getByRole('button', { name: 'Согласовать' })
    .click();
  // ждём завершения server action: карточка исчезает из pending-списка
  await expect(page.locator(`form:has(input[name="id"][value="${prId}"])`)).toHaveCount(0);

  await page.goto(url);
  await expect(page.getByText('Утверждена')).toBeVisible();
});
