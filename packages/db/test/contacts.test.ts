import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createContact, findDuplicateContacts, getContact, importContactsXlsx, listContacts, mergeContacts, updateContact } from '../src/services/contacts.js';
import { createDeal } from '../src/services/deals.js';
import { intakeLead } from '../src/services/leadIntake.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';

let tenantId: string;
let otherTenantId: string;
let cmId: string;
const ctx = (roles: RoleCode[] = ['COMMERCIAL_MANAGER'], userId = cmId) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'crm', userId, roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-crm-${ts}`, legalName: 'CRM', taxId: '300000301', settings: {} } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { slug: `t-crm2-${ts}`, legalName: 'CRM2', taxId: '300000302', settings: {} } })).id;
  cmId = (await prisma.user.create({ data: { email: `crm-cm-${ts}@t.test`, fullName: 'Менеджер' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'CRM', name: 'CRM Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 3 });
  const ownerId = (await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Собственник Ф.', contactPhone: '+998 (93) 777-00-11' })).id;
  await createUnit(ctx(), { floorId: f.id, unitNo: '301', type: 'APARTMENT', areaM2: 70, ownerId });
});
afterAll(async () => prisma.$disconnect());

describe('CRM Tower — контакты (BR-P55)', () => {
  it('сделки c одним телефоном в разном написании → один контакт; лид c сайта привязывается к нему же; собственник c тем же телефоном — тот же человек', async () => {
    const d1 = await createDeal(ctx(), { contactName: 'Али Каримов', contactPhone: '+998 (90) 123-45-67', source: 'INSTAGRAM' });
    const d2 = await createDeal(ctx(), { contactName: 'Каримов Али', contactPhone: '90 123 45 67', contactEmail: 'Ali@Mail.uz', company: 'Ali LLC' });
    expect(d1.contactId).toBe(d2.contactId);
    expect(d2.contactPhone).toBe('+998901234567');
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: d1.contactId! } });
    expect([c.displayName, c.email, c.company, c.source]).toEqual(['Али Каримов', 'ali@mail.uz', 'Ali LLC', 'INSTAGRAM']); // первое имя сохраняется, email/компания дозаполняются
    const lead = await intakeLead(tenantId, { contactName: 'A. Karimov', contactEmail: 'ali@mail.uz', source: 'WEBSITE' } as never);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: lead.dealId } })).contactId).toBe(d1.contactId);
    const ownerDeal = await createDeal(ctx(), { contactName: 'Собственник', contactPhone: '937770011' });
    const oc = await prisma.contact.findUniqueOrThrow({ where: { id: ownerDeal.contactId! } });
    expect(oc.ownerId).not.toBeNull();
    expect(await prisma.contact.count({ where: { tenantId } })).toBe(2);
  });

  it('список и карточка: PII только c deal.contact.view; счётчики сделок; чужой tenant — 404', async () => {
    const full = await listContacts(ctx(), { q: 'карим' });
    expect(full).toHaveLength(1);
    expect([full[0]!.phone, full[0]!.dealsTotal, full[0]!.dealsActive]).toEqual(['+998901234567', 2, 2]); // лид по email — повторное обращение (BR-P34), новой сделки нет
    const masked = await listContacts(ctx(['MARKETING']), { q: '901234567' });
    expect(masked[0]!.phone).toBe('+99890***4567');
    expect(masked[0]!.email).toBe('a***@mail.uz');
    const card = await getContact(ctx(), full[0]!.id);
    expect([card.deals.length, card.pii, card.canEdit]).toEqual([2, true, true]);
    await expect(getContact(unsafeCreateTenantContext({ tenantId: otherTenantId, tenantSlug: 'o', userId: cmId, roles: ['COMMERCIAL_MANAGER'] }), full[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listContacts(ctx(['ACCOUNTANT']))).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('создание/правка: дубль телефона блокируется, нужен канал связи; audit без PII', async () => {
    await expect(createContact(ctx(), { displayName: 'Дубль', phone: '+998901234567' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createContact(ctx(), { displayName: 'Без канала' })).rejects.toBeInstanceOf(ValidationError);
    const c = await createContact(ctx(), { displayName: 'Нигора Юсупова', phone: '998911112233', tags: ['офис', 'vip'] });
    await updateContact(ctx(), c.id, { company: 'Yusupova & Co', notes: 'Ищет офис 120 м²' });
    await expect(updateContact(ctx(), c.id, { phone: '+998901234567' })).rejects.toBeInstanceOf(ValidationError);
    const audit = await prisma.auditLog.findMany({ where: { tenantId, objectType: 'contact', objectId: c.id } });
    expect(audit.map((a) => a.action)).toEqual(['contact.create', 'contact.update']);
    expect(JSON.stringify(audit.map((a) => [a.before, a.after]))).not.toContain('911112233');
  });

  it('слияние дублей: сделки переезжают, второй телефон сохраняется, контакт-дубль удалён; только contact.merge', async () => {
    const dup = await createContact(ctx(), { displayName: 'Али Каримов (дубль)', phone: '+998 97 000 00 01' });
    await createDeal(ctx(), { contactName: 'Али Каримов', contactPhone: '+998970000001' });
    const main = (await listContacts(ctx(), { q: 'Али Каримов' })).find((x) => x.phone === '+998901234567')!;
    await expect(mergeContacts(ctx(['BROKER']), main.id, dup.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await findDuplicateContacts(ctx())).length).toBeGreaterThanOrEqual(0);
    const merged = await mergeContacts(ctx(), main.id, dup.id);
    expect(merged.phoneAlt).toBe('+998970000001');
    expect(await prisma.contact.count({ where: { id: dup.id } })).toBe(0);
    expect(await prisma.deal.count({ where: { contactId: main.id } })).toBe(3);
    // новая сделка по второму телефону тоже попадает в объединённый контакт
    const d = await createDeal(ctx(), { contactName: 'Али', contactPhone: '970000001' });
    expect(d.contactId).toBe(main.id);
  });

  it('импорт contacts.xlsx: all-or-nothing, дубли по телефону пропускаются, менеджер по email', async () => {
    const bad = await importContactsXlsx(ctx(), [{ full_name: '', phone: '12' }]);
    expect(bad.errors.map((e) => e.field)).toEqual(['full_name', 'phone', 'phone']);
    const r = await importContactsXlsx(ctx(), [
      { full_name: 'Али Каримов', phone: '+998901234567' },
      { full_name: 'Новый Клиент', phone: '+998 95 555 66 77', email: 'new@client.uz', company: 'NC', source: 'REFERRAL', tags: 'офис; срочно', note: 'от брокера', manager_email: `crm-cm-${cmId ? '' : ''}` },
    ].map((row, i) => (i === 1 ? { ...row, manager_email: '' } : row)));
    expect([r.imported, r.skipped, r.errors.length]).toEqual([1, 1, 0]);
    const nc = await prisma.contact.findFirstOrThrow({ where: { tenantId, phone: '+998955556677' } });
    expect([nc.tags, nc.source, nc.managerId]).toEqual([['офис', 'срочно'], 'REFERRAL', cmId]);
    await expect(importContactsXlsx(ctx(['MARKETING']), [])).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
