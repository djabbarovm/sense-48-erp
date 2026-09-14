import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, unsafeCreateTenantContext } from '@finance-os/core';
import { LocalFsStorage } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import {
  checkRequiredDocs,
  getDocumentUrl,
  listDocumentsFor,
  markDocumentReceived,
  seedDefaultRequirements,
  uploadDocument,
} from '../src/services/documents.js';

let tenantId: string;
const storage = new LocalFsStorage(mkdtempSync(join(tmpdir(), 'fos-docs-')));
const doc = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['DOCUMENT_CONTROLLER'] });
const acct = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ACCOUNTANT'] });

const objectId = crypto.randomUUID();

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b09-${Date.now()}`, legalName: 'B09', taxId: '300000019' } })
  ).id;
});

afterAll(async () => prisma.$disconnect());

describe('B-09 Documents (BR-023, D-04)', () => {
  it('upload: sha256, версия 1→2, файл в storage, audit', async () => {
    const body = Buffer.from('act content v1');
    const v1 = await uploadDocument(doc(), storage, {
      objectType: 'purchase_request',
      objectId,
      docType: 'ACT',
      fileName: 'act.pdf',
      mime: 'application/pdf',
      body,
    });
    expect(v1.version).toBe(1);
    expect(v1.sha256).toHaveLength(64);
    expect(await storage.exists(v1.fileKey)).toBe(true);
    const v2 = await uploadDocument(doc(), storage, {
      objectType: 'purchase_request',
      objectId,
      docType: 'ACT',
      fileName: 'act.pdf',
      mime: 'application/pdf',
      body: Buffer.from('act content v2'),
    });
    expect(v2.version).toBe(2);
    expect(v2.sha256).not.toBe(v1.sha256);
    const url = await getDocumentUrl(doc(), storage, v2.id);
    expect(url).toContain(v2.fileKey.split('/').pop());
  });

  it('ACCOUNTANT может загрузить, но не может mark_received', async () => {
    const uploaded = await uploadDocument(acct(), storage, {
      objectType: 'invoice',
      objectId,
      docType: 'SF',
      fileName: 'sf.pdf',
      mime: 'application/pdf',
      body: Buffer.from('sf'),
    });
    await expect(markDocumentReceived(acct(), uploaded.id)).rejects.toThrow(PermissionDeniedError);
    const received = await markDocumentReceived(doc(), uploaded.id);
    expect(received.status).toBe('RECEIVED');
  });

  it('пустой файл отклоняется', async () => {
    await expect(
      uploadDocument(doc(), storage, {
        objectType: 'invoice',
        objectId,
        docType: 'ACT',
        fileName: 'x.pdf',
        mime: 'application/pdf',
        body: Buffer.alloc(0),
      }),
    ).rejects.toThrow(/FILE_EMPTY/);
  });

  it('BR-023: checkRequiredDocs возвращает MISSING_DOC:<type> и очищается после RECEIVED', async () => {
    expect(await seedDefaultRequirements(tenantId)).toBeGreaterThan(0);
    const target = crypto.randomUUID();
    let missing = await checkRequiredDocs(doc(), {
      categoryGroup: 'MARKETING',
      paymentType: 'POSTPAY',
      phase: 'BEFORE_PAYMENT',
      objectType: 'payment_request',
      objectId: target,
    });
    expect(missing.map((m) => m.control).sort()).toEqual(['MISSING_DOC:ACT', 'MISSING_DOC:INVOICE']);
    // загружаем и принимаем ACT
    const act = await uploadDocument(doc(), storage, {
      objectType: 'payment_request',
      objectId: target,
      docType: 'ACT',
      fileName: 'act.pdf',
      mime: 'application/pdf',
      body: Buffer.from('act'),
    });
    await markDocumentReceived(doc(), act.id);
    missing = await checkRequiredDocs(doc(), {
      categoryGroup: 'MARKETING',
      paymentType: 'POSTPAY',
      phase: 'BEFORE_PAYMENT',
      objectType: 'payment_request',
      objectId: target,
    });
    expect(missing.map((m) => m.control)).toEqual(['MISSING_DOC:INVOICE']);
    // документы связанного invoice тоже засчитываются (alsoObjects)
    const invId = crypto.randomUUID();
    const inv = await uploadDocument(doc(), storage, {
      objectType: 'invoice',
      objectId: invId,
      docType: 'INVOICE',
      fileName: 'invoice.pdf',
      mime: 'application/pdf',
      body: Buffer.from('inv'),
    });
    await markDocumentReceived(doc(), inv.id);
    missing = await checkRequiredDocs(doc(), {
      categoryGroup: 'MARKETING',
      paymentType: 'POSTPAY',
      phase: 'BEFORE_PAYMENT',
      objectType: 'payment_request',
      objectId: target,
      alsoObjects: [{ objectType: 'invoice', objectId: invId }],
    });
    expect(missing).toEqual([]);
    expect((await listDocumentsFor(doc(), 'payment_request', target)).length).toBe(1);
  });
});
