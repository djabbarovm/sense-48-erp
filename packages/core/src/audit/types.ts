/** Что пишет доменный слой при каждой мутации финансового объекта (BR-070). */
export interface AuditEntry {
  action: string; // payment_request.submit, vendor.bank_account.change …
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
}

/** Запись, как она хранится (минимум, нужный для верификации цепочки). */
export interface AuditChainRecord {
  diffHash: string;
  prevHash: string;
  before: unknown;
  after: unknown;
}
