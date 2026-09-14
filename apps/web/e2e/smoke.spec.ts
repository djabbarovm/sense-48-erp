import { expect, test } from '@playwright/test';

test('unauthenticated user is redirected to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /Finance OS/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});
