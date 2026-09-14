import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can, formatMoney, money } from '@finance-os/core';
import { listContracts, listVendors } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@/components/ui';
import { createContractAction } from './actions';

export default async function ContractsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations('contracts');
  const contracts = await listContracts(ctx);
  const vendors = can(ctx, 'contract.create') ? await listVendors(ctx) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Table>
        <thead>
          <tr>
            <Th>{t('number')}</Th>
            <Th>{t('counterparty')}</Th>
            <Th>{t('subject')}</Th>
            <Th>{t('limit')}</Th>
            <Th>{t('period')}</Th>
            <Th>{t('statusLabel')}</Th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id}>
              <Td>
                <Link href={`/contracts/${c.id}`} className="text-brand hover:underline">
                  {c.number}
                </Link>
              </Td>
              <Td>{c.vendor?.displayName ?? c.customer?.legalName}</Td>
              <Td>{c.subject}</Td>
              <Td>{c.limitMinor != null ? formatMoney(money(c.limitMinor, c.currency)) : '—'}</Td>
              <Td>
                {c.startDate.toISOString().slice(0, 10)} — {c.endDate?.toISOString().slice(0, 10) ?? '…'}
              </Td>
              <Td>
                <Badge tone={c.status === 'ACTIVE' ? 'green' : c.status === 'EXPIRED' ? 'red' : 'gray'}>
                  {t(`status.${c.status}`)}
                </Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {can(ctx, 'contract.create') ? (
        <Card>
          <h2 className="mb-3 font-medium">{t('new')}</h2>
          <form action={createContractAction} className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="c-number">{t('number')}</Label>
              <Input id="c-number" name="number" required />
            </div>
            <div>
              <Label htmlFor="c-vendor">{t('vendorLabel')}</Label>
              <Select id="c-vendor" name="vendorId" required>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-52 flex-1">
              <Label htmlFor="c-subject">{t('subject')}</Label>
              <Input id="c-subject" name="subject" required />
            </div>
            <div>
              <Label htmlFor="c-limit">{t('limit')}</Label>
              <Input id="c-limit" name="limit" type="number" className="w-36" />
            </div>
            <div>
              <Label htmlFor="c-start">{t('startDate')}</Label>
              <Input id="c-start" name="startDate" type="date" required />
            </div>
            <div>
              <Label htmlFor="c-end">{t('endDate')}</Label>
              <Input id="c-end" name="endDate" type="date" />
            </div>
            <div>
              <Label htmlFor="c-terms">{t('terms')}</Label>
              <div className="flex gap-1">
                <Select id="c-terms" name="termsType" className="w-auto">
                  <option value="POSTPAY_DAYS">POSTPAY_DAYS</option>
                  <option value="PREPAY_PCT">PREPAY_PCT</option>
                  <option value="SCHEDULE">SCHEDULE</option>
                </Select>
                <Input name="termsValue" type="number" defaultValue={14} className="w-20" />
              </div>
            </div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="registrationRequired" /> {t('registrationRequired')}
            </label>
            <Button type="submit">{t('create')}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
