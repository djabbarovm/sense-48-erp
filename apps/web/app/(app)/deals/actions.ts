'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { DealLostReason, DealProduct, DealSource, TenantCategory, UnitActivityKind, ReturnReason } from '@finance-os/db';
import { NotFoundError, PermissionDeniedError, ValidationError, IllegalTransitionError } from '@finance-os/core';
import { activateLease, addDealActivity, closeSale, confirmKpi, createDeal, createLease, createProposal, markChecklistItem, moveDeal, returnToQualification, updateDeal } from '@finance-os/db';
import { KPI_CHECKLIST_ITEMS } from '@finance-os/core';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
const usdMinor = (fd: FormData, k: string): bigint | null | undefined => {
  const v = str(fd, k);
  if (v === undefined) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError('AMOUNT_INVALID');
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
};
const date = (fd: FormData, k: string): Date | null | undefined => (fd.has(k) ? (str(fd, k) ? new Date(str(fd, k)!) : null) : undefined);

async function run(back: string, fn: () => Promise<string | void>): Promise<never> {
  let error: string | null = null;
  let target = back;
  try {
    const r = await fn();
    if (r) target = r;
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError || e instanceof IllegalTransitionError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/deals');
  revalidatePath('/commissions');
  revalidatePath('/bonuses');
  revalidatePath('/property');
  revalidatePath(target);
  redirect(`${target}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

function dealInput(fd: FormData) {
  return {
    ...(str(fd, 'contactName') !== undefined ? { contactName: str(fd, 'contactName')! } : {}),
    ...(fd.has('contactPhone') ? { contactPhone: str(fd, 'contactPhone') ?? null } : {}),
    ...(fd.has('contactEmail') ? { contactEmail: str(fd, 'contactEmail') ?? null } : {}),
    ...(fd.has('company') ? { company: str(fd, 'company') ?? null } : {}),
    ...(str(fd, 'source') ? { source: str(fd, 'source') as DealSource } : {}),
    ...(usdMinor(fd, 'budget') !== undefined ? { budgetMinor: usdMinor(fd, 'budget') ?? null } : {}),
    ...(fd.has('areaMin') ? { areaMinM2: str(fd, 'areaMin') ? Number(str(fd, 'areaMin')) : null } : {}),
    ...(fd.has('areaMax') ? { areaMaxM2: str(fd, 'areaMax') ? Number(str(fd, 'areaMax')) : null } : {}),
    ...(fd.has('purpose') ? { purpose: str(fd, 'purpose') ?? null } : {}),
    ...(fd.has('timing') ? { timing: str(fd, 'timing') ?? null } : {}),
    ...(fd.has('unitId') ? { unitId: str(fd, 'unitId') ?? null } : {}),
    ...(str(fd, 'managerId') ? { managerId: str(fd, 'managerId')! } : {}),
    ...(fd.has('nextAction') ? { nextAction: str(fd, 'nextAction') ?? null } : {}),
    ...(date(fd, 'nextActionAt') !== undefined ? { nextActionAt: date(fd, 'nextActionAt') ?? null } : {}),
    ...(usdMinor(fd, 'expectedRate') !== undefined ? { expectedRateMinor: usdMinor(fd, 'expectedRate') ?? null } : {}),
    ...(date(fd, 'reservedUntil') !== undefined ? { reservedUntil: date(fd, 'reservedUntil') ?? null } : {}),
    ...(fd.has('depositReceivedFlag') ? { depositReceived: fd.get('depositReceived') === 'on' } : {}),
    ...(str(fd, 'product') ? { product: str(fd, 'product') as DealProduct } : {}),
    ...(usdMinor(fd, 'salePrice') !== undefined ? { salePriceMinor: usdMinor(fd, 'salePrice') ?? null } : {}),
    ...(fd.has('commissionRatePct') ? { commissionRateBp: str(fd, 'commissionRatePct') ? Math.round(Number(str(fd, 'commissionRatePct')) * 100) : null } : {}),
    ...(fd.has('externalBrokerName') ? { externalBrokerName: str(fd, 'externalBrokerName') ?? null } : {}),
    ...(fd.has('tenantCategory') ? { tenantCategory: (str(fd, 'tenantCategory') ?? null) as TenantCategory | null } : {}),
    ...(fd.has('externalSharePct') ? { externalShareBp: str(fd, 'externalSharePct') ? Math.round(Number(str(fd, 'externalSharePct')) * 100) : 0 } : {}),
  };
}

export async function closeSaleAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const dealId = String(formData.get('dealId'));
  await run(`/deals/${dealId}`, () => closeSale(ctx, dealId, { salePriceMinor: usdMinor(formData, 'salePrice') ?? 0n }).then(() => undefined));
}

export async function checklistAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const dealId = String(formData.get('dealId'));
  const item = String(formData.get('item'));
  // DUE_DILIGENCE — гейт этапа перед CONTRACT (ТЗ §5.1), не отмечается как KPI-пункт: принимаем только 5 KPI-пунктов
  if (!(KPI_CHECKLIST_ITEMS as readonly string[]).includes(item)) return;
  await run(`/deals/${dealId}`, () => markChecklistItem(ctx, dealId, item as (typeof KPI_CHECKLIST_ITEMS)[number], formData.get('done') === '1', str(formData, 'note') ?? null).then(() => undefined));
}

export async function confirmKpiAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const dealId = String(formData.get('dealId'));
  await run(`/deals/${dealId}`, () => confirmKpi(ctx, dealId).then(() => undefined));
}

export async function createDealAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/deals/new', async () => {
    const d = await createDeal(ctx, { contactName: str(formData, 'contactName') ?? '', ...dealInput(formData) });
    return `/deals/${d.id}`;
  });
}

export async function updateDealAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('dealId'));
  await run(`/deals/${id}`, () => updateDeal(ctx, id, dealInput(formData)).then(() => undefined));
}

export async function moveDealAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('dealId'));
  const trigger = String(formData.get('trigger')) as 'advance' | 'back' | 'lose' | 'reopen';
  await run(`/deals/${id}`, () =>
    moveDeal(ctx, id, trigger, { ...(str(formData, 'lostReason') ? { lostReason: str(formData, 'lostReason') as DealLostReason } : {}), ...(str(formData, 'lostNote') ? { lostNote: str(formData, 'lostNote')! } : {}) }).then(() => undefined),
  );
}

export async function addDealActivityAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('dealId'));
  await run(`/deals/${id}`, () =>
    addDealActivity(ctx, id, { kind: (str(formData, 'kind') ?? 'NOTE') as UnitActivityKind, note: str(formData, 'note') ?? '', expectedRateMinor: usdMinor(formData, 'expectedRate') ?? null, followUpAt: date(formData, 'followUpAt') ?? null }).then(() => undefined),
  );
}

/** Договор из сделки: DRAFT + активация одним шагом = выигрыш сделки (BR-P23). */
export async function createLeaseFromDealAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const dealId = String(formData.get('dealId'));
  const unitId = String(formData.get('unitId'));
  await run(`/deals/${dealId}`, async () => {
    const lease = await createLease(ctx, {
      unitId,
      dealId,
      type: (str(formData, 'type') ?? 'LTR') as 'LTR' | 'STR' | 'OWNER_USE',
      occupantName: str(formData, 'occupantName') ?? '',
      occupantContact: str(formData, 'occupantContact') ?? null,
      startAt: new Date(str(formData, 'startAt') ?? ''),
      endAt: date(formData, 'endAt') ?? null,
      rentMinor: usdMinor(formData, 'rent') ?? 0n,
      depositMinor: usdMinor(formData, 'deposit') ?? null,
      depositReceived: formData.get('depositReceived') === 'on',
      tenantCategory: (str(formData, 'tenantCategory') ?? null) as TenantCategory | null,
    });
    if (formData.get('activate') === 'on') await activateLease(ctx, lease.id);
    return `/property/units/${unitId}`;
  });
}

/** P-28: коммерческое предложение — подборка до 6 помещений по ссылке без входа. */
export async function createProposalAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('dealId'));
  const unitIds = formData.getAll('unitIds').map(String).filter(Boolean);
  await run(`/deals/${id}`, () => createProposal(ctx, id, { unitIds, note: str(formData, 'note') ?? null, validDays: Number(str(formData, 'validDays') ?? 7) || 7 }).then(() => undefined));
}

/** Slice 2: брокер возвращает сделку на переквалификацию с типизированной причиной (docs/24 §1). */
export async function returnToQualificationAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('dealId'));
  const reason = str(formData, 'reason') as ReturnReason | undefined;
  const note = str(formData, 'note');
  await run(`/deals/${id}`, () => returnToQualification(ctx, id, { reason: reason as ReturnReason, ...(note ? { note } : {}) }).then(() => undefined));
}
