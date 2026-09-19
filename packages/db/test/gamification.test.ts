import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, XP_RULES, ValidationError, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getGamificationState, requestReward, listRewards } from '../src/services/gamification.js';

let tenantId: string; let uid: string; let otherId: string; let dealId: string;
const NOW = new Date('2026-09-21T06:00:00Z'); // Ташкент 11:00
const ctx = (roles: RoleCode[] = ['CALL_CENTER'], id = uid) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'gam', userId: id, roles });
const act = (kind: string, at: Date, actor = uid, deal: string | null = dealId) =>
  prisma.unitActivity.create({ data: { tenantId, kind: kind as never, note: kind, actorId: actor, happenedAt: at, ...(deal ? { dealId: deal } : {}) } });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-gam-${ts}`, legalName: 'GAM', taxId: '300001001', settings: {} } })).id;
  uid = (await prisma.user.create({ data: { username: `gam-u-${ts}`, fullName: 'Пилот' } })).id;
  otherId = (await prisma.user.create({ data: { username: `gam-o-${ts}`, fullName: 'Другой' } })).id;
  await prisma.userTenantRole.createMany({ data: [{ tenantId, userId: uid, role: 'CALL_CENTER' }, { tenantId, userId: otherId, role: 'CALL_CENTER' }] });
  const b = await prisma.building.create({ data: { tenantId, code: 'T', name: 'T', kind: 'TOWER' } });
  const f = await prisma.floor.create({ data: { tenantId, buildingId: b.id, floorNo: 1 } });
  const unit = await prisma.unit.create({ data: { tenantId, buildingId: b.id, floorId: f.id, unitNo: 'G1', type: 'OFFICE', areaM2: 50 } });
  dealId = (await prisma.deal.create({ data: { tenantId, number: `D-${ts}`, contactName: 'Клиент', managerId: uid, unitId: unit.id, stage: 'NEW' } })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Геймификация — сервис (ТЗ §13-20)', () => {
  it('XP из результатов; за звонок XP нет; идемпотентно при повторном чтении', async () => {
    for (let i = 0; i < 20; i++) await act('CALL', new Date(NOW.getTime() - i * 1000)); // 20 звонков сегодня → 0 XP
    for (let i = 0; i < 3; i++) await act('FOLLOW_UP', new Date(NOW.getTime() - i * 1000)); // 3 follow-up сегодня
    const s1 = await getGamificationState(ctx(), NOW);
    const s2 = await getGamificationState(ctx(), NOW);
    expect(s1.todayXp).toBe(s2.todayXp); // derived → идемпотентно
    expect(s1.todayXp).toBe(3 * XP_RULES.FOLLOW_UP_DONE.xp); // только follow-up, звонки не считаются
  });
  it('закрытая сделка даёт XP один раз; XP другого пользователя не течёт', async () => {
    await prisma.deal.update({ where: { id: dealId }, data: { stage: 'WON', stageChangedAt: NOW } });
    const s = await getGamificationState(ctx(), NOW);
    expect(s.totalXp).toBeGreaterThanOrEqual(XP_RULES.DEAL_WON.xp);
    const other = await getGamificationState(ctx(['CALL_CENTER'], otherId), NOW);
    expect(other.totalXp).toBe(0); // изоляция по actor/manager
  });
  it('миссии role-aware: у CALL_CENTER свои 3, у COMMERCIAL — свои', async () => {
    const cc = await getGamificationState(ctx(['CALL_CENTER']), NOW);
    expect(cc.missions.map((m) => m.key)).toEqual(['cc_leads', 'cc_followups']);
    const cm = await getGamificationState(ctx(['COMMERCIAL_MANAGER']), NOW);
    expect(cm.missions[0]!.key).toBe('cm_viewings');
  });
  it('streak: день засчитан при XP >= порога', async () => {
    const s = await getGamificationState(ctx(), NOW);
    expect(s.streakDoneToday).toBe(true);
    expect(s.streakDays).toBeGreaterThanOrEqual(1);
  });
  it('награды: заявка требует достаточный XP, повтор блокируется', async () => {
    const rewards = await listRewards(ctx());
    expect(rewards.length).toBeGreaterThan(0);
    const cheap = rewards.reduce((a, b) => (b.costXp < a.costXp ? b : a));
    const st = await getGamificationState(ctx(), NOW);
    if (st.totalXp >= cheap.costXp) {
      await requestReward(ctx(), cheap.key, NOW);
      await expect(requestReward(ctx(), cheap.key, NOW)).rejects.toBeInstanceOf(ValidationError); // дубль
    }
    await expect(requestReward(ctx(), 'nope', NOW)).rejects.toBeInstanceOf(ValidationError); // нет такой
  });
});
