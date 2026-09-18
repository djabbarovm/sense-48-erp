/** Wave 2: публичный inventory для сайта/бота — только опубликованные юниты, без PII (docs/20 §11.3, blueprint §3/§5). */
import { deriveUnitView } from '@finance-os/core';
import { prisma } from '../client.js';

export interface PublicUnit {
  unitNo: string;
  building: { code: string; name: string; kind: string };
  floorNo: number;
  type: string;
  areaM2: number;
  askingRateMinor: string | null; // строкой — BigInt не сериализуется в JSON
  currency: string;
  status: string; // цвет как категория доступности
  publishedAt: string;
}

export async function listPublicInventory(tenantId: string, today = new Date()): Promise<PublicUnit[]> {
  const units = await prisma.unit.findMany({
    where: { tenantId, publishedAt: { not: null } },
    include: { building: { select: { code: true, name: true, kind: true } }, floor: { select: { floorNo: true } } },
    orderBy: [{ buildingId: 'asc' }, { unitNo: 'asc' }],
  });
  return units
    .map((u) => ({ u, view: deriveUnitView(u, today) }))
    .filter(({ view }) => view.isSellable) // защита: снятый c рынка юнит не утекает даже при рассинхроне publishedAt
    .map(({ u, view }) => ({
      unitNo: u.unitNo,
      building: u.building,
      floorNo: u.floor.floorNo,
      type: u.type,
      areaM2: Number(u.areaM2),
      askingRateMinor: u.askingRateMinor?.toString() ?? null,
      currency: u.askingCurrency,
      status: view.color,
      publishedAt: u.publishedAt!.toISOString(),
    }));
}
