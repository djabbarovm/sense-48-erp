/**
 * H-09 (security): ротация паролей учёток приложения защищённым каналом.
 * Новый пароль передаётся ТОЛЬКО через GitHub Secret APP_TEMP_PASSWORD →
 * env контейнера; в чатах/логах он не появляется. Ставит новый хэш всем
 * учёткам @palym.test и демо-учёткам @piramit.test (H-11); сбросить их активные сессии нельзя (JWT stateless,
 * см. аудит) — поэтому одновременно меняется AUTH_JWT_SECRET на сервере
 * (все старые cookie мгновенно перестают проходить подпись).
 */
import { hashPassword } from '../packages/core/src/index.js';
import { prisma } from '../packages/db/src/index.js';

async function main() {
  const pwd = process.env['APP_TEMP_PASSWORD'];
  if (!pwd || pwd.length < 10) {
    console.log('APP_TEMP_PASSWORD не задан или короче 10 символов — ротация пропущена');
    return;
  }
  const hash = await hashPassword(pwd);
  const res = await prisma.user.updateMany({
    where: { OR: [{ email: { endsWith: '@palym.test' } }, { email: { endsWith: '@piramit.test' } }, { username: { in: ['umar', 'aziz'] } }] },
    data: { passwordHash: hash },
  });
  console.log(`Пароль обновлён у ${res.count} учёток (@palym.test, @piramit.test, логины umar/aziz). Значение пароля в логах не печатается.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
