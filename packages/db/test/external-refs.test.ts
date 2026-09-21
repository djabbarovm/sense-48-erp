import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { upsertExternalRef, findExternalRef, setExternalRefStatus, countExternalRefs, listExternalRefs, summarizeExternalRefs } from '../src/services/externalRefs.js';

let tenantId: string; let otherTenantId: string; let adminId: string;
const ctx = (roles: RoleCode[], tid = tenantId) => unsafeCreateTenantContext({ tenantId: tid, tenantSlug: 'er', userId: adminId, roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-er-${ts}`, legalName: 'ER', taxId: '300001101', settings: {} } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { slug: `t-er2-${ts}`, legalName: 'ER2', taxId: '300001102', settings: {} } })).id;
  adminId = (await prisma.user.create({ data: { email: `er-${ts}@t.test`, fullName: 'Админ' } })).id;
});
afterAll(async () => prisma.$disconnect());

describe('ExternalReference — идемпотентность, dedup, изоляция', () => {
  it('upsert идемпотентен: повторный sync обновляет ту же строку, не создаёт дубль', async () => {
    const a = await upsertExternalRef(tenantId, { provider: 'AMOCRM', account: 'rooftophall', entityType: 'lead', externalId: 555, raw: { name: 'Лид v1' }, sourceUpdatedAt: new Date('2026-09-01') });
    const b = await upsertExternalRef(tenantId, { provider: 'AMOCRM', account: 'rooftophall', entityType: 'lead', externalId: '555', raw: { name: 'Лид v2' }, dmsType: 'deal', dmsId: null, sourceUpdatedAt: new Date('2026-09-10') });
    expect(a.id).toBe(b.id); // одна и та же строка
    expect((b.raw as { name: string }).name).toBe('Лид v2'); // обновилось
    expect(await countExternalRefs(tenantId, { provider: 'AMOCRM', entityType: 'lead' })).toBe(1);
  });

  it('findExternalRef возвращает связь по внешнему id (для dedup)', async () => {
    const found = await findExternalRef(tenantId, 'AMOCRM', 'lead', 555);
    expect(found?.externalId).toBe('555');
  });

  it('уникальность по (tenant, provider, entityType, externalId); разные типы — разные строки', async () => {
    await upsertExternalRef(tenantId, { provider: 'AMOCRM', account: 'rooftophall', entityType: 'contact', externalId: 555 });
    expect(await countExternalRefs(tenantId)).toBe(2); // lead 555 + contact 555
  });

  it('tenant-изоляция: тот же externalId в другом тенанте — отдельная строка, не виден чужим', async () => {
    await upsertExternalRef(otherTenantId, { provider: 'AMOCRM', account: 'rooftophall', entityType: 'lead', externalId: 555 });
    expect(await countExternalRefs(tenantId, { entityType: 'lead' })).toBe(1);
    expect(await countExternalRefs(otherTenantId, { entityType: 'lead' })).toBe(1);
    const mineOnly = await listExternalRefs(ctx(['ADMIN']));
    expect(mineOnly.every((r) => r.tenantId === tenantId)).toBe(true);
  });

  it('статус конфликта/ревью проставляется', async () => {
    const ref = await findExternalRef(tenantId, 'AMOCRM', 'contact', 555);
    await setExternalRefStatus(tenantId, ref!.id, 'CONFLICT', 'неоднозначный телефон');
    const after = await findExternalRef(tenantId, 'AMOCRM', 'contact', 555);
    expect([after?.status, after?.note]).toEqual(['CONFLICT', 'неоднозначный телефон']);
  });

  it('UI-чтение требует право tenant.settings', async () => {
    await expect(listExternalRefs(ctx(['BROKER']))).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('summarizeExternalRefs: сводка по сущностям/статусам, tenant-изоляция, право tenant.settings', async () => {
    await expect(summarizeExternalRefs(ctx(['BROKER']))).rejects.toBeInstanceOf(PermissionDeniedError);
    const s = await summarizeExternalRefs(ctx(['ADMIN']), 'AMOCRM');
    expect(s.total).toBe(2); // lead 555 + contact 555 в этом тенанте
    expect(s.byEntity.find((e) => e.entityType === 'lead')?.count).toBe(1);
    expect(s.byEntity.find((e) => e.entityType === 'contact')?.count).toBe(1);
    expect(s.byStatus.find((x) => x.status === 'CONFLICT')?.count).toBe(1);
    expect(s.lastSyncedAt).toBeInstanceOf(Date);
  });
});
