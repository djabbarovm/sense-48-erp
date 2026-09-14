import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
}

test('vendor: создание → смена реквизитов → dual verify → активация', async ({ page }) => {
  const tax = String(300_000_000 + Math.floor(Math.random() * 99_999_999));
  await login(page, 'junior@fos.test');
  await page.goto('/vendors');
  await page.locator('#v-tax').fill(tax);
  await page.locator('#v-name').fill('ООО «Плейрайт Тест»');
  await page.getByRole('button', { name: 'Создать' }).click();
  await page.waitForURL(/\/vendors\/[0-9a-f-]{36}/);
  await expect(page.getByText('Ожидает проверки')).toBeVisible();

  // смена реквизитов
  await page.locator('#ba-bank').fill('Trustbank');
  await page.locator('#ba-mfo').fill('00444');
  await page.locator('#ba-acc').fill('20208000900001112233');
  await page.getByRole('button', { name: 'Сменить реквизиты' }).click();
  await expect(page.getByText('****2233').first()).toBeVisible();
  await expect(page.getByText('Не проверен').first()).toBeVisible();

  // junior делает шаг 1
  await page.getByRole('button', { name: 'Проверка (шаг 1)' }).click();
  await expect(page.getByRole('button', { name: 'Проверка (шаг 1)' })).toHaveCount(0);

  const url = page.url();
  // lead делает шаг 2 и активирует
  await login(page, 'lead@fos.test');
  await page.goto(url);
  await page.getByRole('button', { name: 'Подтвердить (шаг 2)' }).click();
  await expect(page.getByText('Проверен', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Активировать поставщика' }).click();
  await expect(page.getByText('Активен', { exact: true })).toBeVisible();
});
