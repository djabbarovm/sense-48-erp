import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { MockEdoAdapter, buildRegistryXlsx } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import {
  applyEdoStatus,
  createInvoice,
  disputeInvoice,
  importEdoRegistry,
  matchInvoice,
  matchSuggestions,
  resolveDuplicate,
} from '../src/services/invoices.js';

let tenantId: string;
let vendorId: string;
const TENANT_TAX = '300000018';
const VENDOR_TAX = '311110003';

const junior = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['JUNIOR_FINANCE'] });
const lead = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });

let n = 0;
const num = () => `INV-${Date.now()}-${n++}`;

const base = (number: string, date = new Date('2026-09-10')) => ({
  vendorId,
  number,
  date,
  amountNetMinor: 1_000_000_00n,
  vatMinor: 120_000_00n,
  amountGrossMinor: 1_120_000_00n,
  backdatedReason: 'тестовые данные за прошлый период',
});

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b08-${ts}`, legalName: 'B08', taxId: TENANT_TAX } })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: VENDOR_TAX, legalName: 'FOOD SUPPLY', displayName: 'FOOD SUPPLY', status: 'ACTIVE' },
    })
  ).id;
});

afterAll(async () => prisma.$disconnect());

describe('B-08 Invoice (BR-002/004/024/025/037)', () => {
  it('BR-002: повторный (vendor, number, date) → DUPLICATE_SUSPECT + Task; resolve NOT_DUPLICATE → RECEIVED', async () => {
    const invNum = num();
    const first = await createInvoice(junior(), base(invNum));
    expect(first.status).toBe('RECEIVED');
    const second = await createInvoice(junior(), base(invNum));
    expect(second.status).toBe('DUPLICATE_SUSPECT');
    expect(second.duplicateOfId).toBe(first.id);
    expect(
      await prisma.task.count({ where: { tenantId, objectId: second.id, type: 'REVIEW_EXCEPTION', status: 'OPEN' } }),
    ).toBe(1);
    // junior не может resolve
    await expect(resolveDuplicate(junior(), second.id, 'NOT_DUPLICATE', 'корректировочная')).rejects.toThrow();
    const resolved = await resolveDuplicate(lead(), second.id, 'NOT_DUPLICATE', 'корректировочная');
    expect(resolved.status).toBe('RECEIVED');
    expect(
      await prisma.task.count({ where: { tenantId, objectId: second.id, status: 'OPEN' } }),
    ).toBe(0);
  });

  it('BR-002: confirm duplicate → CANCELLED', async () => {
    const invNum = num();
    await createInvoice(junior(), base(invNum));
    const dup = await createInvoice(junior(), base(invNum));
    const cancelled = await resolveDuplicate(lead(), dup.id, 'CONFIRM_DUPLICATE');
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('BR-025: документ старше 30 дней без reason отклоняется', async () => {
    await expect(
      createInvoice(junior(), { ...base(num(), new Date('2026-01-01')), backdatedReason: null }),
    ).rejects.toThrow(/BR-025|backdated/);
  });

  it('match к PR: vendor mismatch блокируется, успех переводит PR → INVOICED', async () => {
    const otherVendor = await prisma.vendor.create({
      data: { tenantId, taxId: '311110004', legalName: 'O', displayName: 'O', status: 'ACTIVE' },
    });
    const cc = await prisma.costCenter.create({ data: { tenantId, code: `C${n}`, name: 'C' } });
    const cat = await prisma.category.create({ data: { tenantId, code: `K${n}`, name: 'K', group: 'FNB' } });
    const pr = await prisma.purchaseRequest.create({
      data: {
        tenantId,
        number: `PR-B08-${Date.now()}`,
        requesterId: crypto.randomUUID(),
        what: 'x',
        purpose: 'p',
        totalMinor: 1_120_000_00n,
        costCenterId: cc.id,
        categoryId: cat.id,
        vendorId,
        status: 'APPROVED',
        tier: 1,
      },
    });
    const wrongInv = await createInvoice(junior(), { ...base(num()), vendorId: otherVendor.id });
    await expect(matchInvoice(junior(), wrongInv.id, { prId: pr.id })).rejects.toThrow(/VENDOR_MISMATCH|не совпадает/);

    const inv = await createInvoice(junior(), base(num()));
    const suggestions = await matchSuggestions(junior(), inv.id);
    expect(suggestions.prs.some((s) => s.pr.id === pr.id && s.confidence >= 0.8)).toBe(true);
    const matched = await matchInvoice(junior(), inv.id, { prId: pr.id });
    expect(matched.status).toBe('MATCHED');
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('INVOICED');
  });

  it('BR-037: dispute создаёт Task', async () => {
    const inv = await createInvoice(junior(), base(num()));
    const disputed = await disputeInvoice(junior(), inv.id, 'ИНН в СФ не совпадает с ИНН vendor');
    expect(disputed.status).toBe('DISPUTED');
    expect(await prisma.task.count({ where: { tenantId, objectId: inv.id, status: 'OPEN' } })).toBe(1);
  });

  it('BR-024: edo CORRECTED → статус + Task', async () => {
    const inv = await createInvoice(junior(), base(num()));
    const after = await applyEdoStatus(junior(), inv.id, 'CORRECTED');
    expect(after.status).toBe('CORRECTED');
    expect(after.edoStatus).toBe('CORRECTED');
    expect(
      await prisma.task.count({
        where: { tenantId, objectId: inv.id, type: 'REVIEW_EXCEPTION', status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('импорт реестра ЭДО: vendor auto-create PENDING, buyer mismatch → error row, идемпотентность', async () => {
    const adapter = new MockEdoAdapter();
    const mk = (over: Partial<Parameters<typeof buildRegistryXlsx>[0][number]>) => ({
      edoDocumentId: `DX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'SF',
      number: num(),
      date: '2026-09-10',
      sellerTaxId: VENDOR_TAX,
      sellerName: 'FOOD SUPPLY',
      buyerTaxId: TENANT_TAX,
      amountNet: '1000000',
      vat: '120000',
      amountGross: '1120000',
      currency: 'UZS',
      status: 'SIGNED',
      ...over,
    });
    const rows = [
      mk({}),
      mk({ sellerTaxId: '319999901', sellerName: 'ООО «Новый Поставщик»' }),
      mk({ buyerTaxId: '300099999' }), // чужой покупатель → error
    ];
    const file = buildRegistryXlsx(rows);
    const parsed = adapter.parseRegistry(file);
    expect(parsed).toHaveLength(3);
    const report = await importEdoRegistry(junior(), parsed);
    expect(report.imported).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.field).toBe('buyer_tax_id');
    const newVendor = await prisma.vendor.findFirst({ where: { tenantId, taxId: '319999901' } });
    expect(newVendor?.status).toBe('PENDING_VERIFICATION');
    expect(report.createdTasks.length).toBe(1);
    // повторный импорт → skip
    const again = await importEdoRegistry(junior(), parsed);
    expect(again.skipped).toBe(2);
    expect(again.imported).toBe(0);
  });
});
