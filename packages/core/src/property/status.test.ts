import { describe, expect, it } from 'vitest';
import {
  BROKER_ALLOWED_COMMERCIAL,
  computeUnitKpi,
  deriveUnitView,
  matchesUnitFilter,
  validateStatusPatch,
  type FilterableUnit,
  type UnitStatusFields,
} from './status.js';

const base: UnitStatusFields = {
  type: 'APARTMENT',
  readiness: 'READY',
  occupancy: 'VACANT',
  rentalMode: 'NONE',
  leaseStatus: 'NONE',
  commercialStatus: 'AVAILABLE',
  operationalStatus: 'NORMAL',
};
const today = new Date('2026-09-18T00:00:00Z');
const u = (p: Partial<UnitStatusFields>): UnitStatusFields => ({ ...base, ...p });

describe('BR-P01 цвет выводится из полей по приоритету Readiness → Occupancy → Rental → Contract → Overlay', () => {
  it('готов и свободен → RED', () => {
    expect(deriveUnitView(base, today).color).toBe('RED');
  });
  it('ремонт/fitout/furnishing/blocked → GREY даже при активном договоре (+alert)', () => {
    for (const r of ['RENOVATION', 'FITOUT', 'FURNISHING', 'BLOCKED'] as const) {
      const v = deriveUnitView(u({ readiness: r, occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', commercialStatus: 'OFF_MARKET' }), today);
      expect(v.color, r).toBe('GREY');
      expect(v.alerts).toContain('RENOVATION_WITH_ACTIVE_LEASE');
    }
  });
  it('занято LTR c активным договором → GREEN без alert', () => {
    const v = deriveUnitView(u({ occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', commercialStatus: 'CONTRACTED' }), today);
    expect(v.color).toBe('GREEN');
    expect(v.alerts).toEqual([]);
  });
  it('STR → YELLOW', () => {
    expect(deriveUnitView(u({ occupancy: 'OCCUPIED', rentalMode: 'STR', commercialStatus: 'OFF_MARKET' }), today).color).toBe('YELLOW');
  });
  it('owner use → BLUE', () => {
    expect(deriveUnitView(u({ occupancy: 'OWNER_USE', commercialStatus: 'OFF_MARKET' }), today).color).toBe('BLUE');
  });
  it('переговоры/резерв/LOI → оранжевый overlay, базовый цвет сохраняется', () => {
    for (const c of ['RESERVED', 'NEGOTIATION', 'LOI'] as const) {
      const v = deriveUnitView(u({ commercialStatus: c }), today);
      expect(v.color, c).toBe('RED');
      expect(v.overlay, c).toBe('NEGOTIATION');
    }
    expect(deriveUnitView(u({ commercialStatus: 'VIEWING' }), today).overlay).toBeNull();
  });
  it('результат детерминирован: два вызова c одинаковыми полями равны', () => {
    expect(deriveUnitView(base, today)).toEqual(deriveUnitView({ ...base }, today));
  });
});

describe('BR-P02 технические зоны и common areas вне коммерческой статистики', () => {
  it('COMMON/TECHNICAL → NEUTRAL, isCommercial=false, не входят в KPI', () => {
    const v = deriveUnitView(u({ type: 'TECHNICAL' }), today);
    expect(v.color).toBe('NEUTRAL');
    expect(v.isCommercial).toBe(false);
    const kpi = computeUnitKpi([{ ...u({ type: 'COMMON' }), areaM2: 500 }, { ...base, areaM2: 80 }], today);
    expect(kpi.total).toBe(2);
    expect(kpi.commercial).toBe(1);
    expect(kpi.vacant).toBe(1);
    expect(kpi.availableGlaCm2).toBe(8000);
  });
});

describe('BR-P03..P07 data-quality alerts не чинятся автоматически, а подсвечиваются', () => {
  it('P04 неготовый юнит выставлен на рынок', () => {
    expect(deriveUnitView(u({ readiness: 'FITOUT' }), today).alerts).toContain('NOT_READY_BUT_AVAILABLE');
  });
  it('P05 занят без режима аренды', () => {
    expect(deriveUnitView(u({ occupancy: 'OCCUPIED', rentalMode: 'NONE' }), today).alerts).toContain('OCCUPIED_WITHOUT_RENTAL_MODE');
  });
  it('P06 LTR без активного договора', () => {
    expect(deriveUnitView(u({ occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'DRAFT' }), today).alerts).toContain('LTR_WITHOUT_ACTIVE_LEASE');
  });
  it('P07 свободен, но договор активен', () => {
    expect(deriveUnitView(u({ leaseStatus: 'ACTIVE' }), today).alerts).toContain('VACANT_WITH_ACTIVE_LEASE');
  });
});

describe('BR-P04/P10/P11 валидация изменения статуса', () => {
  it('P04 нельзя вывести неготовый юнит на рынок без override', () => {
    expect(validateStatusPatch(u({ readiness: 'RENOVATION', commercialStatus: 'OFF_MARKET' }), { commercialStatus: 'AVAILABLE' })).toContain('NOT_READY_FOR_MARKET');
    expect(validateStatusPatch(u({ readiness: 'RENOVATION', commercialStatus: 'OFF_MARKET' }), { commercialStatus: 'AVAILABLE' }, { override: true })).toEqual([]);
  });
  it('P10 owner use несовместим c режимом аренды', () => {
    expect(validateStatusPatch(base, { occupancy: 'OWNER_USE', rentalMode: 'LTR' })).toContain('OWNER_USE_WITH_RENTAL_MODE');
  });
  it('P11 брокер ограничен стадиями до договора', () => {
    expect(BROKER_ALLOWED_COMMERCIAL).not.toContain('CONTRACTED');
    expect(validateStatusPatch(base, { commercialStatus: 'CONTRACTED' }, { brokerOnly: true })).toContain('BROKER_STAGE_LIMIT');
    expect(validateStatusPatch(base, { commercialStatus: 'VIEWING' }, { brokerOnly: true })).toEqual([]);
  });
  it('пустой patch → NO_CHANGES', () => {
    expect(validateStatusPatch(base, { occupancy: 'VACANT' })).toContain('NO_CHANGES');
  });
});

describe('BR-P12 единый предикат фильтра для backend и UI', () => {
  const f = (p: Partial<FilterableUnit>): FilterableUnit => ({
    ...base, id: 'u', buildingId: 'b', floorId: 'f', unitNo: '1704', managedByPlatform: false, ownerName: 'Иванов', occupantName: null, ...p,
  });
  it('vacantOverDays считает только готовые свободные', () => {
    const idle = f({ vacantSince: new Date('2026-05-01') });
    expect(matchesUnitFilter(idle, deriveUnitView(idle, today), { vacantOverDays: 90 })).toBe(true);
    expect(matchesUnitFilter(idle, deriveUnitView(idle, today), { vacantOverDays: 200 })).toBe(false);
    const reno = f({ readiness: 'RENOVATION', vacantSince: new Date('2025-01-01') });
    expect(matchesUnitFilter(reno, deriveUnitView(reno, today), { vacantOverDays: 30 })).toBe(false);
  });
  it('leaseEndsWithinDays только для активных договоров в будущем', () => {
    const soon = f({ occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', leaseEndsAt: new Date('2026-10-10') });
    expect(matchesUnitFilter(soon, deriveUnitView(soon, today), { leaseEndsWithinDays: 30 })).toBe(true);
    expect(matchesUnitFilter(soon, deriveUnitView(soon, today), { leaseEndsWithinDays: 10 })).toBe(false);
  });
  it('поиск по номеру/собственнику/арендатору без учёта регистра', () => {
    const x = f({ occupantName: 'CityNet LLC' });
    const v = deriveUnitView(x, today);
    expect(matchesUnitFilter(x, v, { q: 'citynet' })).toBe(true);
    expect(matchesUnitFilter(x, v, { q: '170' })).toBe(true);
    expect(matchesUnitFilter(x, v, { q: 'иван' })).toBe(true);
    expect(matchesUnitFilter(x, v, { q: 'нет' })).toBe(false);
  });
  it('фильтры комбинируются (AND)', () => {
    const x = f({ managedByPlatform: true, rentalMode: 'STR', occupancy: 'OCCUPIED', commercialStatus: 'OFF_MARKET' });
    const v = deriveUnitView(x, today);
    expect(matchesUnitFilter(x, v, { color: 'YELLOW', managedOnly: true })).toBe(true);
    expect(matchesUnitFilter(x, v, { color: 'YELLOW', managedOnly: true, withAlerts: true })).toBe(false);
  });
});

describe('KPI strip', () => {
  it('считает occupancy, доход и sellable', () => {
    const kpi = computeUnitKpi(
      [
        { ...base, areaM2: 100, askingRateMinor: 150_000n },
        { ...u({ occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', commercialStatus: 'CONTRACTED' }), areaM2: 90, monthlyRentMinor: 120_000n },
        { ...u({ occupancy: 'OCCUPIED', rentalMode: 'STR', commercialStatus: 'OFF_MARKET' }), areaM2: 60, monthlyRentMinor: 200_000n },
        { ...u({ readiness: 'FITOUT', commercialStatus: 'OFF_MARKET' }), areaM2: 70 },
        { ...u({ occupancy: 'OWNER_USE', commercialStatus: 'OFF_MARKET' }), areaM2: 70 },
      ],
      today,
    );
    expect(kpi).toMatchObject({ commercial: 5, vacant: 1, occupied: 2, ltr: 1, str: 1, ownerUse: 1, renovation: 1, sellable: 1 });
    expect(kpi.potentialIncomeMinor).toBe(150_000n);
    expect(kpi.currentIncomeMinor).toBe(320_000n);
    expect(kpi.occupancyPct).toBe(75); // (2 занятых + 1 owner) / 4 готовых
  });
});
