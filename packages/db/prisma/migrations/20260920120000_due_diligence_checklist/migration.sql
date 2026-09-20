-- Tower ТЗ §5.1 (M1): гейт DUE_DILIGENCE перед CONTRACT. Аддитивно (ADD VALUE).
-- Откат (только пока ни одна строка не использует значение): пересоздать тип без него — см. DECISIONS ADR.
ALTER TYPE "KpiChecklistItem" ADD VALUE IF NOT EXISTS 'DUE_DILIGENCE';
