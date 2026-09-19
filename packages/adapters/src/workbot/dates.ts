/**
 * Разбор дат/времени из свободного текста сотрудника (русский): «завтра 15:00», «в пятницу», «20.09 14:30», «сегодня в 18», «через 2 дня».
 * Время — локальное Ташкента (UTC+5); результат — Date (UTC). Возвращает также текст без распознанных токенов.
 */
const TZ_MIN = 300;
// `\b` в JS не знает кириллицу — границы слов через lookaround по \p{L}
const W = (words: string) => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, 'iu');
const WEEKDAYS: [RegExp, number][] = [[W('(?:в\\s+|до\\s+)?(?:понедельник[а-яё]*|пн)'), 1], [W('(?:во\\s+|до\\s+)?(?:вторник[а-яё]*|вт)'), 2], [W('(?:в\\s+|до\\s+)?(?:сред[а-яё]+|ср)'), 3], [W('(?:в\\s+|до\\s+)?(?:четверг[а-яё]*|чт)'), 4], [W('(?:в\\s+|до\\s+)?(?:пятниц[а-яё]+|пт)'), 5], [W('(?:в\\s+|до\\s+)?(?:суббот[а-яё]+|сб)'), 6], [W('(?:в\\s+|до\\s+)?(?:воскресень[а-яё]+|вс)'), 0]];
const TIME_RE = /(?<![\d:])(?:(?<![\p{L}])в\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d])/u;
const HOUR_RE = /(?<![\p{L}])в\s+([01]?\d|2[0-3])(?![\d:.])(?!\s*(?:дн|дня|дней|мес|нед|кв|м²|м2|\$))/iu;
const DMY_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d:.])/;
const IN_DAYS_RE = /(?<![\p{L}])через\s+(\d{1,2})\s*(?:дн|дня|дней|день)(?![\p{L}])/iu;
const TODAY_RE = W('сегодня'); const TOMORROW_RE = W('завтра'); const AFTER_RE = W('послезавтра');

const localParts = (d: Date) => { const l = new Date(d.getTime() + TZ_MIN * 60_000); return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), dow: l.getUTCDay() }; };
const make = (y: number, m: number, d: number, hh: number, mm: number) => new Date(Date.UTC(y, m, d, hh, mm) - TZ_MIN * 60_000);

export interface ParsedDateTime { at: Date | null; hasTime: boolean; rest: string }

export function parseRuDateTime(text: string, now = new Date()): ParsedDateTime {
  let rest = text;
  const { y, m, d, dow } = localParts(now);
  let day: [number, number, number] | null = null;
  const dmy = rest.match(DMY_RE);
  if (dmy) { const yy = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : y; day = [yy, Number(dmy[2]) - 1, Number(dmy[1])]; rest = rest.replace(dmy[0], ' '); }
  else if (AFTER_RE.test(rest)) { day = [y, m, d + 2]; rest = rest.replace(AFTER_RE, ' '); }
  else if (TOMORROW_RE.test(rest)) { day = [y, m, d + 1]; rest = rest.replace(TOMORROW_RE, ' '); }
  else if (TODAY_RE.test(rest)) { day = [y, m, d]; rest = rest.replace(TODAY_RE, ' '); }
  else {
    const inDays = rest.match(IN_DAYS_RE);
    if (inDays) { day = [y, m, d + Number(inDays[1])]; rest = rest.replace(inDays[0], ' '); }
    else for (const [re, wd] of WEEKDAYS) { const mm = rest.match(re); if (mm) { let delta = (wd - dow + 7) % 7; if (delta === 0) delta = 7; day = [y, m, d + delta]; rest = rest.replace(mm[0], ' '); break; } }
  }
  let hh: number | null = null; let mi = 0;
  const tm = rest.match(TIME_RE);
  if (tm) { hh = Number(tm[1]); mi = Number(tm[2]); rest = rest.replace(tm[0], ' '); }
  else { const hm = rest.match(HOUR_RE); if (hm && day) { hh = Number(hm[1]); rest = rest.replace(hm[0], ' '); } }
  if (!day && hh == null) return { at: null, hasTime: false, rest: text };
  if (!day) { day = [y, m, d]; const cand = make(day[0], day[1], day[2], hh!, mi); if (cand <= now) day = [y, m, d + 1]; }
  const at = make(day[0], day[1], day[2], hh ?? 9, mi);
  return { at, hasTime: hh != null, rest: rest.replace(/\s+/g, ' ').trim() };
}

export const PHONE_RE = /(\+?\d[\d\s()-]{6,}\d)/;
export function extractPhone(text: string): { phone: string | null; rest: string } {
  const m = text.match(PHONE_RE);
  if (!m) return { phone: null, rest: text };
  const digits = m[1]!.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return { phone: null, rest: text };
  return { phone: `+${digits.length === 9 ? `998${digits}` : digits}`, rest: text.replace(m[0], ' ').replace(/\s+/g, ' ').trim() };
}
