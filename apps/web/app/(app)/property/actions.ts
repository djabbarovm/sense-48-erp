'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CommercialStatus, LeaseStatus, OccupancyStatus, OperationalStatus, ReadinessStatus, RentalMode, UnitActivityKind } from '@finance-os/db';
import { PermissionDeniedError, ValidationError } from '@finance-os/core';
import { addUnitActivity, changeUnitStatus, setUnitPublished, updateUnitPricing } from '@finance-os/db';
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

/** Ошибки домена показываем на карточке (?error=CODE), остальное — error boundary. */
async function run(unitId: string, fn: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else throw e;
  }
  revalidatePath(`/property/units/${unitId}`);
  revalidatePath('/property');
  redirect(`/property/units/${unitId}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

export async function changeUnitStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = String(formData.get('unitId'));
  const leaseEnds = str(formData, 'leaseEndsAt');
  await run(unitId, () =>
    changeUnitStatus(ctx, unitId, {
      ...(str(formData, 'readiness') ? { readiness: str(formData, 'readiness') as ReadinessStatus } : {}),
      ...(str(formData, 'occupancy') ? { occupancy: str(formData, 'occupancy') as OccupancyStatus } : {}),
      ...(str(formData, 'rentalMode') ? { rentalMode: str(formData, 'rentalMode') as RentalMode } : {}),
      ...(str(formData, 'leaseStatus') ? { leaseStatus: str(formData, 'leaseStatus') as LeaseStatus } : {}),
      ...(str(formData, 'commercialStatus') ? { commercialStatus: str(formData, 'commercialStatus') as CommercialStatus } : {}),
      ...(str(formData, 'operationalStatus') ? { operationalStatus: str(formData, 'operationalStatus') as OperationalStatus } : {}),
      ...(formData.has('occupantName') ? { occupantName: str(formData, 'occupantName') ?? null } : {}),
      ...(formData.has('leaseEndsAt') ? { leaseEndsAt: leaseEnds ? new Date(leaseEnds) : null } : {}),
      ...(usdMinor(formData, 'monthlyRent') !== undefined ? { monthlyRentMinor: usdMinor(formData, 'monthlyRent') ?? null } : {}),
      ...(str(formData, 'reason') ? { reason: str(formData, 'reason') as string } : {}),
      override: formData.get('override') === 'on',
      source: 'UI',
    }).then(() => undefined),
  );
}

export async function updateUnitPricingAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = String(formData.get('unitId'));
  await run(unitId, () =>
    updateUnitPricing(ctx, unitId, {
      ...(usdMinor(formData, 'askingRate') !== undefined ? { askingRateMinor: usdMinor(formData, 'askingRate') ?? null } : {}),
      ...(usdMinor(formData, 'minApprovedRate') !== undefined ? { minApprovedRateMinor: usdMinor(formData, 'minApprovedRate') ?? null } : {}),
      ...(usdMinor(formData, 'salePrice') !== undefined ? { salePriceMinor: usdMinor(formData, 'salePrice') ?? null } : {}),
    }).then(() => undefined),
  );
}

export async function setUnitPublishedAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = String(formData.get('unitId'));
  const published = formData.get('published') === '1';
  await run(unitId, () => setUnitPublished(ctx, unitId, published).then(() => undefined));
}

export async function addUnitActivityAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = String(formData.get('unitId'));
  const followUp = str(formData, 'followUpAt');
  await run(unitId, () =>
    addUnitActivity(ctx, unitId, {
      kind: (str(formData, 'kind') ?? 'NOTE') as UnitActivityKind,
      note: str(formData, 'note') ?? '',
      expectedRateMinor: usdMinor(formData, 'expectedRate') ?? null,
      followUpAt: followUp ? new Date(followUp) : null,
      source: 'UI',
    }).then(() => undefined),
  );
}
