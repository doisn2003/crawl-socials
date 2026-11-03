export interface ModelPrice {
  input_per_million: number;
  output_per_million: number;
  cached_input_per_million: number;
  observed_at: string;
  source: string;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  thinking_tokens: number;
}

export interface JsonModelRequest {
  purpose: string;
  system: string;
  input: unknown;
  schema: Record<string, unknown>;
  max_output_tokens: number;
  signal?: AbortSignal;
  /** Distinguishes deliberate independent annotations, never exposes secrets. */
  cache_namespace?: string;
  /** Explicit reasoning effort is part of the cache identity; omitted preserves legacy transport. */
  thinking_level?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface JsonModelResult {
  value: unknown;
  invocation_id: string;
  request_hash: string;
  model: string;
  model_version: string | null;
  usage: ModelUsage | null;
  cost_usd: number | null;
  unmetered_cost_upper_usd: number;
  cache_hit: boolean;
  elapsed_ms: number;
  price: ModelPrice;
}

export interface ModelLedgerSummary {
  model: string;
  budget_usd: number;
  measured_cost_usd: number;
  unmetered_cost_upper_usd: number;
  reserved_usd: number;
  remaining_usd: number;
  billable_attempts: number;
  cache_hits: number;
  cost_basis: 'TOKEN_USAGE_AT_SNAPSHOT_LIST_PRICE_NOT_INVOICE';
  /** Composite gateways expose each underlying ledger once for aggregate audit/export. */
  components?: ModelLedgerSummary[];
  scheduling?: import('../../shared/throughput.js').RequestScheduleStatus | undefined;
}

export interface ModelGateway {
  generateJson(request: JsonModelRequest): Promise<JsonModelResult>;
  summary(): ModelLedgerSummary;
}

/** Only safe codes may cross IPC/log boundaries; never provider messages/URLs/keys. */
export class ModelGatewayError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly invocation_id: string | null = null) {
    super(code);
    this.name = 'ModelGatewayError';
  }
}
