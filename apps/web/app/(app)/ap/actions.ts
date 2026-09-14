'use server';

import { parseStatementCsv, reconcileVendorStatement } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export interface StatementDiffState {
  error?: string;
  vendorId?: string;
  diff?: {
    matched: { number: string; amount: string }[];
    amountMismatch: { number: string; statement: string; system: string }[];
    missingInSystem: { number: string; amount: string }[];
    missingInStatement: { number: string; amount: string }[];
  };
}

export async function reconcileStatementAction(_prev: StatementDiffState, formData: FormData): Promise<StatementDiffState> {
  const ctx = await requireTenantContext();
  const vendorId = String(formData.get('vendorId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'NO_FILE' };
  try {
    const rows = parseStatementCsv(Buffer.from(await file.arrayBuffer()).toString('utf8'));
    const diff = await reconcileVendorStatement(ctx, vendorId, rows);
    return {
      vendorId,
      diff: {
        matched: diff.matched.map((m) => ({ number: m.number, amount: m.amountMinor.toString() })),
        amountMismatch: diff.amountMismatch.map((m) => ({
          number: m.number,
          statement: m.statementMinor.toString(),
          system: m.systemMinor.toString(),
        })),
        missingInSystem: diff.missingInSystem.map((m) => ({ number: m.number, amount: m.amountMinor.toString() })),
        missingInStatement: diff.missingInStatement.map((m) => ({ number: m.number, amount: m.amountMinor.toString() })),
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
