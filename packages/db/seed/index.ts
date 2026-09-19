import { prisma } from '../src/client.js';
import { seedPhaseA } from './phaseA.js';
import { seedPhaseB } from './phaseB.js';
import { seedPhaseC } from './phaseC.js';
import { seedPhaseD } from './phaseD.js';
import { seedPhaseE } from './phaseE.js';
import { seedPhaseP } from './phaseP.js';

async function main() {
  console.log('Seeding Finance OS…');
  console.log('Phase A:');
  await seedPhaseA(prisma);
  console.log('Phase B:');
  await seedPhaseB(prisma);
  console.log('Phase C:');
  await seedPhaseC(prisma);
  console.log('Phase D:');
  await seedPhaseD(prisma);
  console.log('Phase E:');
  await seedPhaseE(prisma);
  // H-10: налоговый профиль ORDO по ответам бухгалтерии (налог c оборота 4%, ЕСП 12%, НДФЛ 12% c ИНПС внутри, всё до 15 числа)
  {
    const { taxPreset } = await import('@finance-os/core');
    const ordo = await prisma.tenant.findFirst({ where: { slug: 'ordo' } });
    if (ordo) for (const r of taxPreset('UZ_TURNOVER_4').rules) {
      const exists = await prisma.taxCalendarRule.findFirst({ where: { tenantId: ordo.id, type: r.type, isActive: true } });
      if (!exists) await prisma.taxCalendarRule.create({ data: { tenantId: ordo.id, type: r.type, name: r.name, recurrence: 'MONTHLY', dueDay: r.dueDay, rateBp: r.rateBp, baseKind: r.baseKind, note: r.note ?? null } });
    }
  }
  console.log('Phase P (MDS Property):');
  await seedPhaseP(prisma);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
