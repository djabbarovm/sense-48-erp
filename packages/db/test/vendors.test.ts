import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  RISK_BANK_CHANGED,
  RISK_NEW,
  blockVendor,
  changeBankAccount,
  createVendor,
  getVendor360,
  revealBankAccount,
  unblockVendor,
  verifyBankStep1,
  verifyBankStep2,
  verifyVendor,
} from '../src/services/vendors.js';

process.env.BANK_DATA_KEY = randomBytes(32).toString('base64');

let tenantId: string;
let otherTenantId: string;
const uid = () => crypto.randomUUID();
const leadId = uid();
const lead2Id = uid();
const juniorId = uid();
const ownerId = uid();
const requesterId = uid();

const ctx = (userId: string, ...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId, roles });

const lead = () => ctx(leadId, 'FINANCE_OPS_LEAD');
const lead2 = () => ctx(lead2Id, 'FINANCE_OPS_LEAD');
const junior = () => ctx(juniorId, 'JUNIOR_FINANCE');
const owner = () => ctx(ownerId, 'OWNER');
const requester = () => ctx(requesterId, 'REQUESTER');

let taxSeq = 310_000_000;
const nextTax = () => String(taxSeq++);

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b01-${ts}`, legalName: 'B01', taxId: '300000010' } })
  ).id;
  otherTenantId = (
    await prisma.tenant.create({ data: { slug: `t-b01b-${ts}`, legalName: 'B01b', taxId: '300000011' } })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('B-01 Vendor (BR-030…034)', () => {
  it('создание: PENDING_VERIFICATION + risk flag NEW, audit', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: 'ООО «Тест Фуд»' });
    expect(v.status).toBe('PENDING_VERIFICATION');
    expect(v.riskFlags).toContain(RISK_NEW);
    expect(
      await prisma.auditLog.count({ where: { tenantId, action: 'vendor.create', objectId: v.id } }),
    ).toBe(1);
  });

  it('REQUESTER может создать (→PENDING), но не может редактировать', async () => {
    const v = await createVendor(requester(), { taxId: nextTax(), legalName: 'Новый поставщик' });
    expect(v.status).toBe('PENDING_VERIFICATION');
    const { updateVendor } = await import('../src/services/vendors.js');
    await expect(updateVendor(requester(), v.id, { legalName: 'X' })).rejects.toThrow(PermissionDeniedError);
  });

  it('BR-034: дубль ИНН среди не-BLOCKED отклоняется со ссылкой', async () => {
    const tax = nextTax();
    const first = await createVendor(junior(), { taxId: tax, legalName: 'Первый' });
    await expect(createVendor(junior(), { taxId: tax, legalName: 'Второй' })).rejects.toThrow(first.id);
  });

  it('BR-030: смена реквизитов → новая UNVERIFIED, старая RETIRED, флаг, Task VERIFY_BANK', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: 'Банк Тест' });
    const acc1 = '20208000900000000001';
    const first = await changeBankAccount(junior(), v.id, {
      bankName: 'Trustbank',
      mfo: '00444',
      account: acc1,
    });
    expect(first.account.status).toBe('UNVERIFIED');
    expect(first.account.accountMasked).toBe('****0001');
    expect(first.account.accountEncrypted).not.toContain(acc1);
    expect(first.task.type).toBe('VERIFY_BANK');
    // первый счёт: флага BANK_CHANGED нет (ничего не менялось)
    let vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(vendor.riskFlags).not.toContain(RISK_BANK_CHANGED);

    // верифицируем и меняем
    await verifyBankStep1(junior(), first.account.id, 'CALLBACK');
    await verifyBankStep2(lead(), first.account.id);
    const second = await changeBankAccount(junior(), v.id, {
      bankName: 'DIBank',
      mfo: '00555',
      account: '20208000900000000002',
    });
    const old = await prisma.vendorBankAccount.findUniqueOrThrow({ where: { id: first.account.id } });
    expect(old.status).toBe('RETIRED');
    expect(old.isDefault).toBe(false);
    expect(second.account.status).toBe('UNVERIFIED');
    vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(vendor.riskFlags).toContain(RISK_BANK_CHANGED);
  });

  it('BR-032: оба шага верификации одним пользователем → SOD_VIOLATION', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: 'SOD Тест' });
    const { account } = await changeBankAccount(junior(), v.id, {
      bankName: 'Bank',
      mfo: '00444',
      account: '20208000900000000003',
    });
    await verifyBankStep1(lead(), account.id, 'DOCUMENT');
    await expect(verifyBankStep2(lead(), account.id)).rejects.toThrow(/другой пользователь/);
    // другой лид — ок; Task закрывается
    const verified = await verifyBankStep2(lead2(), account.id);
    expect(verified.status).toBe('VERIFIED');
    expect(verified.isDefault).toBe(true);
    expect(
      await prisma.task.count({ where: { tenantId, objectId: account.id, status: 'OPEN' } }),
    ).toBe(0);
    // step2 без step1 невозможен
    const v2 = await createVendor(junior(), { taxId: nextTax(), legalName: 'SOD2' });
    const { account: acc2 } = await changeBankAccount(junior(), v2.id, {
      bankName: 'Bank',
      mfo: '00444',
      account: '20208000900000000004',
    });
    await expect(verifyBankStep2(lead(), acc2.id)).rejects.toThrow(/STEP1/);
  });

  it('vendor verify: только после VERIFIED счёта, не создателем', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: 'Активация' });
    await expect(verifyVendor(lead(), v.id)).rejects.toThrow(/VERIFIED/);
    const { account } = await changeBankAccount(junior(), v.id, {
      bankName: 'Bank',
      mfo: '00444',
      account: '20208000900000000005',
    });
    await verifyBankStep1(junior(), account.id, 'CALLBACK');
    await verifyBankStep2(lead(), account.id);
    const active = await verifyVendor(lead(), v.id);
    expect(active.status).toBe('ACTIVE');
    // самоверификация создателем запрещена
    const v2 = await createVendor(lead(), { taxId: nextTax(), legalName: 'Сам себе' });
    await expect(verifyVendor(lead(), v2.id)).rejects.toThrow(/другой сотрудник/);
  });

  it('block/unblock: причина обязательна, unblock только OWNER', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: 'Блок' });
    await expect(blockVendor(lead(), v.id, '')).rejects.toThrow(/REASON/);
    await blockVendor(lead(), v.id, 'Подозрение на фрод');
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('BLOCKED');
    await expect(unblockVendor(lead(), v.id)).rejects.toThrow(/Owner/);
    const un = await unblockVendor(owner(), v.id);
    expect(un.status).toBe('ACTIVE');
  });

  it('BR-074: reveal — только с правом, пишет audit, возвращает полный номер', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: 'Reveal' });
    const full = '20208000912345678901';
    const { account } = await changeBankAccount(junior(), v.id, {
      bankName: 'Bank',
      mfo: '00444',
      account: full,
    });
    await expect(revealBankAccount(junior(), account.id)).rejects.toThrow(PermissionDeniedError);
    const revealed = await revealBankAccount(lead(), account.id);
    expect(revealed).toBe(full);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, action: 'vendor.bank_account.reveal', objectId: account.id },
      }),
    ).toBe(1);
  });

  it('cross-tenant: vendor чужого tenant → 404', async () => {
    const foreign = await prisma.vendor.create({
      data: { tenantId: otherTenantId, taxId: '319999999', legalName: 'F', displayName: 'F' },
    });
    await expect(getVendor360(lead(), foreign.id)).rejects.toThrow(NotFoundError);
  });

  it('getVendor360 не отдаёт accountEncrypted', async () => {
    const v = await createVendor(junior(), { taxId: nextTax(), legalName: '360' });
    await changeBankAccount(junior(), v.id, {
      bankName: 'Bank',
      mfo: '00444',
      account: '20208000900000000006',
    });
    const dto = await getVendor360(lead(), v.id);
    expect(dto.bankAccounts[0]).not.toHaveProperty('accountEncrypted');
    expect(dto.tasks.length).toBeGreaterThan(0);
  });
});
