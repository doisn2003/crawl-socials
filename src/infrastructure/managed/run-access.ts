import { createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto';
import { isManagedModel, type ManagedLease, type ManagedRawReceipt, type ManagedScope, type ManagedStatus, type SignedLease } from '../../shared/managed.js';
import { sha256 } from '../projects/snapshot.js';
import { ManagedHttpError, type ManagedClient } from './client.js';

interface Active {
  lease: ManagedLease;
  deadline: number;
  nextRenew: number;
  rawRemaining: number | null;
}

const definitive = (error: unknown) => error instanceof ManagedHttpError && error.status >= 400 && error.status < 500;
const reasonCode = (error: unknown) => error instanceof ManagedHttpError ? error.code : 'ENTITLEMENT_UNAVAILABLE';
const uncertainRawReport = (error: unknown) => !(error instanceof ManagedHttpError) || error.status === 0
  || (error.status >= 500 && error.code === 'BACKEND_UNAVAILABLE');

export function createRunAccess(client: ManagedClient, projectId: string, onDenied: (code: string) => void) {
  let active: Active | null = null;
  let failure: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;
  let key: KeyObject | null = null;
  let admission = Promise.resolve();
  let acquiring: Promise<void> | null = null;
  let acquiringRun: string | null = null;
  const knownRoots = new Set<string>();
  async function publicKey() {
    if (key) return key;
    const encoded = client.release.leasePublicKey ?? (await client.json<{ leasePublicKey: string }>('/v1/config', {}, false)).leasePublicKey;
    key = createPublicKey({ type: 'spki', format: 'der', key: Buffer.from(encoded, 'base64') });
    if (key.asymmetricKeyType !== 'ed25519') throw Error('RUN_LEASE_SIGNATURE_INVALID');
    return key;
  }
  async function validate(value: SignedLease, expected: { id?: string; runId: string; scope: ManagedScope }, at: number) {
    const lease = value.lease;
    if (!verify(null, Buffer.from(JSON.stringify(lease)), await publicKey(), Buffer.from(value.signature, 'base64')) ||
        lease.projectId !== projectId || lease.accountId !== client.identity()?.id || lease.deviceId !== client.deviceId() ||
        lease.runId !== expected.runId || lease.scope !== expected.scope ||
        (expected.id && lease.id !== expected.id) || !Number.isSafeInteger(lease.expiresAt) || !Number.isSafeInteger(lease.issuedAt) ||
        lease.expiresAt <= lease.issuedAt || lease.expiresAt - lease.issuedAt > 120_000 || !isManagedModel(lease.model)) {
      throw Error('RUN_LEASE_SIGNATURE_INVALID');
    }
    const deadline = at + lease.expiresAt - lease.issuedAt;
    if (deadline <= performance.now()) throw Error('RUN_LEASE_EXPIRED');
    return { lease, deadline, nextRenew: performance.now() + 58_000 + Math.random() * 4_000, rawRemaining: lease.rawRemaining };
  }

  function deny(code: string) {
    if (failure) return;
    failure = code;
    if (timer) clearInterval(timer);
    queueMicrotask(() => onDenied(code));
  }

  function reason() {
    if (active && performance.now() >= active.deadline) deny('RUN_LEASE_EXPIRED');
    return failure;
  }

  async function tick() {
    const current = active;
    if (!current || reason() || running || performance.now() < current.nextRenew) return;
    running = (async () => {
      const at = performance.now();
      try {
        const value = await client.json<SignedLease>('/v1/runs/leases/' + current.lease.id + '/renew', { method: 'POST' });
        const fresh = await validate(value, { id: current.lease.id, runId: current.lease.runId, scope: current.lease.scope }, at);
        if (active === current && !failure) active = fresh;
      } catch (error) {
        if (active !== current) return;
        if (definitive(error) || error instanceof ManagedHttpError && /^TRIAL_|^MODEL_/.test(error.code)) deny(reasonCode(error));
        else current.nextRenew = performance.now() + 3000;
      }
    })().finally(() => { running = null; });
    await running;
  }

  async function begin(input: { runId: string; scope: ManagedScope; budgetUsd: number }) {
    if (active) {
      if (active.lease.runId === input.runId && active.lease.scope === input.scope && !reason()) return;
      throw Error(failure ?? 'RUN_LEASE_BUSY');
    }
    const target = input.scope + ':' + input.runId;
    if (acquiring) {
      if (acquiringRun === target) return acquiring;
      throw Error('RUN_LEASE_BUSY');
    }
    acquiringRun = target;
    acquiring = (async () => {
      failure = null;
      knownRoots.clear();
      await publicKey();
      const at = performance.now();
      const signed = await client.json<SignedLease>('/v1/runs/authorize', { method: 'POST',
        json: { projectId, runId: input.runId, scope: input.scope, budget: String(Math.ceil(Math.min(input.budgetUsd,30) * 1e9)) } });
      active = await validate(signed, input, at);
      timer = setInterval(() => void tick(), 1000);
      timer.unref();
    })().finally(() => { acquiring = null; acquiringRun = null; });
    return acquiring;
  }

  async function reportRaw(leaseId: string, roots: string[]) {
    const path = '/v1/runs/leases/' + leaseId + '/raw';
    const submission = { method: 'POST', json: { reportId: randomUUID(), roots } };
    try { return await client.json<ManagedRawReceipt>(path, submission); }
    catch (error) {
      if (!uncertainRawReport(error) || active?.lease.id !== leaseId || performance.now() >= active.deadline
        || (failure && failure !== 'TRIAL_EXHAUSTED')) throw error;
      return client.json<ManagedRawReceipt>(path, submission);
    }
  }

  return {
    begin, reason,
    model(runId: string) { return active?.lease.runId === runId ? active.lease.model : undefined; },
    interrupt() { if (active || acquiring) deny('ENTITLEMENT_UNAVAILABLE'); },
    async preflight() {
      const state = await client.json<ManagedStatus>('/v1/me/entitlements');
      if (state.reason) throw Error(state.reason);
    },
    lease() {
      const blocked = reason();
      if (blocked || !active) throw Error(blocked ?? 'RUN_LEASE_INVALID');
      return active.lease;
    },
    admit(platform: string, rows: Record<string, unknown>[]) {
      const work = admission.then(async () => {
        const current = active;
        if (!current || reason()) return [];
        if (current.rawRemaining === null) return rows;
        const candidates = rows.map(row => ({ row, root: typeof row.post_id === 'string' && row.post_id && row.is_reply !== true && row.entity_type !== 'COMMENT'
          ? sha256(platform + '\0' + row.post_id) : null }));
        const hashes = [...new Set(candidates.flatMap(item => item.root && !knownRoots.has(item.root) ? [item.root] : []))];
        for (let offset = 0; offset < hashes.length; offset += 1000) {
          if (reason()) break;
          try {
            const ack = await reportRaw(current.lease.id, hashes.slice(offset,offset + 1000));
            if (active?.lease.id !== current.lease.id) return [];
            active.rawRemaining = ack.rawRemaining;
            for (const root of ack.accepted) knownRoots.add(root);
            if (ack.rawRemaining === 0) { deny('TRIAL_EXHAUSTED'); break; }
          } catch (error) {
            if (active?.lease.id !== current.lease.id) return [];
            deny(uncertainRawReport(error) ? 'ENTITLEMENT_UNAVAILABLE' : reasonCode(error)); break;
          }
        }
        return candidates.filter(item => item.root !== null && knownRoots.has(item.root)).map(item => item.row);
      });
      admission = work.then(() => {}, () => {});
      return work;
    },
    async end() {
      await acquiring?.catch(() => {});
      if (timer) clearInterval(timer);
      timer = undefined;
      const lease = active?.lease.id;
      active = null;
      if (lease) await client.json('/v1/runs/leases/' + lease + '/release', { method: 'POST', timeout: 2500 }).catch(() => {});
      failure = null;
    },
  };
}

export type RunAccess = ReturnType<typeof createRunAccess>;
