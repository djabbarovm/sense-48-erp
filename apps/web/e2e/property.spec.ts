import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/* P-08: MDS Property — три экрана Wave 1 на seed-тенанте piramit (docs/20 §11). */

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL('/');
}

test('Building View → Floor View → Unit Card ≤ 2 действия, фильтр по URL, легенда видна', async ({ page }) => {
  await login(page, 'commercial@piramit.test');
  await page.goto('/property?q=1203');
  await expect(page.getByRole('heading', { name: 'Живое здание' })).toBeVisible();
  await expect(page.getByText('Переговоры / резерв')).toBeVisible(); // легенда всегда видна
  await expect(page.getByText('Юнитов по фильтру: 1')).toBeVisible();
  await page.locator('a[href^="/property/units/"]').first().click(); // ячейка → карточка (действие 1 после поиска)
  await expect(page).toHaveURL(/\/property\/units\//);
  await expect(page.getByRole('heading', { name: '1203' })).toBeVisible();
  await expect(page.getByText('Противоречия в данных')).toBeVisible(); // seed: ремонт c активным договором
  await page.getByRole('link', { name: 'Этаж 12' }).click();
  await expect(page).toHaveURL(/\/property\/floors\//);
  await expect(page.locator('svg polygon').first()).toBeVisible();
});

test('брокер: PII собственника скрыт, договорные стадии недоступны; маркетинг не меняет статусы', async ({ page }) => {
  await login(page, 'broker@piramit.test');
  await page.goto('/property?q=1203');
  await page.locator('a[href^="/property/units/"]').first().click();
  await expect(page.getByText('скрыто (нет права)')).toBeVisible();
  const options = await page.locator('#f-commercial option').allInnerTexts();
  expect(options).not.toContain('Договор');
  await page.goto('/login');
  await login(page, 'marketing@piramit.test');
  await page.goto('/property?q=1203');
  await page.locator('a[href^="/property/units/"]').first().click();
  await expect(page.getByText('У вашей роли нет права менять статусы')).toBeVisible();
});

test('чужой tenant: юнит piramit → 404, свой экран без зданий → пустое состояние', async ({ page }) => {
  await login(page, 'commercial@piramit.test');
  await page.goto('/property?q=1203');
  const unitHref = await page.locator('a[href^="/property/units/"]').first().getAttribute('href');
  await page.goto('/login');
  await login(page, 'chef@rooftop.test');
  const resp = await page.goto(unitHref!);
  expect(resp?.status()).toBe(404);
  await page.goto('/property');
  await expect(page.getByText('Здания ещё не заведены')).toBeVisible();
});
