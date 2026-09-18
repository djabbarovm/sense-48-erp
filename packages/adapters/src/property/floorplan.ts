/**
 * P-08: импорт геометрии этажа (docs/20 §7.2). Два формата, оба → FloorPlanSpec:
 *  - JSON: { building_code, floor_no, view_box?, units: { "1201": [[x,y],...], ... } }
 *  - SVG (экспорт из CAD/Figma): <polygon|polyline|rect|path id="1201" …> или data-unit="1201";
 *    path — только прямые сегменты (M/L/H/V/Z), кривые не поддерживаются намеренно.
 * Парсер чистый; связывание c юнитами и версионирование — в db/services/propertyImport.
 */

export type Point = [number, number];

export interface FloorPlanSpec {
  buildingCode?: string;
  floorNo?: number;
  viewBox: string;
  units: Record<string, Point[]>;
}

export interface FloorPlanParseResult {
  spec: FloorPlanSpec;
  warnings: string[];
}

const DEFAULT_VIEW_BOX = '0 0 1000 600';

function isPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function parseFloorPlanJson(text: string): FloorPlanParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('FLOORPLAN_JSON_INVALID');
  }
  if (!raw || typeof raw !== 'object') throw new Error('FLOORPLAN_JSON_INVALID');
  const o = raw as Record<string, unknown>;
  const unitsRaw = o.units;
  if (!unitsRaw || typeof unitsRaw !== 'object') throw new Error('FLOORPLAN_UNITS_MISSING');
  const units: Record<string, Point[]> = {};
  const warnings: string[] = [];
  for (const [unitNo, pts] of Object.entries(unitsRaw as Record<string, unknown>)) {
    if (!Array.isArray(pts) || pts.length < 3 || !pts.every(isPoint)) {
      warnings.push(`${unitNo}: polygon must have ≥3 numeric points`);
      continue;
    }
    units[unitNo.trim()] = pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  }
  const spec: FloorPlanSpec = { viewBox: typeof o.view_box === 'string' && o.view_box.trim() ? o.view_box.trim() : DEFAULT_VIEW_BOX, units };
  if (typeof o.building_code === 'string' && o.building_code.trim()) spec.buildingCode = o.building_code.trim().toUpperCase();
  if (typeof o.floor_no === 'number' && Number.isInteger(o.floor_no)) spec.floorNo = o.floor_no;
  return { spec, warnings };
}

const NUM = /-?\d+(?:\.\d+)?(?:e-?\d+)?/gi;

function parsePoints(attr: string): Point[] {
  const nums = (attr.match(NUM) ?? []).map(Number);
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  return pts;
}

/** Только прямые сегменты; относительные команды приводятся к абсолютным. */
function parsePathStraight(d: string): Point[] | null {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
  const pts: Point[] = [];
  let cmd = '';
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/^[A-Za-z]$/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd === 'Z' || cmd === 'z') continue;
    }
    switch (cmd) {
      case 'M': case 'L': x = num(); y = num(); pts.push([x, y]); break;
      case 'm': case 'l': x += num(); y += num(); pts.push([x, y]); break;
      case 'H': x = num(); pts.push([x, y]); break;
      case 'h': x += num(); pts.push([x, y]); break;
      case 'V': y = num(); pts.push([x, y]); break;
      case 'v': y += num(); pts.push([x, y]); break;
      default: return null; // кривые (C/Q/A/S/T) не поддерживаем
    }
  }
  return pts.length >= 3 ? pts : null;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`)) ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`));
  return m?.[1];
}

export function parseFloorPlanSvg(text: string): FloorPlanParseResult {
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) throw new Error('FLOORPLAN_SVG_INVALID');
  const viewBox = attr(svgTag, 'viewBox')?.trim() || DEFAULT_VIEW_BOX;
  const units: Record<string, Point[]> = {};
  const warnings: string[] = [];
  const tags = text.match(/<(polygon|polyline|rect|path)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const id = attr(tag, 'data-unit') ?? attr(tag, 'id');
    if (!id) continue;
    const unitNo = id.trim();
    let pts: Point[] | null = null;
    if (/^<(polygon|polyline)/i.test(tag)) pts = parsePoints(attr(tag, 'points') ?? '');
    else if (/^<rect/i.test(tag)) {
      const x = Number(attr(tag, 'x') ?? 0), y = Number(attr(tag, 'y') ?? 0), w = Number(attr(tag, 'width')), h = Number(attr(tag, 'height'));
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    } else pts = parsePathStraight(attr(tag, 'd') ?? '');
    if (!pts || pts.length < 3) {
      warnings.push(`${unitNo}: unsupported or degenerate shape`);
      continue;
    }
    if (units[unitNo]) warnings.push(`${unitNo}: duplicate shape, last one wins`);
    units[unitNo] = pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  }
  return { spec: { viewBox, units }, warnings };
}

export function parseFloorPlan(text: string, format: 'json' | 'svg'): FloorPlanParseResult {
  return format === 'json' ? parseFloorPlanJson(text) : parseFloorPlanSvg(text);
}
