import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createDeal, listDeals } from '../src/services/deals.js';
import { handoffDeal, returnToQualification, countReturnsToQualification } from '../src/services/dealHandoff.js';

let tenantId: string; let ccId: string; let brokerId: string;
const ctx = (roles: RoleCode[], userId: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'ho', userId, roles });
const NOW = new Date('2026-09-21T05:00:00Z');

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-ho-${ts}`, legalName: 'HO', taxId: '300000801', settings: {} } })).id;
  ccId = (await prisma.user.create({ data: { email: `ho-cc-${ts}@t.test`, fullName: 'Умар Колл' } })).id;
  brokerId = (await prisma.user.create({ data: { email: `ho-br-${ts}@t.test`, fullName: 'Азиз Брокер' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: ccId, role: 'CALL_CENTER' } });
  await prisma.userTenantRole.create({ data: { tenantId, userId: brokerId, role: 'BROKER' } });
});
afterAll(async () => prisma.$disconnect());

describe('Slice 2 — Handoff Умар→Азиз и Return to qualification (docs/23 §9, docs/24 §1)', () => {
  it('handoff: сделка меняет владельца на брокера, квалифицируется, пишет timeline и outbox-событие', async () => {
    const d = await createDeal(ctx(['CALL_CENTER'], ccId), { contactName: 'Клиент', contactPhone: '+998901111001' });
    expect([d.stage, d.managerId]).toEqual(['NEW', ccId]);

    const after = await handoffDeal(ctx(['CALL_CENTER'], ccId), d.id, {}, NOW);
    expect(after.managerId).toBe(brokerId); // assignment изменился в реальных данных
    expect(after.stage).toBe('QUALIFIED'); // Умар квалифицировал
    expect(after.nextAction).toMatch(/передано колл-центром/);

    // timeline: активность HANDOFF + outbox-событие адресовано брокеру
    const act = await prisma.unitActivity.findFirst({ where: { dealId: d.id, note: { startsWith: 'HANDOFF' } } });
    expect(act?.actorId).toBe(ccId);
    const ev = await prisma.domainEvent.findFirst({ where: { objectId: d.id, type: 'deal.handoff' } });
    expect((ev?.payload as Record<string, string>).to).toBe(brokerId);

    // у брокера сделка теперь своя (BR-P21)
    const brokerDeals = await listDeals(ctx(['BROKER'], brokerId));
    expect(brokerDeals.some((x) => x.id === d.id)).toBe(true);
  });

  it('return-to-qualification: типизированная причина обязательна, сделка снова у КЦ, timeline фиксирует', async () => {
    const d = await createDeal(ctx(['CALL_CENTER'], ccId), { contactName: 'Возврат', contactPhone: '+998901111002' });
    await handoffDeal(ctx(['CALL_CENTER'], ccId), d.id, {}, NOW);

    // без причины — нельзя (пустая строка не входит в enum)
    await expect(returnToQualification(ctx(['BROKER'], brokerId), d.id, { reason: 'BAD' as never }, NOW)).rejects.toBeInstanceOf(ValidationError);

    const back = await returnToQualification(ctx(['BROKER'], brokerId), d.id, { reason: 'MISSING_DATA', note: 'нет бюджета' }, NOW);
    expect(back.stage).toBe('NEW'); // снова на квалификацию
    expect(back.managerId).toBe(ccId); // снова у колл-центра

    const ret = await prisma.unitActivity.findFirst({ where: { dealId: d.id, note: { startsWith: 'RETURN_TO_QUALIFICATION:MISSING_DATA' } } });
    expect(ret).not.toBeNull();

    // метрика качества КЦ считает возвраты
    expect(await countReturnsToQualification(ctx(['CALL_CENTER'], ccId), 30, NOW)).toBeGreaterThanOrEqual(1);
  });

  it('брокер не возвращает чужую сделку (BR-P21)', async () => {
    const other = (await prisma.user.create({ data: { email: `ho-br2-${Date.now()}@t.test`, fullName: 'Другой Брокер' } })).id;
    await prisma.userTenantRole.create({ data: { tenantId, userId: other, role: 'BROKER' } });
    const d = await createDeal(ctx(['CALL_CENTER'], ccId), { contactName: 'Чужой', contactPhone: '+998901111003' });
    await handoffDeal(ctx(['CALL_CENTER'], ccId), d.id, { brokerId }, NOW); // назначен brokerId
    await expect(returnToQualification(ctx(['BROKER'], other), d.id, { reason: 'OTHER' }, NOW)).rejects.toThrow();
  });
});
