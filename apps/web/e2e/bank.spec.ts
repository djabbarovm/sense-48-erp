import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
}

test('Bank: cash position, статусы сверки, импорт выписки (BR-056 идемпотентен)', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'junior@fos.test');
  await page.goto('/bank');
  await expect(page.getByRole('heading', { name: 'Банк и сверка' })).toBeVisible();
  await expect(page.getByText('Трастбанк ****0101').first()).toBeVisible(); // cash position
  await expect(page.getByText('Авто-матч').first()).toBeVisible();
  await expect(page.getByText('Без пары').first()).toBeVisible();

  // импорт seed-выписки: первый прогон импортирует, повторные — skipped (BR-056)
  await page
    .locator('input[type="file"]')
    .setInputFiles(join(process.cwd(), '../../packages/db/seed/bank/2026-09-12.csv')); // cwd = apps/web
  await page.getByRole('button', { name: 'Импортировать' }).click();
  await expect(page.getByText(/Импортировано: \d+ · пропущено: \d+/)).toBeVisible({ timeout: 15_000 });
});

test('My Approvals: batch-режим — summary, красные items c toggle, Approve all green', async ({ page }) => {
  await login(page, 'owner@rooftop.test');
  await page.goto('/approvals');
  await expect(page.getByRole('link', { name: 'BATCH-2026-09-13' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve all green' })).toBeVisible();
  // красный item — related party PAY-2026-000909 c причиной
  await expect(page.getByText('PAY-2026-000909')).toBeVisible();
  await expect(page.getByText('RELATED_PARTY').first()).toBeVisible();
});
