import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { can } from '@finance-os/core';
import { listVendors } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Table, Td, Th } from '@/components/ui';
import { createVendorAction } from './actions';

const STATUS_TONE = { ACTIVE: 'green', BLOCKED: 'red', PENDING_VERIFICATION: 'yellow' } as const;

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireTenantContext();
  const { q } = await searchParams;
  const t = await getTranslations('vendors');
  const vendors = await listVendors(ctx, q ? { search: q } : undefined);

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} />
      <form className="max-w-sm">
        <Input name="q" defaultValue={q ?? ''} placeholder="…" aria-label={t('name')} />
      </form>
      <Table>
        <thead>
          <tr>
            <Th>{t('name')}</Th>
            <Th>{t('taxId')}</Th>
            <Th>{t('statusLabel')}</Th>
            <Th>{t('flags')}</Th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) => (
            <tr key={v.id}>
              <Td>
                <Link href={`/vendors/${v.id}`} className="text-brand hover:underline">
                  {v.displayName}
                </Link>
              </Td>
              <Td>{v.taxId}</Td>
              <Td>
                <Badge tone={STATUS_TONE[v.status]}>{t(`status.${v.status}`)}</Badge>
              </Td>
              <Td className="space-x-1">
                {v.riskFlags.map((f) => (
                  <Badge key={f} tone="red" dot>
                    {f}
                  </Badge>
                ))}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {can(ctx, 'vendor.create') ? (
        <Card>
          <h2 className="mb-3 font-medium">{t('new')}</h2>
          <form action={createVendorAction} className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="v-tax">{t('taxId')}</Label>
              <Input id="v-tax" name="taxId" required pattern="\d{9}" />
            </div>
            <div className="min-w-64 flex-1">
              <Label htmlFor="v-name">{t('name')}</Label>
              <Input id="v-name" name="legalName" required />
            </div>
            <div>
              <Label htmlFor="v-contact">{t('contact')}</Label>
              <Input id="v-contact" name="contactPhone" />
            </div>
            <Button type="submit">{t('create')}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
