import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
}

test('Payment Desk: три колонки, причины блокировок, готовые к batch', async ({ page }) => {
  await login(page, 'junior@fos.test');
  await page.goto('/payments');
  await expect(page.getByRole('heading', { name: 'Платёжный стол' })).toBeVisible();
  await expect(page.getByText('Готовы к batch')).toBeVisible();
  await expect(page.getByText('Заблокированы')).toBeVisible();
  await expect(page.getByText('Ожидают документов')).toBeVisible();
  // seed: 905 READY (exception), 903 ON_HOLD c UNVERIFIED_BANK
  await expect(page.getByText('PAY-2026-000905')).toBeVisible();
  await expect(page.getByText('PAY-2026-000903')).toBeVisible();
  await expect(page.getByText('UNVERIFIED_BANK').first()).toBeVisible();
  // кнопка сбора batch доступна junior (batch.create)
  await expect(page.getByRole('button', { name: 'Собрать batch' })).toBeVisible();
});

test('Визард: preview показывает outstanding и контроли до submit (C-03)', async ({ page }) => {
  await login(page, 'junior@fos.test');
  await page.goto('/payments/new');
  await page.locator('#pw-type').selectOption('CONTRACT');
  await page.locator('#pw-source').selectOption({ index: 1 });
  await page.locator('#pw-amount').fill('10000');
  await page.locator('#pw-purpose').fill('e2e preview');
  await page.getByRole('button', { name: 'Проверить контроли' }).click();
  await expect(page.getByText('Остаток к оплате')).toBeVisible();
  await expect(page.getByText('NO_SOURCE')).toBeVisible();
  await expect(page.getByText(/Пройдёт контроли|Будет заблокирован/)).toBeVisible();
});

test('Batch: список и карточка c summary, related party и историей решений', async ({ page }) => {
  await login(page, 'owner@rooftop.test');
  await page.goto('/batches');
  await expect(page.getByRole('heading', { name: 'Платёжные реестры' })).toBeVisible();
  await page.getByRole('link', { name: 'BATCH-2026-09-13' }).click();
  await expect(page.getByRole('heading', { name: 'BATCH-2026-09-13' })).toBeVisible();
  await expect(page.getByText('Cash после оплаты')).toBeVisible();
  await expect(page.getByText('Family Holdings').first()).toBeVisible(); // BR-036 related party
  await expect(page.getByRole('button', { name: 'Утвердить реестр' })).toBeVisible(); // REVIEWED + Owner
  await expect(page.getByText('История решений')).toBeVisible();

  // SETTLED batch: статусы items после отправки
  await page.goto('/batches');
  await page.getByRole('link', { name: 'BATCH-2026-09-10' }).click();
  await expect(page.getByText('RECONCILED').first()).toBeVisible();
});
