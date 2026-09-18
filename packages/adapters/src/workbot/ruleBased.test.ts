import { describe, expect, it } from 'vitest';
import { RuleBasedIntentExtractor } from './ruleBased.js';

const x = new RuleBasedIntentExtractor();

describe('P-12 rule-based IntentExtractor (blueprint §1.9)', () => {
  it('«1704 освободился, можно выставлять» → UNIT_VACATE + publish', async () => {
    const r = await x.extract({ text: '1704 освободился, можно выставлять' });
    expect(r.intent).toMatchObject({ kind: 'UNIT_VACATE', unitNo: '1704', publish: true });
    expect(r.confidence).toBeGreaterThan(0.8);
  });
  it('«1103 показали X Company, хотят 35 долларов за метр» → DEAL_VIEWING_NOTE c компанией и ставкой', async () => {
    const r = await x.extract({ text: '1103 показали X Company, хотят 35 долларов за метр' });
    expect(r.intent).toMatchObject({ kind: 'DEAL_VIEWING_NOTE', unitNo: '1103', company: 'X Company', expectedRateMinor: 3_500n, perSqm: true });
  });
  it('«B8-2 показали CityNet, интересно» → юнит c префиксом, ставка не распознана', async () => {
    const r = await x.extract({ text: 'B8-2 показали CityNet, интересно' });
    expect(r.intent).toMatchObject({ kind: 'DEAL_VIEWING_NOTE', unitNo: 'B8-2', company: 'CityNet', expectedRateMinor: null });
  });
  it('«2804 после клининга, жалоба на ванную» → UNIT_ISSUE PLUMBING; «затопило» → CRITICAL', async () => {
    const r = await x.extract({ text: '2804 после клининга, жалоба на ванную' });
    expect(r.intent).toMatchObject({ kind: 'UNIT_ISSUE', unitNo: '2804', category: 'PLUMBING', severity: 'ISSUE' });
    const c = await x.extract({ text: '1201 затопило, нет воды, срочно' });
    expect(c.intent).toMatchObject({ kind: 'UNIT_ISSUE', severity: 'CRITICAL' });
  });
  it('«Покажи все красные больше 90 дней» → QUERY_UNITS; «покажи договоры, которые истекают в ближайшие 60 дней»', async () => {
    const r = await x.extract({ text: 'Покажи все красные больше 90 дней' });
    expect(r.intent).toMatchObject({ kind: 'QUERY_UNITS', color: 'RED', vacantOverDays: 90 });
    const e = await x.extract({ text: 'покажи договоры, которые истекают в ближайшие 60 дней' });
    expect(e.intent).toMatchObject({ kind: 'QUERY_UNITS', leaseEndsWithinDays: 60 });
  });
  it('без юнита и глагола → intent null, низкая уверенность', async () => {
    const r = await x.extract({ text: 'привет, как дела' });
    expect(r.intent).toBeNull();
    expect(r.confidence).toBe(0);
  });
});
