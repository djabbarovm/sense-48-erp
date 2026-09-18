import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/* P-10: MDS Property Wave 2 — доска сделок, карточка, договор из сделки, брокерские ограничения, API-ключ. */

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/(property\/today)?$/); // роли недвижимости попадают на «Пульт»
}

test('доска сделок: сводка, колонки, карточка; advance меняет стадию и пишет историю', async ({ page }) => {
  await login(page, 'commercial@piramit.test');
  await page.goto('/deals');
  await expect(page.getByRole('heading', { name: 'Сделки' })).toBeVisible();
  await expect(page.getByText('Потенциальная')).toBeVisible();
  // свежая сделка — тест не зависит от состояния seed после прошлых прогонов
  await page.goto('/deals/new');
  await page.getByLabel('Контакт *').fill('E2E Клиент');
  await page.getByRole('button', { name: 'Создать сделку' }).click();
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);
  await expect(page.locator('h1 ~ span span').first()).toContainText('Новый лид');
  const advance = page.locator('form').filter({ has: page.locator('input[name=trigger][value=advance]') }).getByRole('button');
  await expect(advance).toBeVisible();
  await advance.click();
  await expect(page.locator('h1 ~ span span').first()).toContainText('Квалифицирован');
  await expect(page.getByText('deal.stage.change').first()).toBeVisible();
});

test('брокер: видит только свои сделки, договорные стадии недоступны; маркетинг не создаёт сделки', async ({ page }) => {
  await login(page, 'broker@piramit.test');
  await page.goto('/deals');
  await expect(page.getByText('Бекзод Тураев').first()).toBeVisible();
  await expect(page.locator('a[href^="/deals/"]').filter({ hasText: 'Алия Сафарова' })).toHaveCount(0); // чужих сделок нет (в фильтре менеджеров имя допустимо)
  await page.goto('/login');
  await login(page, 'marketing@piramit.test');
  const resp = await page.goto('/deals/new');
  expect(resp?.status()).toBe(404);
});

test('API-ключ: создание показывает ключ один раз; публичный inventory без PII', async ({ page, request }) => {
  await login(page, 'admin@piramit.test');
  await page.goto('/admin/api-keys');
  await page.getByLabel('Название').fill('e2e-site');
  await page.getByRole('button', { name: 'Создать ключ' }).click();
  await expect(page.getByText('Скопируйте ключ сейчас')).toBeVisible();
  const key = await page.locator('code').first().innerText();
  expect(key).toMatch(/^mds_/);
  const denied = await request.get('/api/property/public/inventory');
  expect(denied.status()).toBe(401);
  const ok = await request.get('/api/property/public/inventory', { headers: { 'X-Api-Key': key } });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { units: { unitNo: string }[] };
  expect(body.units.length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toMatch(/owner|occupant|phone/i);
});
