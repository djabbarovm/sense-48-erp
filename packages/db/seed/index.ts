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
