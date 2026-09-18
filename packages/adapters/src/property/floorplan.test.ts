import { describe, expect, it } from 'vitest';
import { parseFloorPlanJson, parseFloorPlanSvg } from './floorplan.js';

describe('P-08 парсер планов этажа', () => {
  it('JSON: building/floor/viewBox/units, плохие полигоны → warning', () => {
    const r = parseFloorPlanJson(JSON.stringify({ building_code: 'tower', floor_no: 12, view_box: '0 0 800 400', units: { '1201': [[0, 0], [100, 0], [100, 50]], BAD: [[1, 2]] } }));
    expect(r.spec.buildingCode).toBe('TOWER');
    expect(r.spec.floorNo).toBe(12);
    expect(r.spec.viewBox).toBe('0 0 800 400');
    expect(Object.keys(r.spec.units)).toEqual(['1201']);
    expect(r.warnings[0]).toMatch(/BAD/);
    expect(() => parseFloorPlanJson('{')).toThrow(/FLOORPLAN_JSON_INVALID/);
    expect(() => parseFloorPlanJson('{}')).toThrow(/FLOORPLAN_UNITS_MISSING/);
  });

  it('SVG: polygon/rect/path(прямые) по id или data-unit; кривые → warning', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
      <polygon id="1201" points="0,0 250,0 250,230 0,230"/>
      <rect data-unit="1202" x="250" y="0" width="250" height="230"/>
      <path id="1203" d="M500 0 L750 0 L750 230 L500 230 Z"/>
      <path id="1204" d="M750 0 h250 v230 h-250 z"/>
      <path id="CURVE" d="M0 0 C 10 10 20 20 30 30"/>
      <polygon points="1,1 2,2 3,3"/>
    </svg>`;
    const r = parseFloorPlanSvg(svg);
    expect(r.spec.viewBox).toBe('0 0 1000 600');
    expect(r.spec.units['1201']).toEqual([[0, 0], [250, 0], [250, 230], [0, 230]]);
    expect(r.spec.units['1202']).toEqual([[250, 0], [500, 0], [500, 230], [250, 230]]);
    expect(r.spec.units['1203']).toHaveLength(4);
    expect(r.spec.units['1204']).toEqual([[750, 0], [1000, 0], [1000, 230], [750, 230]]);
    expect(r.spec.units.CURVE).toBeUndefined();
    expect(r.warnings.join()).toMatch(/CURVE/);
    expect(() => parseFloorPlanSvg('<div/>')).toThrow(/FLOORPLAN_SVG_INVALID/);
  });
});
