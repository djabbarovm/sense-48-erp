import { prisma } from '../src/client.js';
import { seedPhaseA } from './phaseA.js';
import { seedPhaseB } from './phaseB.js';

async function main() {
  console.log('Seeding Finance OS…');
  console.log('Phase A:');
  await seedPhaseA(prisma);
  console.log('Phase B:');
  await seedPhaseB(prisma);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
