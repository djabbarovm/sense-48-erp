import type { RoleCode } from '../context/index.js';

/**
 * Матрица прав из docs/05-rbac.md. Это source of truth для requirePermission()
 * и для заполнения таблиц Permission/RolePermission (syncPermissions в db).
 *
 * Нюансы область-видимости («свои», «T1», «если cost_center_owner», «только имя»)
 * матрица не выражает — их проверяет доменная логика соответствующей фичи;
 * здесь — базовый грант роли.
 */
export const PERMISSION_MATRIX = {
  // ── Master data ──
  'vendor.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN'],
  'vendor.create': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'REQUESTER'],
  'vendor.edit': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER'],
  'vendor.block': ['OWNER', 'FINANCE_OPS_LEAD'],
  'vendor.bank.reveal': ['OWNER', 'FINANCE_OPS_LEAD', 'ACCOUNTANT'],
  'vendor.bank.change': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER'],
  'vendor.bank.verify_step1': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'vendor.bank.verify_step2': ['OWNER', 'FINANCE_OPS_LEAD'],
  'vendor.merge': ['ADMIN'],
  'contract.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN'],
  'contract.create': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER'],
  'contract.edit': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER'],
  'contract.approve': ['OWNER', 'FINANCE_OPS_LEAD'],
  'contract.terminate': ['OWNER'],
  'customer.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN'],
  'customer.create': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'REQUESTER', 'ADMIN'],
  'customer.edit': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ADMIN'],
  'costcenter.manage': ['ADMIN'],
  'category.manage': ['ADMIN'],
  'employee.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'ADMIN'],
  'employee.manage': ['FINANCE_OPS_LEAD', 'ACCOUNTANT', 'ADMIN'],
  // ── P2P ──
  'pr.create': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'REQUESTER'],
  'pr.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN'],
  'pr.approve.business': ['OWNER', 'FINANCE_OPS_LEAD', 'REQUESTER'],
  'pr.approve.finance': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'pr.approve.owner': ['OWNER'],
  'pr.cancel': ['OWNER', 'FINANCE_OPS_LEAD', 'REQUESTER'],
  'po.manage': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'receipt.create': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'REQUESTER'],
  'invoice.create': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT'],
  'invoice.import': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT'],
  'invoice.match': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER'],
  'invoice.resolve_duplicate': ['FINANCE_OPS_LEAD'],
  'document.upload': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'OPERATIONS_MANAGER', 'COMMERCIAL_MANAGER'],
  'document.mark_received': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER'],
  // ── Payments ──
  'payment.create': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'payment.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN'],
  'payment.exception.approve': ['OWNER', 'FINANCE_OPS_LEAD'],
  'payment.urgent.approve': ['OWNER', 'FINANCE_OPS_LEAD'],
  'payment.cancel': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'batch.create': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'batch.edit': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'batch.freeze': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'batch.unfreeze': ['FINANCE_OPS_LEAD'],
  'batch.review': ['FINANCE_OPS_LEAD'],
  'batch.approve': ['OWNER', 'FINANCE_OPS_LEAD'],
  'batch.export': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'batch.mark_sent': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  'bank.import': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT'],
  'bank.reconcile.manual': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT'],
  'bank.account.manage': ['ADMIN'],
  'advance.close': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT'],
  'advance.write_off': ['OWNER'],
  // ── AR / Events ──
  'event.create': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'REQUESTER'],
  'event.edit': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'REQUESTER'],
  'event.confirm': ['OWNER', 'FINANCE_OPS_LEAD', 'REQUESTER'],
  'event.close': ['FINANCE_OPS_LEAD'],
  'ar.invoice.manage': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER'],
  'ar.dispute': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'REQUESTER'],
  // ── Compliance / close ──
  'tax.calculate': ['FINANCE_OPS_LEAD', 'ACCOUNTANT'],
  'tax.approve': ['OWNER', 'FINANCE_OPS_LEAD'],
  'tax.file': ['ACCOUNTANT'],
  'payroll.prepare': ['FINANCE_OPS_LEAD', 'ACCOUNTANT'],
  'payroll.approve': ['OWNER', 'FINANCE_OPS_LEAD'],
  'close.run': ['FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT'],
  'accounting.export_1c': ['FINANCE_OPS_LEAD', 'ACCOUNTANT'],
  'accounting.mark_posted': ['ACCOUNTANT'],
  // ── Reporting ──
  'dashboard.owner': ['OWNER', 'FINANCE_OPS_LEAD'],
  'dashboard.ops': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'ADMIN'],
  'report.export': ['OWNER', 'FINANCE_OPS_LEAD', 'ACCOUNTANT'],
  'budget.manage': ['OWNER', 'FINANCE_OPS_LEAD'],
  // ── Admin ──
  'tenant.settings': ['ADMIN'],
  'policy.manage': ['OWNER', 'ADMIN'],
  'user.manage': ['ADMIN'],
  'audit.view': ['OWNER', 'FINANCE_OPS_LEAD', 'ACCOUNTANT', 'ADMIN'],
  // ── MDS Property (docs/20 §6) ──
  'property.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'REQUESTER', 'ADMIN', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER', 'MARKETING', 'CALL_CENTER'],
  'property.manage': ['OWNER', 'ADMIN', 'COMMERCIAL_MANAGER'],
  'unit.status.readiness': ['OWNER', 'OPERATIONS_MANAGER', 'COMMERCIAL_MANAGER'],
  'unit.status.occupancy': ['OWNER', 'COMMERCIAL_MANAGER'],
  'unit.status.commercial': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER'],
  'unit.status.operational': ['OWNER', 'OPERATIONS_MANAGER'],
  'unit.status.override': ['OWNER', 'COMMERCIAL_MANAGER'],
  'unit.publish': ['OWNER', 'COMMERCIAL_MANAGER', 'MARKETING'],
  'unit.pricing.edit': ['OWNER', 'COMMERCIAL_MANAGER'],
  'unit.owner.view': ['OWNER', 'FINANCE_OPS_LEAD', 'ADMIN', 'COMMERCIAL_MANAGER', 'CALL_CENTER'],
  'unit.finance.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'COMMERCIAL_MANAGER'],
  'unit.activity.create': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER'],
  // ── MDS Property Wave 2 (docs/20 §11) ──
  'lease.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'ADMIN', 'COMMERCIAL_MANAGER', 'OPERATIONS_MANAGER'],
  'lease.manage': ['OWNER', 'COMMERCIAL_MANAGER'],
  'deal.view': ['OWNER', 'FINANCE_OPS_LEAD', 'ADMIN', 'COMMERCIAL_MANAGER', 'BROKER', 'MARKETING', 'CALL_CENTER'],
  'deal.manage': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'CALL_CENTER'],
  'deal.contact.view': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'CALL_CENTER'],
  'contact.merge': ['OWNER', 'COMMERCIAL_MANAGER'],
  'owner.activity': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'CALL_CENTER', 'OPERATIONS_MANAGER'],
  'owner.pipeline': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'MARKETING', 'FINANCE_OPS_LEAD', 'ADMIN', 'CALL_CENTER'],
  'apikey.manage': ['OWNER', 'ADMIN'],
  // WorkBot (docs/20 §11.4): черновик может создать любой c property.view; подтверждение — по праву самого действия
  // Заявки и инциденты (docs/20 §11.5)
  'workorder.view': ['OWNER', 'FINANCE_OPS_LEAD', 'ADMIN', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER', 'MARKETING'],
  'workorder.create': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER', 'MARKETING'],
  'workorder.manage': ['OWNER', 'OPERATIONS_MANAGER'],
  'workorder.verify': ['OWNER', 'OPERATIONS_MANAGER', 'COMMERCIAL_MANAGER'],
  // Services marketplace (docs/20 §11.8): заказ услуг персоналом; собственник — через owner.request по своим юнитам
  'service.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'ADMIN', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER', 'MARKETING'],
  'service.order': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER', 'MARKETING'],
  'service.manage': ['OWNER', 'OPERATIONS_MANAGER'],
  'service.verify': ['OWNER', 'OPERATIONS_MANAGER', 'COMMERCIAL_MANAGER'],
  'service.catalog': ['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'],
  // Аренда и дебиторка (docs/20 §11.9): просмотр начислений и зачёт банковских поступлений
  'rent.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'ADMIN', 'COMMERCIAL_MANAGER'],
  'rent.match': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'],
  // Комиссии ORDO и бонусы (docs/20 §11.10): комиссия — деньги ORDO; бонус видит владелец/финансы/коммерция, свой — продажник
  'commission.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'ADMIN', 'COMMERCIAL_MANAGER'],
  'commission.manage': ['OWNER', 'COMMERCIAL_MANAGER'],
  'bonus.view': ['OWNER', 'FINANCE_OPS_LEAD', 'ADMIN', 'COMMERCIAL_MANAGER'],
  'bonus.own': ['COMMERCIAL_MANAGER', 'BROKER'],
  'bonus.confirm_kpi': ['OWNER', 'COMMERCIAL_MANAGER'],
  'bonus.pay': ['OWNER', 'FINANCE_OPS_LEAD'],
  'deal.checklist': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER'],
  // ORDO Mall (docs/20 §11.11): мандаты ДДУ, tenant mix, линии актива
  'mall.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'ADMIN', 'COMMERCIAL_MANAGER', 'BROKER', 'MARKETING', 'OPERATIONS_MANAGER'],
  'mall.manage': ['OWNER', 'COMMERCIAL_MANAGER'],
  'mall.fee.view': ['OWNER', 'FINANCE_OPS_LEAD', 'ADMIN', 'COMMERCIAL_MANAGER'],
  // Operations — деньги дома (docs/20 §11.13): фонд, взносы, бюджет, отчёт
  'house.view': ['OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'ACCOUNTANT', 'ADMIN', 'OPERATIONS_MANAGER', 'COMMERCIAL_MANAGER'],
  'house.manage': ['OWNER', 'OPERATIONS_MANAGER', 'FINANCE_OPS_LEAD'],
  // Owner Portal (docs/20 §11.6): у собственника нет property.view — только свой портал и заявки по своим юнитам
  'owner.portal': ['PROPERTY_OWNER'],
  'owner.request': ['PROPERTY_OWNER'],
  'action.draft': ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER', 'OPERATIONS_MANAGER', 'MARKETING', 'FINANCE_OPS_LEAD', 'ADMIN', 'CALL_CENTER'],
} as const satisfies Record<string, readonly RoleCode[]>;

export type PermissionCode = keyof typeof PERMISSION_MATRIX;

export const PERMISSION_CODES = Object.keys(PERMISSION_MATRIX) as PermissionCode[];
