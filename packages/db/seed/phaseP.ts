/**
 * Seed Phase P — MDS Property (docs/20 §9): синтетическая башня «Piramit (демо)».
 * Детерминирован (LCG по индексу юнита), идемпотентен (upsert по стабильным ключам).
 * Никаких реальных собственников/арендаторов — все имена вымышлены.
 */
import { encryptSecret, hashPassword, maskAccount } from '@finance-os/core';
import { generateRentCharges, markOverdueRentCharges } from '../src/services/rent.js';
import { generateHouseCharges, markOverdueHouseCharges } from '../src/services/house.js';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { createDeal, moveDeal } from '../src/services/deals.js';
import { activateLease, createLease } from '../src/services/leases.js';
import { closeSale, confirmKpi, markChecklistItem, matchCommissionReceipt } from '../src/services/commissions.js';
import type { CommercialStatus, DealSource, DealStage, LeaseStatus, OccupancyStatus, PrismaClient, ReadinessStatus, RentalMode, RoleCode, UnitType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DEV_PASSWORD } from './phaseA.js';

export const PROPERTY_TENANT = { slug: 'piramit', legalName: 'Piramit Tower (демо)', taxId: '311234599' } as const;

// telegramChatId — синтетический (demo-*): для проверки WorkBot API без реального бота
const USERS: { email: string; fullName: string; roles: RoleCode[]; telegramChatId?: string }[] = [
  { email: 'owner@piramit.test', fullName: 'Мурад Джаббаров', roles: ['OWNER'], telegramChatId: 'demo-owner' },
  { email: 'commercial@piramit.test', fullName: 'Алия Сафарова', roles: ['COMMERCIAL_MANAGER'], telegramChatId: 'demo-commercial' },
  { email: 'broker@piramit.test', fullName: 'Бекзод Тураев', roles: ['BROKER'], telegramChatId: 'demo-broker' },
  { email: 'ops@piramit.test', fullName: 'Шерзод Мирзаев', roles: ['OPERATIONS_MANAGER'], telegramChatId: 'demo-ops' },
  { email: 'marketing@piramit.test', fullName: 'Нигора Абдуллаева', roles: ['MARKETING'] },
  { email: 'admin@piramit.test', fullName: 'Санжар Ибрагимов', roles: ['ADMIN'] },
  { email: 'finance@piramit.test', fullName: 'Нилуфар Рашидова', roles: ['FINANCE_OPS_LEAD'] },
  // Owner Portal: собственник (привязывается к PropertyOwner ниже)
  { email: 'owner1@piramit.test', fullName: 'Рустам Каримов', roles: ['PROPERTY_OWNER'] },
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
    create: { slug: PROPERTY_TENANT.slug, legalName: PROPERTY_TENANT.legalName, taxId: PROPERTY_TENANT.taxId, settings: { product: 'MDS Property', management_fee_bp: 1000, services_hour_cost_minor: '4000000', mall_rate_scenarios: { '1': { conservative: 4500, base: 5500, optimistic: 6000 }, '2': { conservative: 3500, base: 4500, optimistic: 5000 }, '3': { conservative: 1600, base: 4000, optimistic: 4500 } } } },
    update: { legalName: PROPERTY_TENANT.legalName, settings: { product: 'MDS Property', management_fee_bp: 1000, services_hour_cost_minor: '4000000', mall_rate_scenarios: { '1': { conservative: 4500, base: 5500, optimistic: 6000 }, '2': { conservative: 3500, base: 4500, optimistic: 5000 }, '3': { conservative: 1600, base: 4000, optimistic: 4500 } } } },
  });
  const tenantId = tenant.id;

  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const u of USERS) {
    const user = await prisma.user.upsert({ where: { email: u.email }, create: { email: u.email, fullName: u.fullName, passwordHash, telegramChatId: u.telegramChatId ?? null }, update: { ...(u.telegramChatId ? { telegramChatId: u.telegramChatId } : {}) } });
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
  // Owner Portal: первый собственник-физлицо (Рустам Каримов) ↔ owner1@piramit.test
  const ownerUser = await prisma.user.findUnique({ where: { email: 'owner1@piramit.test' } });
  if (ownerUser) {
    const first = await prisma.propertyOwner.findFirst({ where: { tenantId, displayName: 'Рустам Каримов' } });
    if (first && !first.userId) await prisma.propertyOwner.update({ where: { id: first.id }, data: { userId: ownerUser.id, managementConsent: true, listingConsent: true } });
  }

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
          unitId: unit?.id ?? null, managerId, stage, createdAt: daysAgo(25 + Math.floor(r() * 40)), stageChangedAt: daysAgo(Math.floor(r() * 20)),
          nextAction: stage === 'LOST' || i % 4 === 3 ? null : ['перезвонить', 'отправить КП', 'назначить показ', 'согласовать скидку'][i % 4]!, nextActionAt: stage === 'LOST' || i % 4 === 3 ? null : daysAhead(nextIn),
          expectedRateMinor: unit ? expected : null, reservedUntil: stage === 'NEGOTIATION' && i % 2 === 0 ? daysAhead(5) : null, depositReceived: stage === 'CONTRACT',
          lostReason: stage === 'LOST' ? (i % 2 ? 'PRICE' : 'COMPETITOR') : null, createdBy: managerId,
          product: unit?.type === 'OFFICE' ? 'LEASE_OFFICE' : unit?.type === 'RETAIL' ? 'MALL_LEASE' : i % 9 === 8 ? 'SALE' : 'LEASE_LTR',
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
    // Sequence: следующий номер после сидовых; при повторном запуске счётчик только растёт (иначе дубликаты номеров)
    const want = STAGES.length + 1;
    const seq = await prisma.sequence.findUnique({ where: { tenantId_key_year: { tenantId, key: 'DEAL', year } } });
    if (!seq) await prisma.sequence.create({ data: { tenantId, key: 'DEAL', year, nextValue: want } });
    else if (seq.nextValue < want) await prisma.sequence.update({ where: { id: seq.id }, data: { nextValue: want } });
  }
  console.log(`  deals: ${dealsCreated} created`);

  // ── Wave 4: заявки (blueprint §12) — детерминированные номера, юнит → operationalStatus из открытых ──
  const opsUsers = await prisma.userTenantRole.findMany({ where: { tenantId, role: 'OPERATIONS_MANAGER' }, select: { userId: true } });
  const reporter = (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'COMMERCIAL_MANAGER' }, select: { userId: true } }))?.userId;
  const opsId = opsUsers[0]?.userId;
  const allUnits = await prisma.unit.findMany({ where: { tenantId, type: { notIn: ['COMMON', 'TECHNICAL'] } }, orderBy: { unitNo: 'asc' } });
  const WO: { cat: 'PLUMBING' | 'ELECTRICAL' | 'HVAC' | 'CLEANING' | 'DAMAGE' | 'ACCESS' | 'OTHER'; prio: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'; status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'VERIFIED' | 'CANCELLED'; title: string; ageH: number }[] = [
    { cat: 'PLUMBING', prio: 'HIGH', status: 'OPEN', title: 'Жалоба на ванную после клининга', ageH: 30 },
    { cat: 'ELECTRICAL', prio: 'CRITICAL', status: 'IN_PROGRESS', title: 'Нет света в квартире', ageH: 2 },
    { cat: 'HVAC', prio: 'NORMAL', status: 'ASSIGNED', title: 'Кондиционер не холодит', ageH: 20 },
    { cat: 'DAMAGE', prio: 'NORMAL', status: 'DONE', title: 'Повреждена дверь B2', ageH: 50 },
    { cat: 'CLEANING', prio: 'LOW', status: 'VERIFIED', title: 'Генеральная уборка после выезда', ageH: 200 },
    { cat: 'ACCESS', prio: 'HIGH', status: 'OPEN', title: 'Не работает домофон', ageH: 40 },
    { cat: 'PLUMBING', prio: 'NORMAL', status: 'CANCELLED', title: 'Течь под раковиной (дубликат)', ageH: 90 },
    { cat: 'OTHER', prio: 'LOW', status: 'OPEN', title: 'Заменить табличку на двери', ageH: 10 },
    { cat: 'ELECTRICAL', prio: 'HIGH', status: 'ASSIGNED', title: 'Искрит розетка в офисе', ageH: 5 },
    { cat: 'CLEANING', prio: 'NORMAL', status: 'IN_PROGRESS', title: 'Уборка общего коридора после ремонта', ageH: 12 },
  ];
  let woCreated = 0;
  if (reporter && opsId) {
    const year = new Date().getFullYear();
    for (let i = 0; i < WO.length; i++) {
      const number = `WO-${year}-${String(i + 1).padStart(6, '0')}`;
      if (await prisma.workOrder.findUnique({ where: { tenantId_number: { tenantId, number } } })) continue;
      const w = WO[i]!;
      const unit = allUnits[(i * 13 + 7) % allUnits.length]!;
      const createdAt = daysAgo(w.ageH / 24);
      const sla = { CRITICAL: 4, HIGH: 24, NORMAL: 72, LOW: 168 }[w.prio];
      const assigned = w.status !== 'OPEN' ? opsUsers[i % Math.max(1, opsUsers.length)]!.userId : null;
      await prisma.workOrder.create({
        data: {
          tenantId, number, unitId: unit.id, buildingId: unit.buildingId, category: w.cat, priority: w.prio, status: w.status, title: w.title, reporterId: reporter, assigneeId: assigned,
          slaDueAt: new Date(createdAt.getTime() + sla * 3_600_000), createdAt,
          startedAt: ['IN_PROGRESS', 'DONE', 'VERIFIED'].includes(w.status) ? new Date(createdAt.getTime() + 3_600_000) : null,
          doneAt: ['DONE', 'VERIFIED'].includes(w.status) ? new Date(createdAt.getTime() + 6 * 3_600_000) : null,
          verifiedAt: w.status === 'VERIFIED' ? new Date(createdAt.getTime() + 8 * 3_600_000) : null, verifiedBy: w.status === 'VERIFIED' ? reporter : null,
          cancelReason: w.status === 'CANCELLED' ? 'дубликат' : null,
        },
      });
      // BR-P31: статус юнита из открытых заявок
      if (['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(w.status)) await prisma.unit.update({ where: { id: unit.id }, data: { operationalStatus: w.prio === 'CRITICAL' ? 'CRITICAL' : unit.operationalStatus === 'CRITICAL' ? 'CRITICAL' : 'ISSUE' } });
      woCreated++;
    }
    const want = WO.length + 1;
    const seq = await prisma.sequence.findUnique({ where: { tenantId_key_year: { tenantId, key: 'WO', year } } });
    if (!seq) await prisma.sequence.create({ data: { tenantId, key: 'WO', year, nextValue: want } });
    else if (seq.nextValue < want) await prisma.sequence.update({ where: { id: seq.id }, data: { nextValue: want } });
  }
  console.log(`  work orders: ${woCreated} created`);

  // ── Wave 5: services marketplace (blueprint §12) — каталог (партнёры + своя эксплуатация) и заказы ──
  const CATALOG: { code: string; name: string; category: 'CLEANING' | 'LAUNDRY' | 'REPAIR' | 'CONCIERGE' | 'MOVING' | 'DESIGN' | 'IT' | 'OTHER'; kind: 'OWN_OPS' | 'PARTNER'; partner?: string; price: bigint; commissionBp?: number; sla: number; desc: string }[] = [
    { code: 'CLEAN-STD', name: 'Уборка стандарт', category: 'CLEANING', kind: 'OWN_OPS', price: 250_000_00n, sla: 24, desc: 'Поддерживающая уборка апартаментов до 80 м²' },
    { code: 'CLEAN-DEEP', name: 'Генеральная уборка', category: 'CLEANING', kind: 'OWN_OPS', price: 600_000_00n, sla: 48, desc: 'После выезда арендатора или ремонта' },
    { code: 'LAUNDRY', name: 'Стирка и глажка', category: 'LAUNDRY', kind: 'PARTNER', partner: 'CleanPro', price: 120_000_00n, commissionBp: 1500, sla: 48, desc: 'Забор и доставка в течение 2 дней' },
    { code: 'REPAIR-MINOR', name: 'Мелкий ремонт (час мастера)', category: 'REPAIR', kind: 'OWN_OPS', price: 150_000_00n, sla: 72, desc: 'Замена смесителя, розетки, петель' },
    { code: 'MOVING', name: 'Переезд и подъём мебели', category: 'MOVING', kind: 'PARTNER', partner: 'MoveIt Tashkent', price: 900_000_00n, commissionBp: 1000, sla: 72, desc: 'Бригада 3 человека + газель' },
    { code: 'DESIGN-FURN', name: 'Меблировка под ключ (консультация)', category: 'DESIGN', kind: 'PARTNER', partner: 'Loft Studio', price: 1_500_000_00n, commissionBp: 2000, sla: 168, desc: 'Выезд дизайнера, смета, подбор' },
    { code: 'IT-SETUP', name: 'Интернет и Wi-Fi: подключение', category: 'IT', kind: 'PARTNER', partner: 'CityNet', price: 200_000_00n, commissionBp: 1200, sla: 48, desc: 'Роутер, настройка, тест скорости' },
    { code: 'CONCIERGE', name: 'Консьерж: встреча гостей', category: 'CONCIERGE', kind: 'OWN_OPS', price: 100_000_00n, sla: 12, desc: 'Заселение STR-гостей, ключи, инструктаж' },
  ];
  const items = new Map<string, { id: string; kind: 'OWN_OPS' | 'PARTNER'; partner: string | null; price: bigint; commissionBp: number; sla: number }>();
  for (const c of CATALOG) {
    const row = await prisma.serviceCatalogItem.upsert({
      where: { tenantId_code: { tenantId, code: c.code } },
      create: { tenantId, code: c.code, name: c.name, category: c.category, providerKind: c.kind, partnerName: c.partner ?? null, priceMinor: c.price, currency: 'UZS', commissionBp: c.commissionBp ?? 0, slaHours: c.sla, description: c.desc },
      update: { name: c.name, description: c.desc },
    });
    items.set(c.code, { id: row.id, kind: c.kind, partner: c.partner ?? null, price: c.price, commissionBp: c.commissionBp ?? 0, sla: c.sla });
  }
  const SO: { code: string; status: 'NEW' | 'ACCEPTED' | 'IN_PROGRESS' | 'DONE' | 'VERIFIED' | 'CANCELLED'; ageH: number; qty?: number; late?: boolean; rating?: number; customer?: string }[] = [
    { code: 'CLEAN-STD', status: 'VERIFIED', ageH: 300, rating: 5, customer: 'Гость STR 1203' },
    { code: 'LAUNDRY', status: 'VERIFIED', ageH: 250, rating: 4, customer: 'CityNet' },
    { code: 'MOVING', status: 'DONE', ageH: 120, late: true, customer: 'Sardor Trade' },
    { code: 'CLEAN-DEEP', status: 'DONE', ageH: 96, rating: 5 },
    { code: 'IT-SETUP', status: 'VERIFIED', ageH: 200, rating: 3, customer: 'Nova Law' },
    { code: 'DESIGN-FURN', status: 'IN_PROGRESS', ageH: 60 },
    { code: 'REPAIR-MINOR', status: 'ACCEPTED', ageH: 10, qty: 2 },
    { code: 'CLEAN-STD', status: 'NEW', ageH: 2, customer: 'Гость STR 1405' },
    { code: 'LAUNDRY', status: 'NEW', ageH: 70, late: true },
    { code: 'CONCIERGE', status: 'CANCELLED', ageH: 40 },
    { code: 'CLEAN-STD', status: 'VERIFIED', ageH: 400, rating: 4 },
    { code: 'MOVING', status: 'VERIFIED', ageH: 500, rating: 5, customer: 'Barakat Group' },
  ];
  let soCreated = 0;
  if (reporter && opsId) {
    const year = new Date().getFullYear();
    for (let i = 0; i < SO.length; i++) {
      const number = `SO-${year}-${String(i + 1).padStart(6, '0')}`;
      if (await prisma.serviceOrder.findUnique({ where: { tenantId_number: { tenantId, number } } })) continue;
      const o = SO[i]!;
      const item = items.get(o.code)!;
      const unit = allUnits[(i * 17 + 3) % allUnits.length]!;
      const createdAt = daysAgo(o.ageH / 24);
      const scheduledAt = new Date(createdAt.getTime() + 3_600_000);
      const dueAt = new Date(scheduledAt.getTime() + item.sla * 3_600_000);
      const qty = o.qty ?? 1;
      const assigned = o.status !== 'NEW' && o.status !== 'CANCELLED' ? opsUsers[i % Math.max(1, opsUsers.length)]!.userId : null;
      const doneAt = ['DONE', 'VERIFIED'].includes(o.status) ? new Date(dueAt.getTime() + (o.late ? 6 : -6) * 3_600_000) : null;
      await prisma.serviceOrder.create({
        data: {
          tenantId, number, catalogItemId: item.id, unitId: unit.id, buildingId: unit.buildingId, status: o.status, providerKind: item.kind, partnerName: item.partner, priceMinor: item.price * BigInt(qty), currency: 'UZS', commissionBp: item.commissionBp, quantity: qty,
          customerName: o.customer ?? null, ordererId: reporter, assigneeId: assigned, scheduledAt, dueAt, createdAt,
          acceptedAt: assigned ? new Date(createdAt.getTime() + 1_800_000) : null,
          startedAt: ['IN_PROGRESS', 'DONE', 'VERIFIED'].includes(o.status) ? scheduledAt : null,
          doneAt, verifiedAt: o.status === 'VERIFIED' && doneAt ? new Date(doneAt.getTime() + 3_600_000) : null, verifiedBy: o.status === 'VERIFIED' ? reporter : null,
          rating: o.rating ?? null, cancelReason: o.status === 'CANCELLED' ? 'гость отменил бронь' : null,
          overdueNotifiedAt: o.late && !doneAt ? new Date() : null,
        },
      });
      soCreated++;
    }
    const want = SO.length + 1;
    const seq = await prisma.sequence.findUnique({ where: { tenantId_key_year: { tenantId, key: 'SO', year } } });
    if (!seq) await prisma.sequence.create({ data: { tenantId, key: 'SO', year, nextValue: want } });
    else if (seq.nextValue < want) await prisma.sequence.update({ where: { id: seq.id }, data: { nextValue: want } });
  }
  console.log(`  services: ${items.size} catalog items, ${soCreated} orders created`);

  // ── P-18: аренда и дебиторка — счёт УК, начисления по действующим договорам, часть оплачена по выписке, часть просрочена ──
  const bankKey = process.env.BANK_DATA_KEY ?? 'DHqPbmDW3nUOytHplLmVMkP2mSVJlRlXWLh2GYYx4hg='; // только dev
  const accountNo = '20208840900000770101';
  let account = await prisma.bankAccount.findFirst({ where: { tenantId, accountMasked: maskAccount(accountNo) } });
  if (!account) account = await prisma.bankAccount.create({ data: { tenantId, bankName: 'Капиталбанк', mfo: '01088', accountMasked: maskAccount(accountNo), accountEncrypted: encryptSecret(accountNo, bankKey), currency: 'USD', openingBalanceMinor: 25_000_000n, openingBalanceDate: new Date('2026-06-01') } });
  const generated = await generateRentCharges(tenantId, new Date(), { fromMonth: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1)) }); // последние 3 месяца, только юниты под управлением
  // Оплаты: детерминированно — по каждому третьему начислению прошлых месяцев приходит поступление и зачитывается (PAID только через транзакцию)
  const charges = await prisma.rentCharge.findMany({ where: { tenantId, status: 'DUE' }, include: { lease: { select: { occupantName: true } }, unit: { select: { unitNo: true } } }, orderBy: [{ periodStart: 'asc' }, { unitId: 'asc' }] });
  const finance = (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'FINANCE_OPS_LEAD' }, select: { userId: true } }))?.userId ?? reporter ?? null;
  let paid = 0;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  for (let i = 0; i < charges.length; i++) {
    const c = charges[i]!;
    const past = c.periodStart < monthStart;
    // прошлые месяцы: 2 из 3 оплачены; текущий: 1 из 3
    if (!(past ? i % 3 !== 2 : i % 3 === 0)) continue;
    const externalId = `RENT-${c.number}`;
    if (await prisma.bankTransaction.findUnique({ where: { bankAccountId_externalId: { bankAccountId: account.id, externalId } } })) continue;
    const date = new Date(c.dueAt.getTime() - (i % 4) * 86_400_000);
    const tx = await prisma.bankTransaction.create({ data: { tenantId, bankAccountId: account.id, externalId, bookingDate: date, valueDate: date, amountMinor: c.amountMinor, currency: c.currency, counterpartyName: c.lease.occupantName, purposeText: `Аренда ${c.unit.unitNo} ${c.periodStart.toISOString().slice(0, 7)}`, matchStatus: 'MANUAL_MATCHED' } });
    await prisma.reconciliationMatch.create({ data: { tenantId, bankTransactionId: tx.id, objectType: 'RENT_CHARGE', objectId: c.id, amountMinor: c.amountMinor, matchedBy: finance, method: 'MANUAL', confidence: 1 } });
    await prisma.rentCharge.update({ where: { id: c.id }, data: { receivedMinor: c.amountMinor, status: 'PAID', paidAt: date } });
    paid++;
  }
  // Нераспределённые поступления для формы зачёта
  for (const [k, amt] of [['RENT-UNMATCHED-1', 180_000n], ['RENT-UNMATCHED-2', 250_000n], ['RENT-UNMATCHED-3', 95_000n]] as const) {
    if (await prisma.bankTransaction.findUnique({ where: { bankAccountId_externalId: { bankAccountId: account.id, externalId: k } } })) continue;
    await prisma.bankTransaction.create({ data: { tenantId, bankAccountId: account.id, externalId: k, bookingDate: daysAgo(2), valueDate: daysAgo(2), amountMinor: amt, currency: 'USD', counterpartyName: k === 'RENT-UNMATCHED-1' ? 'Uzbek Textile Group' : k === 'RENT-UNMATCHED-2' ? 'Nova Law' : 'Частное лицо', purposeText: 'Оплата аренды' } });
  }
  const overdue = await markOverdueRentCharges(tenantId);
  console.log(`  rent: ${generated} charges generated, ${paid} paid by bank tx, ${overdue} marked overdue`);

  // ── P-14: комиссии ORDO и бонусы — три выигранные сделки через сервисы (реальный поток: WON → комиссия → оплата → KPI) ──
  if (cmUser && brUser && finance && (await prisma.commission.count({ where: { tenantId } })) === 0) {
    const cm = unsafeCreateTenantContext({ tenantId, tenantSlug: PROPERTY_TENANT.slug, userId: cmUser, roles: ['COMMERCIAL_MANAGER'] });
    const fin = unsafeCreateTenantContext({ tenantId, tenantSlug: PROPERTY_TENANT.slug, userId: finance, roles: ['FINANCE_OPS_LEAD'] });
    const free = await prisma.unit.findMany({ where: { tenantId, occupancy: 'VACANT', readiness: 'READY', type: { in: ['APARTMENT', 'OFFICE'] }, leases: { none: { status: { in: ['ACTIVE', 'EXPIRING'] } } } }, orderBy: { unitNo: 'asc' }, take: 3 });
    if (free.length === 3) {
      // 1. аренда квартиры брокером: WON, комиссия получена, KPI подтверждён → бонусы к выплате
      const d1 = await createDeal(cm, { contactName: 'Камола Юсупова', company: null, unitId: free[0]!.id, managerId: brUser, product: free[0]!.type === 'OFFICE' ? 'LEASE_OFFICE' : 'LEASE_LTR', source: 'WEBSITE' });
      const l1 = await createLease(cm, { unitId: free[0]!.id, dealId: d1.id, type: 'LTR', occupantName: 'Камола Юсупова', startAt: daysAgo(10), endAt: daysAhead(355), rentMinor: free[0]!.askingRateMinor ?? 150_000n, depositMinor: free[0]!.askingRateMinor ?? 150_000n, depositReceived: true });
      await activateLease(cm, l1.id, daysAgo(10));
      const c1 = await prisma.commission.findUnique({ where: { dealId: d1.id } });
      if (c1) {
        const t1 = await prisma.bankTransaction.create({ data: { tenantId, bankAccountId: account.id, externalId: `COMM-${c1.number}`, bookingDate: daysAgo(6), valueDate: daysAgo(6), amountMinor: c1.amountMinor, currency: c1.currency, counterpartyName: 'Камола Юсупова', purposeText: `Комиссия ${c1.number}` } });
        await matchCommissionReceipt(fin, { bankTransactionId: t1.id, commissionId: c1.id }, daysAgo(6));
        for (const item of ['ONBOARDING', 'ACCESS_KEYS', 'INTERNET', 'CLEANING', 'HANDOVER_SERVICES'] as const) await markChecklistItem(unsafeCreateTenantContext({ tenantId, tenantSlug: PROPERTY_TENANT.slug, userId: opsId ?? cmUser, roles: ['OPERATIONS_MANAGER'] }), d1.id, item, true, null, daysAgo(4));
        await confirmKpi(cm, d1.id, daysAgo(3));
      }
      // 2. аренда офиса c внешним брокером: WON, комиссия к получению, чек-лист наполовину
      const d2 = await createDeal(cm, { contactName: 'Фаррух Умаров', company: 'Delta Consulting', unitId: free[1]!.id, managerId: cmUser, product: free[1]!.type === 'OFFICE' ? 'LEASE_OFFICE' : 'LEASE_LTR', source: 'BROKER', externalBrokerName: 'UzFranchise', externalShareBp: 2000 });
      const l2 = await createLease(cm, { unitId: free[1]!.id, dealId: d2.id, type: 'LTR', occupantName: 'Delta Consulting', startAt: daysAgo(3), endAt: daysAhead(727), rentMinor: free[1]!.askingRateMinor ?? 400_000n });
      await activateLease(cm, l2.id, daysAgo(3));
      for (const item of ['ONBOARDING', 'ACCESS_KEYS'] as const) await markChecklistItem(cm, d2.id, item, true, null, daysAgo(1));
      // 3. продажа: закрыта ценой, комиссия 3% к получению
      const d3 = await createDeal(cm, { contactName: 'Сардор Алиев', unitId: free[2]!.id, managerId: brUser, product: 'SALE', source: 'INSTAGRAM' });
      for (let i = 0; i < 5; i++) await moveDeal(cm, d3.id, 'advance');
      await closeSale(cm, d3.id, { salePriceMinor: 28_500_000n }, daysAgo(2));
      console.log('  commissions: 3 deals won (lease paid + KPI, office w/ broker, sale)');
    }
  }

  // ── P-19: ORDO Mall — категории арендаторов, мандаты ДДУ (20 ACTIVE / 4 SIGNED / 3 DRAFT), линии актива ──
  const mall = await prisma.building.findFirst({ where: { tenantId, kind: 'MALL' } });
  if (mall) {
    const mallUnits = await prisma.unit.findMany({ where: { tenantId, buildingId: mall.id, type: 'RETAIL' }, orderBy: { unitNo: 'asc' }, include: { leases: { where: { status: { in: ['ACTIVE', 'EXPIRING'] } } } } });
    const CATS = ['FASHION', 'FOOD_BEVERAGE', 'BEAUTY_HEALTH', 'ELECTRONICS', 'KIDS', 'SERVICES', 'SPORTS', 'HOME', 'GROCERY', 'ENTERTAINMENT'] as const;
    let cats = 0;
    for (let i = 0; i < mallUnits.length; i++) for (const l of mallUnits[i]!.leases) if (!l.tenantCategory) { await prisma.leaseContract.update({ where: { id: l.id }, data: { tenantCategory: CATS[(i * 3) % CATS.length]! } }); cats++; }
    // один магазин — собственнику owner1 (кабинет собственника показывает отчёт ТРЦ)
    const owner1 = ownerUser ? await prisma.propertyOwner.findFirst({ where: { tenantId, userId: ownerUser.id } }) : null;
    if (owner1 && mallUnits[2] && mallUnits[2].ownerId !== owner1.id) await prisma.unit.update({ where: { id: mallUnits[2].id }, data: { ownerId: owner1.id } });
    let mandates = 0;
    const withOwner = (await prisma.unit.findMany({ where: { tenantId, buildingId: mall.id, type: 'RETAIL', ownerId: { not: null } }, orderBy: { unitNo: 'asc' } })).slice(0, 27);
    for (let i = 0; i < withOwner.length; i++) {
      const u = withOwner[i]!;
      if (await prisma.mallMandate.findFirst({ where: { tenantId, unitId: u.id, status: { in: ['DRAFT', 'SIGNED', 'ACTIVE'] } } })) continue;
      const status = i < 20 ? 'ACTIVE' : i < 24 ? 'SIGNED' : 'DRAFT';
      const feeBp = i % 4 === 0 ? 600 : null; // часть ставок «утверждена» для демонстрации; остальные OPEN
      await prisma.mallMandate.create({ data: { tenantId, unitId: u.id, ownerId: u.ownerId!, status, feeBp, successFeeMonths: i % 2 === 0 ? 0.5 : 1, feePublished: feeBp != null && i % 8 === 0, signedAt: status !== 'DRAFT' ? daysAgo(30 + i) : null, startAt: status === 'ACTIVE' ? daysAgo(20 + i) : null, createdBy: cmUser ?? null } });
      if (status === 'ACTIVE') await prisma.unit.update({ where: { id: u.id }, data: { managedByPlatform: true } });
      mandates++;
    }
    const ASSETS: { kind: 'MEDIA' | 'ISLAND' | 'PARKING' | 'PARTNERSHIP'; code: string; name: string; location: string; tariff: bigint; contract?: { name: string; monthly: bigint; months: number } }[] = [
      { kind: 'MEDIA', code: 'LED-ATRIUM', name: 'LED-экран атриума', location: 'атриум, 1 этаж', tariff: 250_000n, contract: { name: 'Coca-Cola Uzbekistan', monthly: 220_000n, months: 12 } },
      { kind: 'MEDIA', code: 'LED-ENTRY', name: 'LED-экран главного входа', location: 'вход A', tariff: 180_000n, contract: { name: 'Ucell', monthly: 150_000n, months: 6 } },
      { kind: 'MEDIA', code: 'LB-01', name: 'Лайтбокс эскалатор 1–2', location: 'эскалатор', tariff: 60_000n },
      { kind: 'MEDIA', code: 'LB-02', name: 'Лайтбокс эскалатор 2–3', location: 'эскалатор', tariff: 60_000n, contract: { name: 'Artel', monthly: 55_000n, months: 3 } },
      { kind: 'MEDIA', code: 'PILLAR-01', name: 'Брендирование колонн (4 шт.)', location: '1 этаж', tariff: 90_000n },
      { kind: 'ISLAND', code: 'ISL-01', name: 'Островок кофе', location: 'атриум', tariff: 120_000n, contract: { name: 'Bon! Coffee', monthly: 120_000n, months: 12 } },
      { kind: 'ISLAND', code: 'ISL-02', name: 'Островок аксессуары', location: '2 этаж', tariff: 80_000n, contract: { name: 'Charm', monthly: 75_000n, months: 12 } },
      { kind: 'ISLAND', code: 'ISL-03', name: 'Островок сезонный', location: '1 этаж у входа B', tariff: 70_000n },
      { kind: 'ISLAND', code: 'PATIO', name: 'Патио (летняя зона)', location: 'терраса', tariff: 115_000n },
      { kind: 'PARKING', code: 'PARK-MALL', name: 'Паркинг ТРЦ, 300 мест', location: '-1 этаж', tariff: 900_000n, contract: { name: 'Посетители (почасовой сбор)', monthly: 640_000n, months: 12 } },
      { kind: 'PARTNERSHIP', code: 'EVENT-Q4', name: 'Спонсорство новогодней активации', location: 'атриум', tariff: 500_000n },
    ];
    let assets = 0;
    for (const a of ASSETS) {
      let row = await prisma.commercialAsset.findFirst({ where: { tenantId, code: a.code } });
      if (!row) { row = await prisma.commercialAsset.create({ data: { tenantId, buildingId: mall.id, kind: a.kind, code: a.code, name: a.name, location: a.location, tariffMinor: a.tariff, currency: 'USD' } }); assets++; }
      if (a.contract && (await prisma.assetContract.count({ where: { assetId: row.id } })) === 0) await prisma.assetContract.create({ data: { tenantId, assetId: row.id, counterpartyName: a.contract.name, monthlyMinor: a.contract.monthly, currency: 'USD', startAt: daysAgo(40), endAt: daysAhead(a.contract.months * 30) } });
    }
    console.log(`  mall: ${cats} tenant categories, ${mandates} mandates, ${assets} assets`);
  }

  // ── P-20: Services v1.0 — условия направлений, каналы/профили, cost-to-serve, пакеты, referral-отчёты CityNet ──
  await prisma.serviceCatalogItem.updateMany({ where: { tenantId, code: 'LAUNDRY' }, data: { clientDiscountBp: 500, involvement: 'MANAGED' } });
  await prisma.serviceCatalogItem.updateMany({ where: { tenantId, code: 'IT-SETUP' }, data: { terms: 'REFERRAL_RECURRING', involvement: 'REFERRAL', partnerName: 'CityNet', commissionBp: 1500 } });
  await prisma.serviceCatalogItem.updateMany({ where: { tenantId, code: 'CLEAN-STD' }, data: { terms: 'PACKAGE' } });
  const CH = ['PORTAL', 'TELEGRAM', 'PHONE', 'APP', 'STAFF', 'TELEGRAM'] as const;
  const CK = ['RESIDENT', 'STR_GUEST', 'OWNER', 'OFFICE_TENANT', 'RESIDENT', 'STR_GUEST'] as const;
  const seededOrders = await prisma.serviceOrder.findMany({ where: { tenantId, channel: 'STAFF', handlingMinutes: 0 }, include: { catalogItem: true }, orderBy: { number: 'asc' } });
  for (let i = 0; i < seededOrders.length; i++) {
    const o = seededOrders[i]!;
    const bp = o.providerKind === 'PARTNER' ? o.commissionBp : (o.catalogItem.ownOpsFeeBp ?? 0);
    const services = (o.priceMinor * BigInt(bp)) / 10_000n;
    await prisma.serviceOrder.update({ where: { id: o.id }, data: { channel: CH[i % CH.length]!, customerKind: CK[i % CK.length]!, listPriceMinor: o.priceMinor, servicesRevenueMinor: services, executorRevenueMinor: o.priceMinor - services, handlingMinutes: [10, 25, 45, 15, 60, 20][i % 6]!, complaint: i % 7 === 3, complaintNote: i % 7 === 3 ? 'не уложились в срок' : null } });
  }
  if ((await prisma.servicePackage.count({ where: { tenantId } })) === 0) {
    const clean = await prisma.serviceCatalogItem.findFirst({ where: { tenantId, code: 'CLEAN-STD' } });
    const laundryItem = await prisma.serviceCatalogItem.findFirst({ where: { tenantId, code: 'LAUNDRY' } });
    const resUnits = await prisma.unit.findMany({ where: { tenantId, type: 'APARTMENT', occupancy: 'OCCUPIED' }, take: 2, orderBy: { unitNo: 'asc' } });
    if (clean && resUnits[0]) await prisma.servicePackage.create({ data: { tenantId, catalogItemId: clean.id, unitId: resUnits[0].id, customerName: resUnits[0].occupantName, customerKind: 'RESIDENT', channel: 'PORTAL', runsPerMonth: 8, monthlyPriceMinor: 1_600_000_00n, currency: 'UZS', startAt: daysAgo(20), nextRunAt: daysAhead(2), lastRunAt: daysAgo(2), createdBy: opsId ?? null } });
    if (laundryItem && resUnits[1]) await prisma.servicePackage.create({ data: { tenantId, catalogItemId: laundryItem.id, unitId: resUnits[1].id, customerName: resUnits[1].occupantName, customerKind: 'STR_GUEST', channel: 'APP', runsPerMonth: 4, monthlyPriceMinor: 400_000_00n, currency: 'UZS', startAt: daysAgo(10), nextRunAt: daysAhead(5), createdBy: opsId ?? null } });
  }
  const periods = [0, 1].map((k) => { const dte = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - k - 1, 1)); return `${dte.getUTCFullYear()}-${String(dte.getUTCMonth() + 1).padStart(2, '0')}`; });
  const officeUnits = await prisma.unit.findMany({ where: { tenantId, type: 'OFFICE', occupancy: 'OCCUPIED' }, take: 12, orderBy: { unitNo: 'asc' } });
  let stLines = 0;
  for (const period of periods) for (let i = 0; i < officeUnits.length; i++) {
    const ref = officeUnits[i]!.unitNo;
    if (await prisma.partnerStatementLine.findUnique({ where: { tenantId_partnerName_period_customerRef: { tenantId, partnerName: 'CityNet', period, customerRef: ref } } })) continue;
    const base = BigInt(600_000 + (i * 137) % 900_000) * 100n;
    await prisma.partnerStatementLine.create({ data: { tenantId, partnerName: 'CityNet', period, customerRef: ref, baseMinor: base, feeBp: 1500, feeMinor: (base * 1500n) / 10_000n, currency: 'UZS', importedBy: opsId ?? null } });
    stLines++;
  }
  console.log(`  services model: ${seededOrders.length} orders enriched, ${stLines} referral lines`);

  // ── P-21: деньги дома — фонд содержания Residence Tower, счёт дома (UZS), кадастр части юнитов, договоры управления, бюджет/расходы, взносы за 3 месяца, оплаты банком ──
  const houseAccountNo = '20208000900000770202';
  let houseAccount = await prisma.bankAccount.findFirst({ where: { tenantId, accountMasked: maskAccount(houseAccountNo) } });
  if (!houseAccount) houseAccount = await prisma.bankAccount.create({ data: { tenantId, bankName: 'Капиталбанк', mfo: '01088', accountMasked: maskAccount(houseAccountNo), accountEncrypted: encryptSecret(houseAccountNo, bankKey), currency: 'UZS', openingBalanceMinor: 0n, openingBalanceDate: new Date('2026-06-01') } });
  let fund = await prisma.houseFund.findFirst({ where: { tenantId, buildingId: tower.id, kind: 'OPERATIONS' } });
  if (!fund) fund = await prisma.houseFund.create({ data: { tenantId, buildingId: tower.id, kind: 'OPERATIONS', name: 'Фонд содержания Residence Tower', bankAccountId: houseAccount.id, tariffPerM2Minor: 12_000_00n, currency: 'UZS', managementFeeBp: null, dueDay: 15, tariffApprovedAt: new Date('2026-02-05') } });
  const towerUnits = await prisma.unit.findMany({ where: { tenantId, buildingId: tower.id, type: 'APARTMENT' }, orderBy: { unitNo: 'asc' }, select: { id: true, unitNo: true, areaM2: true, cadastralAreaM2: true, ownerId: true } });
  let cad = 0;
  for (let i = 0; i < towerUnits.length; i++) {
    const u = towerUnits[i]!;
    if (u.cadastralAreaM2 != null || i % 5 === 4) continue; // каждый пятый — кадастр ещё не внесён (preCadastre)
    const delta = ((i * 7) % 5) - 2; // −2…+2 м² расхождение c договорной
    await prisma.unit.update({ where: { id: u.id }, data: { cadastralNumber: `10:01:04:02:11:${u.unitNo.padStart(4, '0')}`, cadastralAreaM2: new Prisma.Decimal((Number(u.areaM2) + delta * 0.5).toFixed(2)) } });
    cad++;
  }
  const towerOwners = await prisma.propertyOwner.findMany({ where: { tenantId, units: { some: { buildingId: tower.id } } }, orderBy: { displayName: 'asc' }, select: { id: true, managementContractStatus: true } });
  let contracts = 0;
  for (let i = 0; i < towerOwners.length; i++) {
    const o = towerOwners[i]!;
    if (o.managementContractStatus !== 'NONE') continue;
    const st = i % 10 < 6 ? 'SIGNED' : i % 10 < 9 ? 'SENT' : 'DECLINED';
    await prisma.propertyOwner.update({ where: { id: o.id }, data: { managementContractStatus: st, managementContractSignedAt: st === 'SIGNED' ? new Date(Date.UTC(2026, 2, 1 + (i % 25))) : null } });
    contracts++;
  }
  const year = new Date().getUTCFullYear();
  const plan: [string, bigint][] = [['ENGINEERING', 180_000_000_00n], ['LIFTS', 96_000_000_00n], ['FIRE_SAFETY', 48_000_000_00n], ['SECURITY', 240_000_000_00n], ['CLEANING', 216_000_000_00n], ['UTILITIES_COMMON', 264_000_000_00n], ['REPAIRS', 120_000_000_00n], ['MATERIALS', 36_000_000_00n], ['INSURANCE_LICENSES', 24_000_000_00n], ['ADMIN', 60_000_000_00n]];
  for (const [category, plannedMinor] of plan) await prisma.houseBudgetLine.upsert({ where: { fundId_year_category: { fundId: fund.id, year, category: category as never } }, create: { tenantId, fundId: fund.id, year, category: category as never, plannedMinor }, update: {} });
  if ((await prisma.houseExpense.count({ where: { fundId: fund.id } })) === 0) {
    const ex: [number, string, bigint, string, string][] = [
      [40, 'LIFTS', 8_000_000_00n, 'LiftService LLC', 'ТО лифтов (4 шт.), ежемесячно'], [35, 'SECURITY', 20_000_000_00n, 'Qorgon Security', 'Охрана, пост 24/7'], [33, 'CLEANING', 18_000_000_00n, 'CleanPro', 'Уборка МОП и территории'],
      [30, 'UTILITIES_COMMON', 21_500_000_00n, 'Тошкент шаҳар электр тармоқлари', 'Электроэнергия МОП'], [20, 'ENGINEERING', 14_200_000_00n, 'Engineering Systems', 'Обслуживание ИТП и вентиляции'], [12, 'REPAIRS', 6_300_000_00n, 'RemStroy', 'Ремонт входной группы'],
      [10, 'LIFTS', 8_000_000_00n, 'LiftService LLC', 'ТО лифтов (4 шт.), ежемесячно'], [6, 'SECURITY', 20_000_000_00n, 'Qorgon Security', 'Охрана, пост 24/7'], [4, 'CLEANING', 18_000_000_00n, 'CleanPro', 'Уборка МОП и территории'], [2, 'MATERIALS', 1_850_000_00n, 'Hozmag', 'Лампы, расходники'],
    ];
    for (const [ago, category, amountMinor, contractorName, description] of ex) await prisma.houseExpense.create({ data: { tenantId, fundId: fund.id, date: daysAgo(ago), category: category as never, amountMinor, currency: 'UZS', contractorName, description, createdBy: opsId ?? null } });
  }
  const hc = await generateHouseCharges(tenantId, new Date(), { fromMonth: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1)) });
  const houseCharges = await prisma.houseCharge.findMany({ where: { tenantId, fundId: fund.id, status: 'DUE' }, include: { unit: { select: { unitNo: true } } }, orderBy: [{ periodStart: 'asc' }, { unitId: 'asc' }] });
  const ownerNames = new Map((await prisma.propertyOwner.findMany({ where: { tenantId }, select: { id: true, displayName: true } })).map((o) => [o.id, o.displayName]));
  let housePaid = 0;
  for (let i = 0; i < houseCharges.length; i++) {
    const c = houseCharges[i]!;
    const past = c.periodStart < monthStart;
    if (!(past ? i % 4 !== 3 : i % 4 === 0)) continue; // прошлые: 3 из 4 оплачены (≈75%); текущий: 1 из 4
    const externalId = `HOUSE-${c.number}`;
    if (await prisma.bankTransaction.findUnique({ where: { bankAccountId_externalId: { bankAccountId: houseAccount.id, externalId } } })) continue;
    const date = new Date(c.dueAt.getTime() - (i % 6) * 86_400_000);
    const tx = await prisma.bankTransaction.create({ data: { tenantId, bankAccountId: houseAccount.id, externalId, bookingDate: date, valueDate: date, amountMinor: c.amountMinor, currency: 'UZS', counterpartyName: ownerNames.get(c.ownerId) ?? 'Собственник', purposeText: `Взнос на содержание ${c.unit.unitNo} ${c.periodStart.toISOString().slice(0, 7)}`, matchStatus: 'MANUAL_MATCHED' } });
    await prisma.reconciliationMatch.create({ data: { tenantId, bankTransactionId: tx.id, objectType: 'HOUSE_CHARGE', objectId: c.id, amountMinor: c.amountMinor, matchedBy: finance, method: 'MANUAL', confidence: 1 } });
    await prisma.houseCharge.update({ where: { id: c.id }, data: { receivedMinor: c.amountMinor, status: 'PAID', paidAt: date } });
    housePaid++;
  }
  for (const [k, amt, who] of [['HOUSE-UNMATCHED-1', 1_020_000_00n, 'Рустам Каримов'], ['HOUSE-UNMATCHED-2', 780_000_00n, 'Частное лицо']] as const) {
    if (await prisma.bankTransaction.findUnique({ where: { bankAccountId_externalId: { bankAccountId: houseAccount.id, externalId: k } } })) continue;
    await prisma.bankTransaction.create({ data: { tenantId, bankAccountId: houseAccount.id, externalId: k, bookingDate: daysAgo(1), valueDate: daysAgo(1), amountMinor: amt, currency: 'UZS', counterpartyName: who, purposeText: 'Взнос на содержание' } });
  }
  const houseOverdue = await markOverdueHouseCharges(tenantId);
  console.log(`  house: ${cad} cadastre set, ${contracts} contracts, ${hc.created} charges (${hc.withoutOwner} units without owner), ${housePaid} paid by bank tx, ${houseOverdue} overdue`);

  // ── P-22b: воронка собственников — менеджер, источник, следующее действие, расчёт показан у части; настройки расчёта (STR fee OPEN) ──
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).settings as Record<string, unknown>), owner_calc: { str_fee_bp: null, str_occupancy_pct: 65, str_opex_pct: 20, str_adr_multiplier: 2.0, mid_multiplier: 1.25, ltr_vacancy_months: 1, mid_vacancy_months: 1.5, assumed_str_fee_bp: 2000 } } } });
  const pipelineOwners = await prisma.propertyOwner.findMany({ where: { tenantId }, orderBy: { displayName: 'asc' }, select: { id: true, pipelineStage: true, managerId: true, nextAction: true } });
  const sources = ['REFERRAL', 'WALK_IN', 'TELEGRAM', 'WEBSITE', 'BROKER', 'OTHER'] as const;
  const nextActions = ['Позвонить и предложить встречу', 'Отправить расчёт STR / LTR', 'Согласовать договор управления', 'Забрать подписанный договор', 'Передать ключи и акт'];
  let pipelined = 0;
  for (let i = 0; i < pipelineOwners.length; i++) {
    const o = pipelineOwners[i]!;
    if (o.managerId) continue;
    const active = !['HANDED_OVER', 'LOST'].includes(o.pipelineStage);
    const stageIdx = ['LEAD', 'CONTACTED', 'CALC_SHOWN', 'CONSENT', 'CONTRACT_SENT', 'SIGNED'].indexOf(o.pipelineStage);
    await prisma.propertyOwner.update({ where: { id: o.id }, data: { managerId: i % 3 === 0 ? (reporter ?? cmUser ?? null) : (cmUser ?? null), source: sources[i % sources.length]!, stageChangedAt: daysAgo(3 + (i * 7) % 40), ...(active ? { nextAction: nextActions[Math.max(0, Math.min(4, stageIdx))], nextActionAt: i % 4 === 0 ? daysAgo(2 + (i % 5)) : daysAhead(1 + (i % 9)) } : {}), ...(stageIdx >= 2 || (active && i % 2 === 0) ? { calcShownAt: daysAgo(5 + (i % 20)) } : {}) } });
    pipelined++;
  }
  console.log(`  owner pipeline: ${pipelined} owners enriched (manager, source, next action)`);
}
