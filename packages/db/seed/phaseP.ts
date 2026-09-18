/**
 * Seed Phase P — MDS Property (docs/20 §9): синтетическая башня «Piramit (демо)».
 * Детерминирован (LCG по индексу юнита), идемпотентен (upsert по стабильным ключам).
 * Никаких реальных собственников/арендаторов — все имена вымышлены.
 */
import { hashPassword } from '@finance-os/core';
import type { CommercialStatus, DealSource, DealStage, LeaseStatus, OccupancyStatus, PrismaClient, ReadinessStatus, RentalMode, RoleCode, UnitType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DEV_PASSWORD } from './phaseA.js';

export const PROPERTY_TENANT = { slug: 'piramit', legalName: 'Piramit Tower (демо)', taxId: '311234599' } as const;

const USERS: { email: string; fullName: string; roles: RoleCode[] }[] = [
  { email: 'owner@piramit.test', fullName: 'Мурад Джаббаров', roles: ['OWNER'] },
  { email: 'commercial@piramit.test', fullName: 'Алия Сафарова', roles: ['COMMERCIAL_MANAGER'] },
  { email: 'broker@piramit.test', fullName: 'Бекзод Тураев', roles: ['BROKER'] },
  { email: 'ops@piramit.test', fullName: 'Шерзод Мирзаев', roles: ['OPERATIONS_MANAGER'] },
  { email: 'marketing@piramit.test', fullName: 'Нигора Абдуллаева', roles: ['MARKETING'] },
  { email: 'admin@piramit.test', fullName: 'Санжар Ибрагимов', roles: ['ADMIN'] },
  { email: 'finance@piramit.test', fullName: 'Нилуфар Рашидова', roles: ['FINANCE_OPS_LEAD'] },
];

const FIRST = ['Рустам', 'Дилноза', 'Жасур', 'Малика', 'Отабек', 'Севара', 'Улугбек', 'Зарина', 'Фаррух', 'Камола', 'Санжар', 'Гульнара', 'Азиз', 'Мадина', 'Тимур'];
const LAST = ['Каримов', 'Юсупова', 'Рахимов', 'Хамидова', 'Умаров', 'Назарова', 'Алиев', 'Саидова', 'Исмаилов', 'Ахмедова'];
const COMPANIES = ['CityNet LLC', 'Uzbek Textile Group', 'Silk Road Logistics', 'Delta Consulting', 'NovaPharm', 'Aral IT Solutions', 'Registan Trade', 'Chorsu Foods', 'Amir Legal', 'Zarafshan Bank'];

