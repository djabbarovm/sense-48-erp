/**
 * E-03: PosAdapter (docs/07 §3) — три CSV-импортёра iiko/POS.
 * Парсинг здесь; запись в БД — pos-сервис в @finance-os/db.
 */

export interface PosDailySalesRow {
  date: string;
  outlet: string;
  category: string;
  revenueGross: string;
  vat: string;
  discounts: string;
  costOfSales: string;
  covers: string;
}

export interface PosInventoryRow {
  date: string;
  outlet: string;
  stockValue: string;
  purchases: string;
  consumption: string;
  waste: string;
  transfers: string;
  theoreticalFoodCost: string;
  actualFoodCost: string;
}

export interface PosBanquetRow {
  iikoOrderId: string;
  eventNumber: string;
  foodCost: string;
  beverageCost: string;
}

function parseCsv(file: Buffer, expectedHeader: string): string[][] {
  const lines = file.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
  if (!lines[0] || lines[0].trim() !== expectedHeader) {
    throw new Error(`POS_CSV: ожидается заголовок "${expectedHeader}"`);
  }
  return lines.slice(1).map((line) => line.split(';').map((c) => c.trim()));
}

export class PosCsvAdapter {
  parseDailySales(file: Buffer): PosDailySalesRow[] {
    return parseCsv(file, 'date;outlet;category;revenue_gross;vat;discounts;cost_of_sales;covers').map(
      ([date = '', outlet = '', category = '', revenueGross = '', vat = '', discounts = '', costOfSales = '', covers = '']) => ({
        date, outlet, category, revenueGross, vat, discounts, costOfSales, covers,
      }),
    );
  }

  parseInventorySnapshot(file: Buffer): PosInventoryRow[] {
    return parseCsv(
      file,
      'date;outlet;stock_value;purchases;consumption;waste;transfers;theoretical_food_cost;actual_food_cost',
    ).map(
      ([date = '', outlet = '', stockValue = '', purchases = '', consumption = '', waste = '', transfers = '', theoreticalFoodCost = '', actualFoodCost = '']) => ({
        date, outlet, stockValue, purchases, consumption, waste, transfers, theoreticalFoodCost, actualFoodCost,
      }),
    );
  }

  parseBanquetMapping(file: Buffer): PosBanquetRow[] {
    return parseCsv(file, 'iiko_order_id;event_number;food_cost;beverage_cost').map(
      ([iikoOrderId = '', eventNumber = '', foodCost = '', beverageCost = '']) => ({
        iikoOrderId, eventNumber, foodCost, beverageCost,
      }),
    );
  }
}
