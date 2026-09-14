import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
}

test('admin видит экран администрирования с данными seed', async ({ page }) => {
  await login(page, 'admin@fos.test');
  await page.getByRole('link', { name: 'Администрирование' }).click();
  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
  await expect(page.getByText('lead@fos.test')).toBeVisible();
  await expect(page.getByText('FNB_FOOD')).toBeVisible();
});

test('не-admin получает 404 на /admin', async ({ page }) => {
  await login(page, 'junior@fos.test');
  const resp = await page.goto('/admin');
  expect(resp?.status()).toBe(404);
});