/** Детерминированный генератор: один и тот же индекс → одно и то же значение при каждом запуске. */
function rng(seed: number) {
  let s = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

interface BuildingSpec {
  code: string;
  name: string;
  kind: 'TOWER' | 'OFFICES' | 'MALL';
  floors: number[];
  perFloor: number;
  unitType: UnitType;
  areaRange: [number, number];
  rateRangeUsd: [number, number]; // в месяц
  prefix: (floorNo: number, i: number) => string;
  sortOrder: number;
}

const BUILDINGS: BuildingSpec[] = [
  { code: 'TOWER', name: 'Residence Tower', kind: 'TOWER', floors: Array.from({ length: 19 }, (_, i) => i + 2), perFloor: 8, unitType: 'APARTMENT', areaRange: [58, 145], rateRangeUsd: [900, 2600], prefix: (f, i) => `${f}${String(i + 1).padStart(2, '0')}`, sortOrder: 1 },
  { code: 'OFFICES', name: 'Business Center', kind: 'OFFICES', floors: Array.from({ length: 8 }, (_, i) => i + 1), perFloor: 6, unitType: 'OFFICE', areaRange: [45, 320], rateRangeUsd: [1100, 7500], prefix: (f, i) => `B${f}-${i + 1}`, sortOrder: 2 },
  { code: 'MALL', name: 'Piramit Mall', kind: 'MALL', floors: [1, 2, 3], perFloor: 10, unitType: 'RETAIL', areaRange: [30, 420], rateRangeUsd: [1500, 12000], prefix: (f, i) => `M${f}-${String(i + 1).padStart(2, '0')}`, sortOrder: 3 },
];

/** Полигоны в viewBox 0 0 1000 600: два ряда вокруг центрального ядра. */
function geometryFor(perFloor: number, i: number): { points: [number, number][] } {
  const perRow = Math.ceil(perFloor / 2);
  const w = 1000 / perRow;
  const row = i < perRow ? 0 : 1;
  const col = i % perRow;
  const x0 = Math.round(col * w);
  const x1 = Math.round((col + 1) * w);
  const [y0, y1] = row === 0 ? [0, 230] : [370, 600];
  return { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
}

type StatusPick = {
  readiness: ReadinessStatus;
  occupancy: OccupancyStatus;
  rentalMode: RentalMode;
  leaseStatus: LeaseStatus;
  commercialStatus: CommercialStatus;
  vacantSince: Date | null;
  leaseEndsAt: Date | null;
  occupant: string | null;
  monthlyRentMinor: bigint | null;
  publishedAt: Date | null;
};

function pickStatus(kind: BuildingSpec['kind'], r: () => number, askingMinor: bigint): StatusPick {
  const x = r();
  const none: StatusPick = { readiness: 'READY', occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: 'NONE', commercialStatus: 'AVAILABLE', vacantSince: daysAgo(Math.floor(5 + r() * 220)), leaseEndsAt: null, occupant: null, monthlyRentMinor: null, publishedAt: null };
  const person = () => `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
  const company = () => COMPANIES[Math.floor(r() * COMPANIES.length)]!;
  const rent = () => (askingMinor * BigInt(85 + Math.floor(r() * 20))) / 100n;
  const leaseEnd = () => daysAhead(Math.floor(10 + r() * 420));
  const ltrShare = kind === 'TOWER' ? 0.5 : kind === 'OFFICES' ? 0.58 : 0.66;
  const strShare = kind === 'TOWER' ? 0.14 : 0;
  const ownerShare = kind === 'TOWER' ? 0.08 : 0.03;
  const renoShare = 0.1;
  if (x < ltrShare) {
    const ends = leaseEnd();
    return { ...none, occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: ends < daysAhead(30) ? 'EXPIRING' : 'ACTIVE', commercialStatus: 'CONTRACTED', vacantSince: null, leaseEndsAt: ends, occupant: kind === 'TOWER' ? person() : company(), monthlyRentMinor: rent() };
  }
  if (x < ltrShare + strShare) {
    return { ...none, occupancy: 'OCCUPIED', rentalMode: 'STR', leaseStatus: 'NONE', commercialStatus: 'OFF_MARKET', vacantSince: null, occupant: 'Гость (STR)', monthlyRentMinor: rent() };
  }
  if (x < ltrShare + strShare + ownerShare) {
    return { ...none, occupancy: 'OWNER_USE', commercialStatus: 'OFF_MARKET', vacantSince: null };
  }
  if (x < ltrShare + strShare + ownerShare + renoShare) {
    const readiness: ReadinessStatus = (['RENOVATION', 'FITOUT', 'FURNISHING'] as const)[Math.floor(r() * 3)]!;
    return { ...none, readiness, commercialStatus: 'OFF_MARKET', vacantSince: daysAgo(Math.floor(10 + r() * 90)) };
  }
  // свободные: часть в переговорах, часть опубликована
  const y = r();
  const commercialStatus: CommercialStatus = y < 0.2 ? 'NEGOTIATION' : y < 0.3 ? 'RESERVED' : y < 0.4 ? 'VIEWING' : 'AVAILABLE';
  return { ...none, commercialStatus, publishedAt: commercialStatus === 'AVAILABLE' && r() < 0.6 ? daysAgo(3) : null };
}

export async function seedPhaseP(prisma: PrismaClient): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: PROPERTY_TENANT.slug },
    create: { slug: PROPERTY_TENANT.slug, legalName: PROPERTY_TENANT.legalName, taxId: PROPERTY_TENANT.taxId, settings: { product: 'MDS Property' } },
    update: { legalName: PROPERTY_TENANT.legalName },
  });
  const tenantId = tenant.id;

  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const u of USERS) {
    const user = await prisma.user.upsert({ where: { email: u.email }, create: { email: u.email, fullName: u.fullName, passwordHash }, update: {} });
    for (const role of u.roles) {
      await prisma.userTenantRole.upsert({ where: { userId_tenantId_role: { userId: user.id, tenantId, role } }, create: { userId: user.id, tenantId, role }, update: {} });
    }
  }
  console.log(`  property users: ${USERS.length}`);

  // Собственники: 60 вымышленных (40 физлиц + 20 компаний), контакты — шаблонные
  const owners: string[] = [];
  const r0 = rng(7);
  for (let i = 0; i < 60; i++) {
    const isCompany = i >= 40;
    const displayName = isCompany ? `${COMPANIES[i % COMPANIES.length]} ${i >= 50 ? 'Holding' : ''}`.trim() : `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
    const existing = await prisma.propertyOwner.findFirst({ where: { tenantId, displayName } });
    const row = existing ?? (await prisma.propertyOwner.create({
      data: { tenantId, kind: isCompany ? 'COMPANY' : 'PERSON', displayName, contactPhone: `+99890${String(1000000 + i * 7919).slice(0, 7)}`, contactEmail: `owner${i + 1}@example.test`, managementConsent: r0() < 0.45 },
    }));
    owners.push(row.id);
  }
  console.log(`  property owners: ${owners.length}`);

  let unitsTotal = 0;
  let unitIndex = 0;
  for (const spec of BUILDINGS) {
    const building = await prisma.building.upsert({
      where: { tenantId_code: { tenantId, code: spec.code } },
      create: { tenantId, code: spec.code, name: spec.name, kind: spec.kind, address: 'Ташкент, Piramit (демо)', sortOrder: spec.sortOrder },
      update: { name: spec.name, sortOrder: spec.sortOrder },
    });
    for (const floorNo of spec.floors) {
      const floor = await prisma.floor.upsert({
        where: { buildingId_floorNo: { buildingId: building.id, floorNo } },
        create: { tenantId, buildingId: building.id, floorNo },
        update: {},
      });
      for (let i = 0; i < spec.perFloor; i++) {
        unitIndex++;
        const r = rng(unitIndex);
        const unitNo = spec.prefix(floorNo, i);
        const area = Math.round((spec.areaRange[0] + r() * (spec.areaRange[1] - spec.areaRange[0])) * 10) / 10;
        const askingMinor = BigInt(Math.round(spec.rateRangeUsd[0] + r() * (spec.rateRangeUsd[1] - spec.rateRangeUsd[0]))) * 100n;
        const st = pickStatus(spec.kind, r, askingMinor);
        const ownerId = spec.kind === 'TOWER' || r() < 0.5 ? owners[Math.floor(r() * owners.length)]! : null;
        await prisma.unit.upsert({
          where: { buildingId_unitNo: { buildingId: building.id, unitNo } },
          create: {
            tenantId, buildingId: building.id, floorId: floor.id, unitNo, type: spec.unitType,
            areaM2: new Prisma.Decimal(area.toFixed(2)), geometry: geometryFor(spec.perFloor, i) as unknown as Prisma.InputJsonValue,
            ownerId, occupantName: st.occupant, readiness: st.readiness, occupancy: st.occupancy, rentalMode: st.rentalMode,
            leaseStatus: st.leaseStatus, commercialStatus: st.commercialStatus, vacantSince: st.vacantSince, leaseEndsAt: st.leaseEndsAt,
            askingRateMinor: askingMinor, minApprovedRateMinor: (askingMinor * 90n) / 100n, monthlyRentMinor: st.monthlyRentMinor,
            managedByPlatform: ownerId ? r() < 0.5 : false, publishedAt: st.publishedAt,
          },
          update: {},
        });
        unitsTotal++;
      }
      // Ядро этажа — common area, вне коммерческой статистики (BR-P02)
      await prisma.unit.upsert({
        where: { buildingId_unitNo: { buildingId: building.id, unitNo: `${spec.code[0]}${floorNo}-CORE` } },
        create: { tenantId, buildingId: building.id, floorId: floor.id, unitNo: `${spec.code[0]}${floorNo}-CORE`, type: 'COMMON', areaM2: new Prisma.Decimal('64.00'), geometry: { points: [[300, 250], [700, 250], [700, 350], [300, 350]] } as unknown as Prisma.InputJsonValue, occupancy: 'UNAVAILABLE', commercialStatus: 'OFF_MARKET' },
        update: {},
      });
    }
  }

  // Три намеренных противоречия для демонстрации data-quality alert'ов (BR-P03/P05/P07)
  const tower = await prisma.building.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'TOWER' } } });
  await prisma.unit.update({ where: { buildingId_unitNo: { buildingId: tower.id, unitNo: '1203' } }, data: { readiness: 'RENOVATION', occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', commercialStatus: 'OFF_MARKET', occupantName: 'Delta Consulting', leaseEndsAt: daysAhead(200), publishedAt: null } });
  await prisma.unit.update({ where: { buildingId_unitNo: { buildingId: tower.id, unitNo: '805' } }, data: { readiness: 'READY', occupancy: 'OCCUPIED', rentalMode: 'NONE', leaseStatus: 'NONE', commercialStatus: 'OFF_MARKET', occupantName: 'Неизвестный жилец', publishedAt: null } });
  await prisma.unit.update({ where: { buildingId_unitNo: { buildingId: tower.id, unitNo: '1507' } }, data: { readiness: 'READY', occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: 'ACTIVE', commercialStatus: 'AVAILABLE', leaseEndsAt: daysAhead(90), vacantSince: daysAgo(12) } });

  console.log(`  property units: ${unitsTotal} + common areas`);

  // ── Wave 2: договоры аренды как источник истины занятых юнитов (docs/20 §11.1) ──
  const occupied = await prisma.unit.findMany({ where: { tenantId, occupancy: { in: ['OCCUPIED', 'OWNER_USE'] }, type: { notIn: ['COMMON', 'TECHNICAL'] } } });
  let leases = 0;
  for (const u of occupied) {
    const exists = await prisma.leaseContract.count({ where: { unitId: u.id, status: { in: ['ACTIVE', 'EXPIRING'] } } });
    if (exists) continue;
    const r = rng(9000 + leases);
    const type = u.occupancy === 'OWNER_USE' ? 'OWNER_USE' : u.rentalMode === 'STR' ? 'STR' : 'LTR';
    const startAt = daysAgo(Math.floor(30 + r() * 700));
    const rent = u.monthlyRentMinor ?? ((u.askingRateMinor ?? 0n) * 9n) / 10n;
    await prisma.leaseContract.create({
      data: {
        tenantId, unitId: u.id, ownerId: u.ownerId, type, occupantName: u.occupantName ?? 'Собственник',
        occupantContact: type === 'LTR' ? `+99890${String(2000000 + leases * 3571).slice(0, 7)}` : null,
        startAt, endAt: type === 'STR' ? daysAhead(Math.floor(2 + r() * 20)) : u.leaseEndsAt, rentMinor: rent, depositMinor: type === 'LTR' ? rent : null,
        depositReceived: type === 'LTR' ? r() < 0.85 : false, currency: u.askingCurrency, status: u.leaseStatus === 'EXPIRING' ? 'EXPIRING' : 'ACTIVE',
      },
    });
    leases++;
  }
  console.log(`  lease contracts: ${leases} created`);

  // ── Wave 2: воронка сделок (blueprint §6) — детерминированные номера, идемпотентно по (tenant, number) ──
  const managers = await prisma.userTenantRole.findMany({ where: { tenantId, role: { in: ['COMMERCIAL_MANAGER', 'BROKER'] } }, select: { userId: true, role: true } });
  const cmUser = managers.find((m) => m.role === 'COMMERCIAL_MANAGER')?.userId;
  const brUser = managers.find((m) => m.role === 'BROKER')?.userId;
  const sellable = await prisma.unit.findMany({ where: { tenantId, occupancy: 'VACANT', readiness: 'READY', type: { notIn: ['COMMON', 'TECHNICAL'] } }, orderBy: { unitNo: 'asc' } });
  const STAGES: DealStage[] = ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'VIEWING', 'OFFER', 'NEGOTIATION', 'NEGOTIATION', 'LOI', 'CONTRACT', 'LOST', 'NEW', 'QUALIFIED', 'VIEWING', 'NEGOTIATION', 'LOST', 'PROPERTY_SELECTED', 'OFFER', 'VIEWING', 'NEW'];
  const SOURCES: DealSource[] = ['WEBSITE', 'TELEGRAM', 'INSTAGRAM', 'REFERRAL', 'BROKER', 'WALK_IN'];
  const DEAL_COMPANIES = [null, 'Aral IT Solutions', null, 'Delta Consulting', 'NovaPharm', null, 'Silk Road Logistics', null, 'Amir Legal', 'Registan Trade'];
  let dealsCreated = 0;
  if (cmUser && brUser) {
    const year = new Date().getFullYear();
    for (let i = 0; i < STAGES.length; i++) {
      const number = `DEAL-${year}-${String(i + 1).padStart(6, '0')}`;
      const exists = await prisma.deal.findUnique({ where: { tenantId_number: { tenantId, number } } });
      if (exists) continue;
      const r = rng(7000 + i);
      const stage = STAGES[i]!;
      const withUnit = stage !== 'NEW' && stage !== 'QUALIFIED';
      const unit = withUnit ? sellable[(i * 7) % Math.max(1, sellable.length)] : undefined;
      const managerId = i % 3 === 0 ? brUser : cmUser;
      const expected = unit?.askingRateMinor ? (unit.askingRateMinor * BigInt(85 + Math.floor(r() * 15))) / 100n : BigInt(Math.floor(800 + r() * 4000)) * 100n;
      const nextIn = Math.floor(r() * 14) - 4; // часть просрочена → attention
      const created = await prisma.deal.create({
        data: {
          tenantId, number, contactName: `${FIRST[(i * 5) % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`, contactPhone: `+99890${String(3000000 + i * 4111).slice(0, 7)}`,
          company: DEAL_COMPANIES[i % DEAL_COMPANIES.length] ?? null, source: SOURCES[i % SOURCES.length]!, budgetMinor: expected, purpose: unit?.type === 'OFFICE' ? 'офис' : unit?.type === 'RETAIL' ? 'торговая точка' : 'жильё',
          unitId: unit?.id ?? null, managerId, stage, stageChangedAt: daysAgo(Math.floor(r() * 20)),
          nextAction: stage === 'LOST' || i % 4 === 3 ? null : ['перезвонить', 'отправить КП', 'назначить показ', 'согласовать скидку'][i % 4]!, nextActionAt: stage === 'LOST' || i % 4 === 3 ? null : daysAhead(nextIn),
          expectedRateMinor: unit ? expected : null, reservedUntil: stage === 'NEGOTIATION' && i % 2 === 0 ? daysAhead(5) : null, depositReceived: stage === 'CONTRACT',
          lostReason: stage === 'LOST' ? (i % 2 ? 'PRICE' : 'COMPETITOR') : null, createdBy: managerId,
        },
      });
      dealsCreated++;
      if (unit && stage !== 'LOST') {
        // BR-P20: стадия юнита из самой продвинутой активной сделки
        const map: Record<string, CommercialStatus> = { VIEWING: 'VIEWING', OFFER: 'NEGOTIATION', NEGOTIATION: created.reservedUntil ? 'RESERVED' : 'NEGOTIATION', LOI: 'LOI', CONTRACT: 'CONTRACTED', PROPERTY_SELECTED: 'AVAILABLE' };
        const cs = map[stage] ?? 'AVAILABLE';
        const rank: Record<string, number> = { AVAILABLE: 0, VIEWING: 1, NEGOTIATION: 2, RESERVED: 3, LOI: 4, CONTRACTED: 5 };
        if ((rank[cs] ?? 0) >= (rank[unit.commercialStatus] ?? 0)) await prisma.unit.update({ where: { id: unit.id }, data: { commercialStatus: cs, ...(cs === 'LOI' || cs === 'CONTRACTED' ? { publishedAt: null } : {}) } });
      }
    }
    // Sequence: следующий номер после сидовых
    await prisma.sequence.upsert({ where: { tenantId_key_year: { tenantId, key: 'DEAL', year } }, create: { tenantId, key: 'DEAL', year, nextValue: STAGES.length + 1 }, update: { nextValue: { set: STAGES.length + 1 } } });
  }
  console.log(`  deals: ${dealsCreated} created`);
}
