import { expect, test } from '@playwright/test';

// Требует прогнанный seed Phase A (pnpm seed)
test('login → shell с навигацией по роли → tenant switcher', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@fos.test');
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL('/');
  const nav = page.getByRole('navigation').first();
  // Руководитель финансов — фокус-роль: компактное «Главное» под финансовый контур
  await expect(nav.getByText('Главное', { exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Платежи' })).toBeVisible();
  // Полный список — под «Все разделы»; «Поставщики» доступны после разворота, админки нет вовсе
  const summary = nav.locator('summary', { hasText: 'Все разделы' });
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(nav.getByRole('link', { name: 'Поставщики' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Администрирование' })).toHaveCount(0);
  // Портфель: lead имеет 3 tenant в переключателе
  const options = page.locator('select[name="tenant"] option');
  await expect(options).toHaveCount(3);
});

test('неверный пароль — ошибка', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@fos.test');
  await page.getByLabel('Пароль').fill('wrong');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
