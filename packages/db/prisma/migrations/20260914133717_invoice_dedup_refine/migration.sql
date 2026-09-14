-- BR-002 уточнение: уникальность (tenant, vendor, number, date) — только для
-- оригиналов (duplicate_of IS NULL). Счёт, разрешённый Lead как NOT_DUPLICATE
-- (например, корректировочный), сохраняет ссылку duplicate_of и живёт рядом.
DROP INDEX IF EXISTS "invoice_dedup_unique";
CREATE UNIQUE INDEX "invoice_dedup_unique"
  ON "invoice" ("tenant_id", "vendor_id", "number", "date")
  WHERE status <> 'CANCELLED' AND status <> 'DUPLICATE_SUSPECT' AND "duplicate_of" IS NULL;
