'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createStorageFromEnv, parseMigrationSheet } from '@finance-os/adapters';
import type { MigrationReport } from '@finance-os/db';
import {
  importBudgetsXlsx,
  importContractsXlsx,
  importEmployeesXlsx,
  importOpenApXlsx,
  importOpenArXlsx,
  importVendorsXlsx,
  prisma,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export type MigrationType = 'vendors' | 'contracts' | 'open_ap' | 'open_ar' | 'employees' | 'budgets';

const IMPORTERS: Record<MigrationType, typeof importVendorsXlsx> = {
  vendors: importVendorsXlsx,
  contracts: importContractsXlsx,
  open_ap: importOpenApXlsx,
  open_ar: importOpenArXlsx,
  employees: importEmployeesXlsx,
  budgets: importBudgetsXlsx,
};

export interface MigrationState {
  type?: MigrationType;
  report?: MigrationReport;
  error?: string;
}

export async function importMigrationAction(_prev: MigrationState, formData: FormData): Promise<MigrationState> {
  const ctx = await requireTenantContext();
  const type = String(formData.get('type')) as MigrationType;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { type, error: 'NO_FILE' };
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sheet = parseMigrationSheet(buffer);
    const report = await IMPORTERS[type](ctx, sheet.rows);
    // файл миграции сохраняется как Document (templates/README.md)
    if (report.errors.length === 0 && report.imported > 0) {
      const fileKey = `${ctx.tenantId}/migration/${type}-${Date.now()}.xlsx`;
      await createStorageFromEnv().put(fileKey, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await prisma.document.create({
        data: {
          tenantId: ctx.tenantId,
          objectType: 'migration',
          objectId: ctx.tenantId,
          docType: 'OTHER',
          fileKey,
          fileName: file.name,
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: buffer.length,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          uploadedBy: ctx.userId,
          status: 'RECEIVED',
        },
      });
    }
    revalidatePath('/migration');
    return { type, report };
  } catch (error) {
    return { type, error: error instanceof Error ? error.message : String(error) };
  }
}
