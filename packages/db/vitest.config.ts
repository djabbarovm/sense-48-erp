import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Интеграционные тесты БД идут последовательно против одной базы
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://finance:finance@localhost:5432/finance_os',
    },
  },
});
