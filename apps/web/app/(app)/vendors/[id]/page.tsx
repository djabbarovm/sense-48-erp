import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NotFoundError, can } from '@finance-os/core';
import { getVendor360 } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@/components/ui';
import {
  blockVendorAction,
  changeBankAccountAction,
  unblockVendorAction,
  verifyBankStep1Action,
  verifyBankStep2Action,
  verifyVendorAction,
} from '../actions';

const STATUS_TONE = { ACTIVE: 'green', BLOCKED: 'red', PENDING_VERIFICATION: 'yellow' } as const;
const ACC_TONE = { UNVERIFIED: 'yellow', VERIFIED: 'green', RETIRED: 'gray' } as const;

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const t = await getTranslations('vendors');
  const tc = await getTranslations('common');

  let data: Awaited<ReturnType<typeof getVendor360>>;
  try {
    data = await getVendor360(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { vendor, bankAccounts, tasks } = data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{vendor.displayName}</h1>
        <Badge tone={STATUS_TONE[vendor.status]}>{t(`status.${vendor.status}`)}</Badge>
        {vendor.riskFlags.map((f) => (
          <Badge key={f} tone="red">
            {f}
          </Badge>
        ))}
      </div>

      <Card>
        <h2 className="mb-2 font-medium">{t('profile')}</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <dt className="text-gray-500">{t('taxId')}</dt>
          <dd>{vendor.taxId}</dd>
          <dt className="text-gray-500">{t('contact')}</dt>
          <dd>
            {vendor.contactName} {vendor.contactPhone}
          </dd>
          <dt className="text-gray-500">{t('requiresContract')}</dt>
          <dd>{vendor.requiresContract ? '✓' : '—'}</dd>
        </dl>
        <div className="mt-3 flex gap-2">
          {vendor.status === 'PENDING_VERIFICATION' && can(ctx, 'vendor.block') ? (
            <form action={verifyVendorAction}>
              <input type="hidden" name="vendorId" value={vendor.id} />
              <Button type="submit">{t('verify')}</Button>
            </form>
          ) : null}
          {vendor.status !== 'BLOCKED' && can(ctx, 'vendor.block') ? (
            <form action={blockVendorAction} className="flex items-end gap-2">
              <input type="hidden" name="vendorId" value={vendor.id} />
              <div>
                <Label htmlFor="block-reason">{t('blockReason')}</Label>
                <Input id="block-reason" name="reason" required />
              </div>
              <Button type="submit" variant="danger">
                {t('block')}
              </Button>
            </form>
          ) : null}
          {vendor.status === 'BLOCKED' && can(ctx, 'vendor.block') ? (
            <form action={unblockVendorAction}>
              <input type="hidden" name="vendorId" value={vendor.id} />
              <Button type="submit" variant="outline">
                {t('unblock')}
              </Button>
            </form>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">{t('bankAccounts')}</h2>
        <Table>
          <thead>
            <tr>
              <Th>{t('bank')}</Th>
              <Th>{t('mfo')}</Th>
              <Th>{t('account')}</Th>
              <Th>{t('statusLabel')}</Th>
              <Th>{tc('actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {bankAccounts.map((acc) => (
              <tr key={acc.id}>
                <Td>{acc.bankName}</Td>
                <Td>{acc.mfo}</Td>
                <Td>
                  {acc.accountMasked}
                  {acc.isDefault ? ' ★' : ''}
                </Td>
                <Td>
                  <Badge tone={ACC_TONE[acc.status]}>{t(`accountStatus.${acc.status}`)}</Badge>
                </Td>
                <Td>
                  {acc.status === 'UNVERIFIED' ? (
                    <div className="flex flex-wrap gap-2">
                      {!acc.verifyStep1By && can(ctx, 'vendor.bank.verify_step1') ? (
                        <form action={verifyBankStep1Action} className="flex items-center gap-1">
                          <input type="hidden" name="accountId" value={acc.id} />
                          <input type="hidden" name="vendorId" value={vendor.id} />
                          <Select name="method" className="w-auto">
                            <option value="CALLBACK">CALLBACK</option>
                            <option value="DOCUMENT">DOCUMENT</option>
                            <option value="DUAL_APPROVAL">DUAL_APPROVAL</option>
                          </Select>
                          <Button type="submit" variant="outline">
                            {t('verifyStep1')}
                          </Button>
                        </form>
                      ) : null}
                      {acc.verifyStep1By && can(ctx, 'vendor.bank.verify_step2') ? (
                        <form action={verifyBankStep2Action}>
                          <input type="hidden" name="accountId" value={acc.id} />
                          <input type="hidden" name="vendorId" value={vendor.id} />
                          <Button type="submit">{t('verifyStep2')}</Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>

        {can(ctx, 'vendor.bank.change') ? (
          <form action={changeBankAccountAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="vendorId" value={vendor.id} />
            <div>
              <Label htmlFor="ba-bank">{t('bank')}</Label>
              <Input id="ba-bank" name="bankName" required />
            </div>
            <div>
              <Label htmlFor="ba-mfo">{t('mfo')}</Label>
              <Input id="ba-mfo" name="mfo" required pattern="\d{5}" className="w-24" />
            </div>
            <div className="min-w-64 flex-1">
              <Label htmlFor="ba-acc">{t('accountFull')}</Label>
              <Input id="ba-acc" name="account" required pattern="\d{20}" />
            </div>
            <Button type="submit">{t('changeBank')}</Button>
          </form>
        ) : null}
      </Card>

      {tasks.length > 0 ? (
        <Card>
          <h2 className="mb-2 font-medium">{t('openTasks')}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {tasks.map((task) => (
              <li key={task.id}>
                <Badge tone="yellow">{task.type}</Badge> {task.nextAction}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
