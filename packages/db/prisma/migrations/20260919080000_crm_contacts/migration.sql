-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('PERSON', 'COMPANY');

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "contact_id" UUID;

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "ContactKind" NOT NULL DEFAULT 'PERSON',
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_alt" TEXT,
    "email" TEXT,
    "company" TEXT,
    "position" TEXT,
    "source" "DealSource",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "owner_id" UUID,
    "manager_id" UUID,
    "last_touch_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_tenant_id_display_name_idx" ON "contact"("tenant_id", "display_name");

-- CreateIndex
CREATE INDEX "contact_tenant_id_email_idx" ON "contact"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "contact_tenant_id_owner_id_idx" ON "contact"("tenant_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tenant_id_phone_key" ON "contact"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "deal_tenant_id_contact_id_idx" ON "deal"("tenant_id", "contact_id");

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill (P-22a): контакты из существующих сделок — один на канонический телефон в тенанте; без телефона — по сделке
WITH src AS (
  SELECT d.tenant_id,
         '+' || CASE WHEN length(regexp_replace(d.contact_phone, '\D', '', 'g')) = 9 THEN '998' || regexp_replace(d.contact_phone, '\D', '', 'g') ELSE regexp_replace(d.contact_phone, '\D', '', 'g') END AS phone,
         (array_agg(d.contact_name ORDER BY d.created_at DESC))[1] AS display_name,
         (array_agg(lower(d.contact_email) ORDER BY d.created_at DESC) FILTER (WHERE d.contact_email IS NOT NULL))[1] AS email,
         (array_agg(d.company ORDER BY d.created_at DESC) FILTER (WHERE d.company IS NOT NULL))[1] AS company,
         (array_agg(d.source ORDER BY d.created_at ASC))[1] AS source,
         (array_agg(d.manager_id ORDER BY d.created_at DESC))[1] AS manager_id,
         min(d.created_at) AS created_at, max(d.updated_at) AS last_touch_at
  FROM "deal" d
  WHERE d.contact_phone IS NOT NULL AND regexp_replace(d.contact_phone, '\D', '', 'g') <> ''
  GROUP BY d.tenant_id, 2
)
INSERT INTO "contact" (id, tenant_id, kind, display_name, phone, email, company, source, manager_id, last_touch_at, created_at, updated_at)
SELECT gen_random_uuid(), tenant_id, 'PERSON', display_name, phone, email, company, source, manager_id, last_touch_at, created_at, now() FROM src;

UPDATE "deal" d SET contact_id = c.id
FROM "contact" c
WHERE d.contact_phone IS NOT NULL AND c.tenant_id = d.tenant_id
  AND c.phone = '+' || CASE WHEN length(regexp_replace(d.contact_phone, '\D', '', 'g')) = 9 THEN '998' || regexp_replace(d.contact_phone, '\D', '', 'g') ELSE regexp_replace(d.contact_phone, '\D', '', 'g') END;

INSERT INTO "contact" (id, tenant_id, kind, display_name, phone, email, company, source, manager_id, last_touch_at, created_at, updated_at)
SELECT gen_random_uuid(), d.tenant_id, 'PERSON', d.contact_name, NULL, lower(d.contact_email), d.company, d.source, d.manager_id, d.updated_at, d.created_at, now()
FROM "deal" d WHERE d.contact_id IS NULL;

UPDATE "deal" d SET contact_id = c.id
FROM "contact" c
WHERE d.contact_id IS NULL AND c.tenant_id = d.tenant_id AND c.phone IS NULL AND c.display_name = d.contact_name AND c.created_at = d.created_at;

-- собственник c тем же телефоном — тот же человек
UPDATE "contact" c SET owner_id = o.id
FROM "property_owner" o
WHERE c.tenant_id = o.tenant_id AND c.phone IS NOT NULL AND o.contact_phone IS NOT NULL
  AND c.phone = '+' || CASE WHEN length(regexp_replace(o.contact_phone, '\D', '', 'g')) = 9 THEN '998' || regexp_replace(o.contact_phone, '\D', '', 'g') ELSE regexp_replace(o.contact_phone, '\D', '', 'g') END;
