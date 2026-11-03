import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createAsyncConversationStore } from '../src/infrastructure/storage/async-conversation-store.js';
import { keepJobLeases } from '../src/application/job-lease-keeper.js';

test('cooldown heartbeat extends only owned work and never renews completed jobs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'csd-leases-')), base = await createAsyncConversationStore(directory);
  const errors: unknown[] = [], leases = keepJobLeases(base, { onError: error => { errors.push(error); }, leaseMs: 600_000 });
  try {
    for (const key of ['a', 'b']) await base.enqueue({ type: 'CLASSIFY', idempotency_key: key, payload: {} });
    const ours = await leases.store.claim('ours', { lease_ms: 10_000 }), other = await base.claim('other', { lease_ms: 10_000 });
    assert.ok(ours && other); await leases.refresh();
    assert.ok(Date.parse((await base.getJob(ours.id))!.lease_until!) > Date.parse(ours.lease_until!) + 500_000);
    assert.equal((await base.getJob(other.id))!.lease_until, other.lease_until);
    assert.equal(await leases.store.complete(ours.id, ours.lease_token!), true); await leases.refresh();
    assert.equal((await base.getJob(ours.id))!.state, 'SUCCEEDED'); assert.deepEqual(errors, []);
    await leases.close(); await leases.refresh();
  } finally { await leases.close(); await base.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }); }
});
