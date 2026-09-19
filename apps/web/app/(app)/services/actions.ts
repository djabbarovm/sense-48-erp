'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ServiceCategory, ServiceChannel, ServiceCustomerKind, ServiceInvolvement, ServiceProviderKind, ServiceTerms } from '@finance-os/db';
import { IllegalTransitionError, NotFoundError, PermissionDeniedError, ValidationError, type ServiceOrderTrigger } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { cancelServicePackage, createCatalogItem, createServiceOrder, createServicePackage, importPartnerStatement, rateServiceOrder, recordHandling, transitionServiceOrder, updateCatalogItem, uploadDocument } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
/** Сумма в мажорных единицах (сум/доллары) → minor (тийины/центы). */
const toMinor = (v: string | undefined): bigint | undefined => {
  if (v === undefined) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError('AMOUNT_INVALID');
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
};

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
  revalidatePath('/services');
  revalidatePath('/property/today');
  revalidatePath(target);
  redirect(`${target}${error ? `${target.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}

export async function createServiceOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = str(formData, 'unitId') ?? null;
  const back = str(formData, 'back') ?? (unitId ? `/property/units/${unitId}` : '/services');
  await run(back, async () => {
    const o = await createServiceOrder(ctx, {
      catalogItemId: str(formData, 'catalogItemId') ?? '',
      unitId,
      buildingId: str(formData, 'buildingId') ?? null,
      quantity: Number(str(formData, 'quantity') ?? '1'),
      customerName: str(formData, 'customerName') ?? null,
      notes: str(formData, 'notes') ?? null,
      scheduledAt: str(formData, 'scheduledAt') ? new Date(str(formData, 'scheduledAt')!) : null,
      assigneeId: str(formData, 'assigneeId') ?? null,
      ...(str(formData, 'channel') ? { channel: str(formData, 'channel') as ServiceChannel } : {}),
      customerKind: (str(formData, 'customerKind') ?? null) as ServiceCustomerKind | null,
    });
    return `/services/${o.id}`;
  });
}

export async function transitionServiceOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await run(`/services/${id}`, () =>
    transitionServiceOrder(ctx, id, String(formData.get('trigger')) as ServiceOrderTrigger, {
      ...(str(formData, 'assigneeId') ? { assigneeId: str(formData, 'assigneeId')! } : {}),
      ...(str(formData, 'reason') ? { reason: str(formData, 'reason')! } : {}),
    }).then(() => undefined),
  );
}

export async function uploadServiceProofAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  const file = formData.get('file');
  await run(`/services/${id}`, async () => {
    if (!(file instanceof File) || file.size === 0) throw new ValidationError('FILE_EMPTY');
    const docType = /^image\//.test(file.type) ? 'OTHER' : 'ACT';
    await uploadDocument(ctx, createStorageFromEnv(), { objectType: 'service_order', objectId: id, docType, fileName: file.name, mime: file.type, body: Buffer.from(await file.arrayBuffer()) });
  });
}

export async function rateServiceOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await run(`/services/${id}`, () => rateServiceOrder(ctx, id, Number(str(formData, 'rating') ?? '0'), str(formData, 'comment') ?? null).then(() => undefined));
}

export async function createCatalogItemAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/services?view=catalog', async () => {
    await createCatalogItem(ctx, {
      code: (str(formData, 'code') ?? '').toUpperCase(),
      name: str(formData, 'name') ?? '',
      category: (str(formData, 'category') ?? 'OTHER') as ServiceCategory,
      providerKind: (str(formData, 'providerKind') ?? 'OWN_OPS') as ServiceProviderKind,
      partnerName: str(formData, 'partnerName') ?? null,
      priceMinor: toMinor(str(formData, 'price')) ?? 0n,
      currency: str(formData, 'currency') ?? 'UZS',
      commissionBp: Math.round(Number(str(formData, 'commissionPct') ?? '0') * 100),
      slaHours: Number(str(formData, 'slaHours') ?? '48'),
      description: str(formData, 'description') ?? null,
      terms: (str(formData, 'terms') ?? 'COMMISSION_PER_ORDER') as ServiceTerms,
      involvement: (str(formData, 'involvement') ?? 'MANAGED') as ServiceInvolvement,
      clientDiscountBp: Math.round(Number(str(formData, 'discountPct') ?? '0') * 100),
      ownOpsFeeBp: str(formData, 'ownOpsFeePct') ? Math.round(Number(str(formData, 'ownOpsFeePct')) * 100) : null,
      forMall: formData.get('forMall') === 'on',
    });
  });
}

export async function recordHandlingAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await run(`/services/${id}`, () => recordHandling(ctx, id, { addMinutes: Number(str(formData, 'addMinutes') ?? '0'), ...(formData.has('complaintFlag') ? { complaint: formData.get('complaint') === 'on', complaintNote: str(formData, 'complaintNote') ?? null } : {}) }).then(() => undefined));
}

export async function createPackageAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/services?view=packages', () => createServicePackage(ctx, { catalogItemId: str(formData, 'catalogItemId') ?? '', unitId: str(formData, 'unitId') ?? '', customerName: str(formData, 'customerName') ?? null, customerKind: (str(formData, 'customerKind') ?? 'RESIDENT') as ServiceCustomerKind, runsPerMonth: Number(str(formData, 'runsPerMonth') ?? '4'), monthlyPriceMinor: toMinor(str(formData, 'monthly')) ?? 0n, ...(str(formData, 'startAt') ? { startAt: new Date(str(formData, 'startAt')!) } : {}) }).then(() => undefined));
}

export async function cancelPackageAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/services?view=packages', () => cancelServicePackage(ctx, String(formData.get('id')), str(formData, 'reason') ?? '').then(() => undefined));
}

export async function importStatementAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/services?view=analytics', async () => {
    const r = await importPartnerStatement(ctx, { partnerName: str(formData, 'partnerName') ?? '', period: str(formData, 'period') ?? '', csv: String(formData.get('csv') ?? '') });
    return `/services?view=analytics&imported=${r.imported}&skipped=${r.skipped}&fee=${r.feeMinor.toString()}`;
  });
}

export async function toggleCatalogItemAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/services?view=catalog', () => updateCatalogItem(ctx, String(formData.get('id')), { active: formData.get('active') === 'true' }).then(() => undefined));
}
