'use server';

import { revalidatePath } from 'next/cache';
import type { VerificationMethod } from '@finance-os/db';
import {
  blockVendor,
  changeBankAccount,
  createVendor,
  unblockVendor,
  verifyBankStep1,
  verifyBankStep2,
  verifyVendor,
} from '@finance-os/db';
import { redirect } from 'next/navigation';
import { requireTenantContext } from '@/lib/session';

export async function createVendorAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const displayName = String(formData.get('displayName') ?? '');
  const vendor = await createVendor(ctx, {
    taxId: String(formData.get('taxId') ?? ''),
    legalName: String(formData.get('legalName') ?? ''),
    ...(displayName ? { displayName } : {}),
    contactName: String(formData.get('contactName') ?? '') || null,
    contactPhone: String(formData.get('contactPhone') ?? '') || null,
    requiresContract: formData.get('requiresContract') === 'on',
    relatedParty: formData.get('relatedParty') === 'on',
  });
  redirect(`/vendors/${vendor.id}`);
}

export async function changeBankAccountAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const vendorId = String(formData.get('vendorId'));
  await changeBankAccount(ctx, vendorId, {
    bankName: String(formData.get('bankName') ?? ''),
    mfo: String(formData.get('mfo') ?? ''),
    account: String(formData.get('account') ?? ''),
    currency: String(formData.get('currency') ?? 'UZS'),
  });
  revalidatePath(`/vendors/${vendorId}`);
}

export async function verifyBankStep1Action(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await verifyBankStep1(
    ctx,
    String(formData.get('accountId')),
    String(formData.get('method')) as VerificationMethod,
  );
  revalidatePath(`/vendors/${String(formData.get('vendorId'))}`);
}

export async function verifyBankStep2Action(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await verifyBankStep2(ctx, String(formData.get('accountId')));
  revalidatePath(`/vendors/${String(formData.get('vendorId'))}`);
}

export async function verifyVendorAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await verifyVendor(ctx, String(formData.get('vendorId')));
  revalidatePath(`/vendors/${String(formData.get('vendorId'))}`);
}

export async function blockVendorAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await blockVendor(ctx, String(formData.get('vendorId')), String(formData.get('reason') ?? ''));
  revalidatePath(`/vendors/${String(formData.get('vendorId'))}`);
}

export async function unblockVendorAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await unblockVendor(ctx, String(formData.get('vendorId')));
  revalidatePath(`/vendors/${String(formData.get('vendorId'))}`);
}
