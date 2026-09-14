/**
 * Seed Phase E: стартовый маппинг категорий на счета НСБУ-21 (E-04).
 * Значения — разумный дефолт для event-venue; бухгалтер уточняет субсчета
 * в админке. Источники: НСБУ №21 (прил. 1, приказ МФ РУз №103 от 09.09.2002).
 */
import type { PrismaClient } from '@prisma/client';

// category_code → [счёт затрат, счёт НДС]
const NSBU_MAPPING: Record<string, [string, string | null]> = {
  FNB_FOOD: ['1010', '4410'], // сырьё и материалы; НДС — авансовые платежи в бюджет
  FNB_BEVERAGE: ['1010', '4410'],
  SPA_CONSUMABLES: ['1010', '4410'],
  SPA_RETAIL: ['2910', '4410'], // товары
  MARKETING: ['9410', '4410'], // расходы по реализации
  DECOR_AV: ['9410', '4410'],
  CLEANING: ['9420', '4410'], // административные (эксплуатация)
  LINEN_LAUNDRY: ['9420', '4410'],
  RENT: ['9420', '4410'],
  UTILITIES: ['9420', '4410'],
  REPAIR: ['9420', '4410'],
  ADMIN: ['9420', '4410'],
  SECURITY: ['9420', '4410'],
  FM_SERVICES: ['9420', '4410'],
  CAPEX: ['0820', null], // приобретение основных средств
};

export async function seedPhaseE(prisma: PrismaClient): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: ['rooftop-hall', 'sense48', 'ordo'] } } });
  let created = 0;
  for (const tenant of tenants) {
    const categories = await prisma.category.findMany({ where: { tenantId: tenant.id } });
    for (const category of categories) {
      const mapping = NSBU_MAPPING[category.code];
      if (!mapping) continue;
      const exists = await prisma.accountMapping.findUnique({
        where: { tenantId_categoryId: { tenantId: tenant.id, categoryId: category.id } },
      });
      if (exists) continue;
      await prisma.accountMapping.create({
        data: { tenantId: tenant.id, categoryId: category.id, accountCode: mapping[0], vatAccountCode: mapping[1] },
      });
      created++;
    }
  }
  console.log(`  account mappings (НСБУ-21): +${created}`);
}
