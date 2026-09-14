import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, ROLE_CODES } from '@finance-os/core';
import { listCategories, listCostCenters, listTenantUsers, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@/components/ui';
import {
  grantRoleAction,
  revokeRoleAction,
  saveTenantSettingsAction,
  upsertCategoryAction,
  upsertCostCenterAction,
} from './actions';

const CATEGORY_GROUPS = [
  'FNB',
  'SPA',
  'CLEANING',
  'MARKETING',
  'PAYROLL',
  'UTILITIES',
  'RENT',
  'CAPEX',
  'TAX',
  'ADMIN',
  'OTHER',
] as const;

export default async function AdminPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'tenant.settings')) notFound();
  const t = await getTranslations('admin');

  const [tenant, users, costCenters, categories] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    listTenantUsers(ctx),
    listCostCenters(ctx),
    listCategories(ctx),
  ]);
  const settings = tenant.settings as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      <Card>
        <h2 className="mb-3 font-medium">{t('tenantSettings')}</h2>
        <form action={saveTenantSettingsAction} className="grid max-w-xl grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="legalName">{t('legalName')}</Label>
            <Input id="legalName" name="legalName" defaultValue={tenant.legalName} required />
          </div>
          <div>
            <Label htmlFor="taxId">{t('taxId')}</Label>
            <Input id="taxId" name="taxId" defaultValue={tenant.taxId} required />
          </div>
          <div>
            <Label htmlFor="vatRateBp">{t('vatRate')}</Label>
            <Input id="vatRateBp" name="vatRateBp" type="number" defaultValue={tenant.vatRateBp} />
          </div>
          <div>
            <Label htmlFor="cutoffTime">{t('cutoffTime')}</Label>
            <Input
              id="cutoffTime"
              name="cutoffTime"
              defaultValue={typeof settings.cutoff_time === 'string' ? settings.cutoff_time : '14:00'}
            />
          </div>
          <div>
            <Label htmlFor="timezone">{t('timezone')}</Label>
            <Input id="timezone" name="timezone" defaultValue={tenant.timezone} />
          </div>
          <div className="col-span-2">
            <SubmitButton />
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">{t('users')}</h2>
        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>{t('name')}</Th>
              <Th>{t('role')}</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user.id}>
                <Td>{u.user.email}</Td>
                <Td>{u.user.fullName}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    {u.roles.map((role) => (
                      <form key={role} action={revokeRoleAction} className="inline-flex items-center gap-1">
                        <input type="hidden" name="userId" value={u.user.id} />
                        <input type="hidden" name="role" value={role} />
                        <Badge tone="blue">{role}</Badge>
                        <Button type="submit" variant="ghost" className="px-1 py-0 text-xs">
                          ×
                        </Button>
                      </form>
                    ))}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <form action={grantRoleAction} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="grant-email">Email</Label>
            <Input id="grant-email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="grant-role">{t('role')}</Label>
            <Select id="grant-role" name="role">
              {ROLE_CODES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">{t('addUser')}</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">{t('costCenters')}</h2>
        <Table>
          <thead>
            <tr>
              <Th>{t('code')}</Th>
              <Th>{t('name')}</Th>
              <Th>{t('active')}</Th>
            </tr>
          </thead>
          <tbody>
            {costCenters.map((cc) => (
              <tr key={cc.id}>
                <Td>{cc.code}</Td>
                <Td>{cc.name}</Td>
                <Td>{cc.isActive ? <Badge tone="green">✓</Badge> : <Badge tone="gray">—</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <form action={upsertCostCenterAction} className="mt-3 flex items-end gap-2">
          <div>
            <Label htmlFor="cc-code">{t('code')}</Label>
            <Input id="cc-code" name="code" required />
          </div>
          <div className="flex-1">
            <Label htmlFor="cc-name">{t('name')}</Label>
            <Input id="cc-name" name="name" required />
          </div>
          <Button type="submit">{t('addCostCenter')}</Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">{t('categories')}</h2>
        <Table>
          <thead>
            <tr>
              <Th>{t('code')}</Th>
              <Th>{t('name')}</Th>
              <Th>{t('group')}</Th>
              <Th>{t('slaDays')}</Th>
              <Th>{t('accountCode')}</Th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <Td>{c.code}</Td>
                <Td>{c.name}</Td>
                <Td>{c.group}</Td>
                <Td>{c.closingDocSlaDays}</Td>
                <Td>{c.accountCode}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <form action={upsertCategoryAction} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="cat-code">{t('code')}</Label>
            <Input id="cat-code" name="code" required />
          </div>
          <div className="flex-1">
            <Label htmlFor="cat-name">{t('name')}</Label>
            <Input id="cat-name" name="name" required />
          </div>
          <div>
            <Label htmlFor="cat-group">{t('group')}</Label>
            <Select id="cat-group" name="group">
              {CATEGORY_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cat-sla">{t('slaDays')}</Label>
            <Input id="cat-sla" name="closingDocSlaDays" type="number" defaultValue={10} className="w-24" />
          </div>
          <Button type="submit">{t('addCategory')}</Button>
        </form>
      </Card>
    </div>
  );
}

async function SubmitButton() {
  const t = await getTranslations('common');
  return <Button type="submit">{t('save')}</Button>;
}
