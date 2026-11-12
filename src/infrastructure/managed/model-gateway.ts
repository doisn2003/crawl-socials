import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ModelGatewayError, type JsonModelRequest, type JsonModelResult, type ModelGateway } from '../../application/ports/model-gateway.js';
import { modelHash } from '../llm/gemini-gateway.js';
import { managedModelBound } from '../llm/managed-model-wire.js';
import { REBUILD_MODEL, type DurableSpend } from '../llm/durable-spend.js';
import type { ManagedLease, ManagedModel } from '../../shared/managed.js';
import type { ManagedClient } from './client.js';
import { ManagedHttpError } from './client.js';
import type { RunAccess } from './run-access.js';

interface Receipt {
  id: string;
  state: 'QUEUED' | 'DISPATCHING' | 'DONE' | 'FAILED' | 'UNKNOWN';
  result: JsonModelResult | null;
  error: string | null;
  cost: string | null;
  charge: string | null;
  bound: string;
  dispatched: boolean;
}
interface LocalOperation { upper: number; hold: string; model?: ManagedModel; result?: Receipt; rejected?: boolean }

export function createRemoteModelGateway(options: { directory: string; budgetUsd: number; runId: string;
  client: ManagedClient; access: RunAccess; spending: DurableSpend; planning?: boolean }): ModelGateway {
  const directory = join(options.directory, 'managed-model');
  const records = new Map<string, LocalOperation>(), pending = new Map<string, Promise<JsonModelResult>>();
  let cacheHits = 0;
  if (existsSync(directory)) {
    for (const file of readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const stored = JSON.parse(readFileSync(join(directory, file), 'utf8')) as LocalOperation;
      if (!stored.rejected) records.set(file.slice(0,-5), stored);
    }
  }

  function save(id: string, data: LocalOperation) {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, id + '.json');
    writeFileSync(file + '.next', JSON.stringify(data), { flush: true });
    renameSync(file + '.next', file);
    if (data.rejected) records.delete(id);
    else records.set(id,data);
  }

  async function execute(id: string, request: JsonModelRequest, lease: ManagedLease) {
    let data = records.get(id);
    if (!data) {
      const upper = managedModelBound(lease.model, request, lease.price);
      const hold = options.spending.reserve(lease.model, upper / 1e9);
      data = { upper, hold, model: lease.model };
      try { save(id,data); } catch (error) { options.spending.settle(hold, 0); throw error; }
    }
    const { signal, ...wire } = request;
    try {
      let receipt = data.result;
      if (!receipt || receipt.state === 'UNKNOWN') {
        const path = '/v1/ai/operations/' + id;
        if (receipt) receipt = await options.client.json<Receipt>(path);
        else {
          // A stable ID turns response loss and Resume into a receipt read.
          receipt = await options.client.json<Receipt>('/v1/ai/operations', { method: 'POST', json: { id, leaseId: lease.id, request: wire }, ...(signal ? { signal } : {}) });
        }
        const started = performance.now();
        while (receipt.state === 'QUEUED' || receipt.state === 'DISPATCHING') {
          if (options.access.reason() || performance.now() - started > 65_000) throw new ModelGatewayError('MODEL_NETWORK_USAGE_UNKNOWN');
          await sleep(500, undefined, signal ? { signal } : {});
          receipt = await options.client.json<Receipt>(path, signal ? { signal } : {});
        }
        save(id,{ ...data, result: receipt });
      } else if (receipt.result) cacheHits++;
      if (receipt.cost !== null) options.spending.settle(data.hold, Number(receipt.cost) / 1e9);
      if (!receipt.result) throw new ModelGatewayError(receipt.error ?? 'MODEL_USAGE_UNKNOWN', false, id);
      return { ...receipt.result, cache_hit: !!data.result };
    } catch (error) {
      if (error instanceof ManagedHttpError) {
        if (error.status > 0 && error.status < 500 && !data.result && error.code !== 'MODEL_IDEMPOTENCY_MISMATCH') {
          // A local START can predate an interrupted POST. Verify absence before releasing it.
          const existing = await options.client.json<Receipt>('/v1/ai/operations/' + id).catch(check => check);
          if (existing instanceof ManagedHttpError && existing.status === 404) {
            options.spending.settle(data.hold, 0);
            save(id,{ ...data, rejected: true });
          }
        }
        throw new ModelGatewayError(error.status === 0 ? 'MODEL_NETWORK_USAGE_UNKNOWN' : error.code, false, id);
      }
      if (signal?.aborted) throw new ModelGatewayError('MODEL_ABORTED_USAGE_UNKNOWN', false, id);
      throw error;
    }
  }

  return {
    async generateJson(request) {
      request.signal?.throwIfAborted();
      if (options.planning) await options.access.begin({ runId: options.runId, scope: 'PLAN', budgetUsd: options.budgetUsd });
      const lease = options.access.lease();
      if (lease.runId !== options.runId || lease.scope === 'COLLECT') throw new ModelGatewayError('RUN_LEASE_INVALID');
      const { signal: _signal, ...wire } = request;
      let id = modelHash({ run: options.runId, route: lease.route, request: wire });
      // Retry a request discarded before dispatch with a new receipt. Keep its old hold/release history.
      while (records.get(id)?.result?.state === 'FAILED' && records.get(id)?.result?.dispatched === false) {
        id = modelHash({ prior: id });
      }
      const ongoing = pending.get(id);
      if (ongoing) return ongoing;
      const task = execute(id,request,lease).finally(() => pending.delete(id));
      pending.set(id,task);
      return task;
    },
    summary() {
      let measured = 0, unknown = 0, reserved = 0, attempts = 0;
      let model = options.access.model(options.runId);
      for (const [id, value] of records) {
        model ??= value.model;
        attempts++;
        if (value.result?.cost != null) measured += Number(value.result.charge ?? value.result.cost) / 1e9;
        else if (pending.has(id)) reserved += value.upper / 1e9;
        else unknown += value.upper / 1e9;
      }
      return { model: model ?? REBUILD_MODEL, budget_usd: options.budgetUsd, measured_cost_usd: measured,
        unmetered_cost_upper_usd: unknown, reserved_usd: reserved, remaining_usd: Math.max(0,options.budgetUsd-measured-unknown-reserved),
        billable_attempts: attempts, cache_hits: cacheHits, cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE' };
    },
  };
}
