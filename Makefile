.PHONY: dev dev-down db-migrate seed test lint typecheck

dev: ## Поднять dev-инфраструктуру (postgres, redis, minio, mailhog)
	docker compose up -d --wait

dev-down:
	docker compose down

db-migrate:
	pnpm --filter @finance-os/db migrate:dev

seed:
	pnpm seed

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck
