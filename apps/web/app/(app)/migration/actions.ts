'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createStorageFromEnv, parseDidoxRegistryExport, parseFloorPlan, parseMigrationSheet, parseOnecCounterparties, parseOnecOsv, parseOnecStaff } from '@finance-os/adapters';
import type { FloorPlanReport, MigrationReport, NativeImportReport } from '@finance-os/db';
import {
  importBudgetsXlsx,
  importContractsXlsx,
  importEmployeesXlsx,
  importFloorPlan,
  importInventoryXlsx,
  importOpenApXlsx,
  importOpenArXlsx,
  importVendorsXlsx,
  importDidoxExport,
  importOnecCounterparties,
  importOnecOsv,
  importOnecStaff,
  prisma,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

import { NATIVE_TYPES, type MigrationType, type NativeType } from './types';

export type { MigrationType };

const IMPORTERS: Record<Exclude<MigrationType, 'floorplan' | NativeType>, typeof importVendorsXlsx> = {
  vendors: importVendorsXlsx,
  contracts: importContractsXlsx,
  open_ap: importOpenApXlsx,
  open_ar: importOpenArXlsx,
  employees: importEmployeesXlsx,
  budgets: importBudgetsXlsx,
  inventory: importInventoryXlsx,
};

export interface MigrationState {
  type?: MigrationType;
  report?: MigrationReport;
  notes?: string[];
  warnings?: string[];
  floorPlan?: FloorPlanReport & { warnings: string[] };
  error?: string;
}

export async function importMigrationAction(_prev: MigrationState, formData: FormData): Promise<MigrationState> {
  const ctx = await requireTenantContext();
  const type = String(formData.get('type')) as MigrationType;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { type, error: 'NO_FILE' };
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (type === 'floorplan') {
      // P-08: JSON/SVG план этажа → геометрия юнитов (all-or-nothing, версия этажа растёт)
      const format = /\.svg$/i.test(file.name) ? 'svg' : 'json';
      const { spec, warnings } = parseFloorPlan(buffer.toString('utf8'), format);
      const buildingCode = String(formData.get('buildingCode') ?? '').trim() || spec.buildingCode || '';
      const floorNo = Number(String(formData.get('floorNo') ?? '').trim() || spec.floorNo);
      if (!buildingCode || !Number.isInteger(floorNo)) return { type, error: 'FLOOR_REQUIRED' };
      const fp = await importFloorPlan(ctx, { buildingCode, floorNo, viewBox: spec.viewBox, units: spec.units });
      revalidatePath('/property');
      return { type, floorPlan: { ...fp, warnings } };
    }
    let report: MigrationReport;
    let notes: string[] = [];
    let warnings: string[] = [];
    if ((NATIVE_TYPES as string[]).includes(type)) {
      // H-09: родные выгрузки 1С / Didox — парсер адаптера → сервис импорта (all-or-nothing внутри)
      const me = (await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } }))?.email ?? '';
      let native: NativeImportReport;
      if (type === 'onec_counterparties') {
        const parsed = parseOnecCounterparties(buffer);
        warnings = parsed.warnings;
        native = await importOnecCounterparties(ctx, parsed.rows, { categoryCode: String(formData.get('categoryCode') ?? '').trim(), businessOwnerEmail: me });
      } else if (type === 'onec_osv') native = await importOnecOsv(ctx, parseOnecOsv(buffer));
      else if (type === 'onec_staff') native = await importOnecStaff(ctx, parseOnecStaff(buffer).rows);
      else {
        const parsed = parseDidoxRegistryExport(buffer);
        warnings = parsed.warnings;
        native = await importDidoxExport(ctx, parsed.rows, { ownerEmail: me });
      }
      ({ notes, ...report } = native);
    } else {
      const sheet = parseMigrationSheet(buffer);
      report = await IMPORTERS[type as Exclude<MigrationType, 'floorplan' | NativeType>](ctx, sheet.rows);
    }
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
    return { type, report, notes, warnings };
  } catch (error) {
    return { type, error: error instanceof Error ? error.message : String(error) };
  }
}
