-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "diff_hash" TEXT NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_object_type_object_id_idx" ON "audit_log"("tenant_id", "object_type", "object_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_seq_idx" ON "audit_log"("tenant_id", "seq");

-- ── BR-070: append-only. Любой UPDATE/DELETE по audit_log запрещён на уровне БД
-- (триггер работает для любой роли; в prod дополнительно REVOKE у app-роли). ──
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (BR-070)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Prod-роль приложения (если создана) лишается UPDATE/DELETE явно
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_app') THEN
    REVOKE UPDATE, DELETE ON "audit_log" FROM finance_app;
  END IF;
END $$;
