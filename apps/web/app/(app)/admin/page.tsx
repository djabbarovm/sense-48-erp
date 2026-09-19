import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, ROLE_CODES } from '@finance-os/core';
import { TELEPHONY_PROVIDERS } from '@finance-os/adapters';
import { getTelephonySettings, listCategories, listCostCenters, listTenantUsers, prisma } from '@finance-os/db';
import Link from 'next/link';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, Select, Table, Td, Th } from '@/components/ui';
import {
  grantRoleAction,
  createUserAction,
  revokeRoleAction,
  saveTelephonySettingsAction,
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

  const [tenant, users, costCenters, categories, telephony] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    listTenantUsers(ctx),
    listCostCenters(ctx),
    listCategories(ctx),
    getTelephonySettings(ctx.tenantId),
  ]);
  const settings = tenant.settings as Record<string, unknown>;
  const emailById = new Map(users.map((u) => [u.user.id, u.user.email]));
  const extMapText = Object.entries(telephony.extMap).map(([ext, userId]) => `${ext} = ${emailById.get(userId) ?? userId}`).join('\n');
  const webhookUrl = `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/api/telephony/webhook`;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : t('telephony.none'));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        {can(ctx, 'apikey.manage') ? <Link href="/admin/api-keys" className="text-sm font-medium text-brand-600 hover:underline">{t('apiKeys')}</Link> : null}
      </div>

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
        <h2 className="mb-1 font-medium">{t('telephony.title')}</h2>
        <p className="mb-3 text-sm text-gray-600">{t('telephony.intro')}</p>
        <form action={saveTelephonySettingsAction} className="grid max-w-2xl grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tel-provider">{t('telephony.provider')}</Label>
            <Select id="tel-provider" name="provider" defaultValue={telephony.provider}>
              {TELEPHONY_PROVIDERS.map((p) => (<option key={p} value={p}>{t(`telephony.provider${p === 'onlinepbx' ? 'Onlinepbx' : 'Generic'}`)}</option>))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tel-tz">{t('telephony.tzOffset')}</Label>
            <Input id="tel-tz" name="tzOffset" defaultValue={telephony.tzOffset} pattern="[+-]\d{2}:\d{2}" />
          </div>
          <div>
            <Label htmlFor="tel-extlen">{t('telephony.internalExtLen')}</Label>
            <Input id="tel-extlen" name="internalExtLen" type="number" min={1} max={6} defaultValue={telephony.internalExtLen} />
          </div>
          <div>
            <Label htmlFor="tel-url">{t('telephony.webhookUrl')}</Label>
            <Input id="tel-url" readOnly value={webhookUrl} className="font-mono text-xs" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="tel-extmap">{t('telephony.extMap')}</Label>
            <textarea id="tel-extmap" name="extMap" rows={3} defaultValue={extMapText} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-volt-500/60" />
            <p className="mt-1 text-xs text-gray-500">{t('telephony.extMapHint')}</p>
          </div>
          <div className="col-span-2">
            <Label htmlFor="tel-fieldmap">{t('telephony.fieldMap')}</Label>
            <textarea id="tel-fieldmap" name="fieldMap" rows={2} defaultValue={telephony.fieldMap ? JSON.stringify(telephony.fieldMap) : ''} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs shadow-sm focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-volt-500/60" />
            <p className="mt-1 text-xs text-gray-500">{t('telephony.fieldMapHint')}</p>
          </div>
          <div className="col-span-2 text-xs text-gray-600">
            <p>{t('telephony.webhookHint')}</p>
            <p className="mt-1">{t('telephony.lastWebhook')}: <span className="font-medium">{fmt(telephony.lastWebhookAt)}</span></p>
            <p>{t('telephony.lastUnparsed')}: <span className="font-mono">{telephony.lastUnparsed ? `${telephony.lastUnparsed.keys.join(', ')} (${fmt(telephony.lastUnparsed.at)})` : t('telephony.none')}</span></p>
          </div>
          <div className="col-span-2"><Button type="submit">{t('telephony.save')}</Button></div>
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
        <h2 className="mb-1 font-medium">{t('createUser.title')}</h2>
        <p className="mb-3 text-sm text-gray-600">{t('createUser.hint')}</p>
        <form action={createUserAction} className="grid max-w-2xl grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cu-name">{t('name')}</Label>
            <Input id="cu-name" name="fullName" required />
          </div>
          <div>
            <Label htmlFor="cu-username">{t('createUser.username')}</Label>
            <Input id="cu-username" name="username" placeholder="umar" autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="cu-pass">{t('createUser.tempPassword')}</Label>
            <Input id="cu-pass" name="tempPassword" required minLength={8} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="cu-role">{t('role')}</Label>
            <Select id="cu-role" name="newRole">
              {ROLE_CODES.map((r) => (<option key={r} value={r}>{r}</option>))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label htmlFor="cu-email">{t('createUser.emailOptional')}</Label>
            <Input id="cu-email" name="newEmail" type="text" autoComplete="off" />
          </div>
          <div className="col-span-2"><Button type="submit">{t('createUser.submit')}</Button></div>
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
