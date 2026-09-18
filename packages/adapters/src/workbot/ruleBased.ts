/**
 * Rule-based IntentExtractor: детерминированные регулярные выражения по примерам blueprint §1.9.
 * Без сети и моделей — работает в тестах и оффлайн. Возвращает confidence по числу совпавших признаков.
 */
import type { Intent, IntentExtraction, IntentExtractor } from './types.js';

const UNIT_RE = /\b([A-Za-zА-Яа-я]{1,2}\d{1,2}-\d{1,3}|\d{3,4})\b/;
const MONEY_RE = /(\d+(?:[.,]\d{1,2})?)\s*(?:долл(?:ар(?:ов|а)?)?|\$|usd|у\.?е\.?)/i;
const DAYS_RE = /(?:больше|более|старше|>|свыше)\s*(\d{1,3})\s*(?:дн|дней|день)/i;
const WITHIN_RE = /(?:в ближайшие|ближайшие|за|через)\s*(\d{1,3})\s*(?:дн|дней|день)/i;

const COLOR_WORDS: [RegExp, NonNullable<Extract<Intent, { kind: 'QUERY_UNITS' }>['color']>][] = [
  [/красн|свободн|пуст/i, 'RED'],
  [/сер|ремонт/i, 'GREY'],
  [/зел[её]н|заселен|ltr/i, 'GREEN'],
  [/ж[её]лт|str|airbnb|краткосроч/i, 'YELLOW'],
  [/син|собственник/i, 'BLUE'],
];

const ISSUE_CATEGORY: [RegExp, 'PLUMBING' | 'ELECTRICAL' | 'CLEANING' | 'DAMAGE'][] = [
  [/ванн|сантех|труб|протеч|течь|кран|унитаз|канализ/i, 'PLUMBING'],
  [/электр|розетк|свет|проводк|щиток/i, 'ELECTRICAL'],
  [/клининг|уборк|гряз|мусор/i, 'CLEANING'],
  [/поврежд|слома|разби|дверь|замок|стекл/i, 'DAMAGE'],
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function findUnit(text: string): string | null {
  const m = text.match(UNIT_RE);
  return m ? m[1]!.toUpperCase() : null;
}

function money(text: string): bigint | null {
  const m = text.match(MONEY_RE);
  if (!m) return null;
  const [whole, frac = ''] = m[1]!.replace(',', '.').split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
}

export class RuleBasedIntentExtractor implements IntentExtractor {
  async extract({ text }: { text: string }): Promise<IntentExtraction> {
    const t = norm(text);
    const unitNo = findUnit(t);
    const entities: IntentExtraction['entities'] = { unitNo };

    // 1. Запрос списка: «покажи все красные больше 90 дней»
    if (/^(покажи|выведи|список|найди|какие|сколько)/i.test(t) || /покажи|выведи/i.test(t)) {
      const color = COLOR_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
      const over = t.match(DAYS_RE);
      const within = t.match(WITHIN_RE);
      const rentalMode = /\bstr\b|airbnb|краткосроч/i.test(t) ? 'STR' : /\bltr\b|долгосроч/i.test(t) ? 'LTR' : null;
      const isExpiring = /истека|заканчива|оконч/i.test(t);
      const intent: Intent = {
        kind: 'QUERY_UNITS',
        color: isExpiring ? 'GREEN' : color,
        vacantOverDays: over && !isExpiring ? Number(over[1]) : null,
        leaseEndsWithinDays: isExpiring ? Number(within?.[1] ?? over?.[1] ?? 30) : null,
        rentalMode,
      };
      Object.assign(entities, { color: intent.color, vacantOverDays: intent.vacantOverDays, leaseEndsWithinDays: intent.leaseEndsWithinDays, rentalMode });
      return { intent, confidence: color || over || within || isExpiring ? 0.9 : 0.5, entities };
    }

    if (!unitNo) return { intent: null, confidence: 0, entities };

    // 2. Освобождение: «1704 освободился, можно выставлять»
    if (/освобод|съехал|выехал|выселил|вакант|пуст[оа]й?\b/i.test(t)) {
      const publish = /выстав|публик|рынок|сдава/i.test(t);
      Object.assign(entities, { publish });
      return { intent: { kind: 'UNIT_VACATE', unitNo, publish }, confidence: 0.85, entities };
    }

    // 3. Показ / переговоры: «1103 показали X Company, хотят 35 долларов»
    if (/показ|смотрел|посмотрел|интерес|хотят|предлага|торг/i.test(t)) {
      const company = t.match(/показ(?:али|ал|)\s+(?:юнит\s+)?(?:[A-Za-zА-Яа-я]{0,2}\d[\d-]*\s+)?([A-ZА-Я][\w&.\- ]{1,40}?)(?:,|\s+хот|\s+интерес|\s+предлаг|$)/)?.[1]?.trim() ?? null;
      const rate = money(t);
      const perSqm = /м²|м2|кв\.?\s*м|за метр|метр/i.test(t);
      Object.assign(entities, { company, expectedRate: rate != null ? Number(rate) / 100 : null, perSqm });
      return { intent: { kind: 'DEAL_VIEWING_NOTE', unitNo, company, expectedRateMinor: rate, perSqm, note: t }, confidence: company || rate ? 0.85 : 0.6, entities };
    }

    // 4. Инцидент: «2804 после клининга, жалоба на ванную»
    if (/жалоб|слома|не работает|протеч|поврежд|инцидент|авари|проблем|течь|теч[её]т|затоп|нет воды|нет света|разби|срочно/i.test(t)) {
      const category = ISSUE_CATEGORY.find(([re]) => re.test(t))?.[1] ?? 'OTHER';
      const severity = /авари|затоп|пожар|срочно|критич|нет воды|нет света/i.test(t) ? 'CRITICAL' : 'ISSUE';
      Object.assign(entities, { category, severity });
      return { intent: { kind: 'UNIT_ISSUE', unitNo, category, severity, note: t }, confidence: 0.8, entities };
    }

    return { intent: null, confidence: 0.2, entities };
  }
}
