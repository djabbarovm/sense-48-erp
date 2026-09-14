import { expect, test } from '@playwright/test';

// Требует прогнанный seed Phase A (pnpm seed)
test('login → shell с навигацией по роли → tenant switcher', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('lead@fos.test');
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL('/');
  // Lead видит операционную навигацию, но не админку
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Поставщики' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Администрирование' })).toHaveCount(0);
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
