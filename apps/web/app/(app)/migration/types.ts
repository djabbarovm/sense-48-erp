export type MigrationType = 'vendors' | 'contracts' | 'open_ap' | 'open_ar' | 'employees' | 'budgets' | 'inventory' | 'floorplan' | 'contacts' | 'onec_counterparties' | 'onec_osv' | 'onec_staff' | 'didox_registry';
export type NativeType = 'onec_counterparties' | 'onec_osv' | 'onec_staff' | 'didox_registry';
/** H-09: родные выгрузки 1С / Didox (без шаблона) */
export const NATIVE_TYPES: NativeType[] = ['onec_counterparties', 'onec_osv', 'onec_staff', 'didox_registry'];
