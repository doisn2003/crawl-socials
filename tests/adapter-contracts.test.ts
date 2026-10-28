import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AdapterCapabilityRegistry, validateAccessContext, validateAdapterRequest } from '../src/application/adapter-capabilities.js';
import type { SocialAdapter } from '../src/application/ports/social-adapter.js';
import type { AdapterCheckpoint, AdapterErrorCode, AdapterPage, AdapterRequest, AdapterResult } from '../src/domain/adapter-contracts.js';
import { FakeSocialAdapter } from '../src/infrastructure/adapters/fake-social-adapter.js';
import type { FakeAdapterFixture } from '../src/infrastructure/adapters/fake-social-adapter.js';

const fixture = (): FakeAdapterFixture => JSON.parse(readFileSync('tests/fixtures/adapters/facebook-pages.json', 'utf8')) as FakeAdapterFixture;
const request = (): AdapterRequest => ({
  query: { run_id: 'run-fixture', query_id: 'query-fixture', parent_query_id: null, expansion_reason: null,
    policy_version: 'coffee-intent-v1', adapter_id: 'facebook-fixture', adapter_version: '1.0.0',
    collection_scope: 'PUBLIC_DISCOVERY', search_mode: 'POST_SEARCH', source_type: 'PAGE', source_id: null,
    keyword: 'cafe', filters: {}, priority: 1, budget: { max_candidates: 100 } },
  access_context: { access_context_id: 'context-fixture', profile_id: 'profile-fixture', account_id: null,
    account_binding: 'ANONYMOUS', source_permission: 'UNKNOWN' },
});
const value = <T>(result: AdapterResult<T>): T => {
  assert.equal(result.status, 'OK');
  return result.value;
};
const error = (result: AdapterResult<unknown>, code: AdapterErrorCode): void => {
  assert.equal(result.status, 'ERROR');
  assert.equal(result.code, code);
  assert.equal(Object.hasOwn(result, 'value'), false);
};
const next = (page: AdapterPage): AdapterCheckpoint => {
  assert.equal(page.page.continuation.status, 'MORE');
  if (page.page.continuation.status !== 'MORE') throw new Error('EXPECTED_CONTINUATION');
  return page.page.continuation.checkpoint;
};
async function ready(custom = fixture()): Promise<SocialAdapter> {
  const adapter = new FakeSocialAdapter(custom);
  value(await adapter.initialize());
  return adapter;
}

test('consumer pages through adapter port, preserving duplicate observations and string IDs', async () => {
  const adapter: SocialAdapter = await ready();
  const input = request();
  const first = value(await adapter.searchPosts(input));
  const second = value(await adapter.fetchBatch(input, next(first)));
  assert.equal(first.kind, 'POSTS'); assert.equal(second.kind, 'POSTS');
  if (first.kind !== 'POSTS' || second.kind !== 'POSTS') throw new Error('EXPECTED_POSTS');
  const ids = [...first.page.candidates, ...second.page.candidates].map(post => post.post_id);
  assert.deepEqual(ids, ['90071992547409931234', 'fixture-post-2', 'fixture-post-2', 'fixture-post-3']);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(second.page.continuation, { status: 'END', reason: 'SOURCE_EXHAUSTED' });
  await adapter.stop();
});

test('raw LIVE fields cannot promote fixture provenance or leak arbitrary raw properties', async () => {
  const adapter = await ready();
  const page = value(await adapter.searchPosts(request()));
  assert.equal(page.page.capture_mode, 'FIXTURE');
  assert.ok(page.page.candidates.every(post => post.provenance.capture_mode === 'FIXTURE'));
  assert.equal(JSON.stringify(page).includes('synthetic-injection'), false);
  assert.equal(JSON.stringify(page).includes('access_token'), false);
  assert.equal(adapter.capabilities.verification, 'FIXTURE_ONLY');
});

test('capability registry detaches declarations and does not infer source permission', async () => {
  const adapter = await ready();
  const registry = new AdapterCapabilityRegistry();
  const capabilities = adapter.capabilities;
  registry.register(capabilities);
  (capabilities.source_types as string[]).length = 0;
  const stored = registry.get('facebook-fixture');
  assert.ok(stored);
  assert.equal(stored.source_types.length, 3);
  (stored.source_types as string[]).length = 0;
  assert.equal(registry.get('facebook-fixture')?.source_types.length, 3);
  assert.equal(registry.get('missing'), null);
  assert.throws(() => registry.register(adapter.capabilities), /CAPABILITY_ALREADY_REGISTERED/);
  assert.equal(registry.validate(request()), null);
  assert.equal(registry.validate(null)?.code, 'INVALID_REQUEST');
  assert.equal(registry.validate({ query: { adapter_id: 'missing' } })?.code, 'UNSUPPORTED_OPERATION');
  assert.deepEqual(value(await adapter.checkAccess(request().access_context)), {
    session: 'ANONYMOUS', source_permission: 'UNKNOWN', verification: 'FIXTURE_ONLY',
  });
});

test('unsupported scope, mode, source and filter fail explicitly', async () => {
  const adapter = await ready();
  const input = request();
  for (const [patch, code] of [
    [{ collection_scope: 'JOINED_GROUPS' }, 'UNSUPPORTED_SCOPE'],
    [{ search_mode: 'GROUP_POST_SEARCH' }, 'UNSUPPORTED_MODE'],
    [{ source_type: 'PRIVATE_GROUP' }, 'UNSUPPORTED_SOURCE'],
    [{ filters: { sort: 'latest' } }, 'UNSUPPORTED_FILTER'],
    [{ adapter_version: 'different' }, 'ADAPTER_VERSION_MISMATCH'],
  ] as const) {
    error(await adapter.searchPosts({ ...input, query: { ...input.query, ...patch } } as AdapterRequest), code);
  }
  error(await adapter.searchPosts({ ...input, query: { ...input.query, filters: { language: 'vi', unsupported: true } } } as AdapterRequest), 'UNSUPPORTED_FILTER');
});

test('runtime input validation rejects malformed budgets, context and time windows', async () => {
  const adapter = await ready();
  const input = request();
  const bad = [null, { ...input, token: 'synthetic' }, { ...input, query: { ...input.query, budget: { max_candidates: 0 } } },
    { ...input, query: { ...input.query, filters: { published_from: '2026-02-30T00:00:00Z' } } },
    { ...input, query: { ...input.query, filters: { published_from: '2026-01-01T00:00:00Z', published_to: '2025-01-01T00:00:00Z' } } },
    { ...input, access_context: { ...input.access_context, account_binding: 'VERIFIED' } },
  ];
  for (const item of bad) error(await adapter.searchPosts(item as AdapterRequest), 'INVALID_REQUEST');
});

test('declared user-session requirement and denied permission are not ignored', () => {
  const capabilities = new FakeSocialAdapter(fixture()).capabilities;
  assert.equal(validateAdapterRequest({ ...capabilities, authentication: 'USER_SESSION' }, request())?.code, 'LOGIN_REQUIRED');
  const input = request();
  assert.equal(validateAdapterRequest(capabilities, { ...input, access_context: { ...input.access_context, source_permission: 'DENIED' } })?.code, 'ACCESS_DENIED');
});

test('JSON arrays and objects cannot coerce access enums or bypass denied permission', async () => {
  const adapter = await ready();
  const input = request();
  for (const [field, scalar] of [['source_permission', 'DENIED'], ['account_binding', 'UNVERIFIED']] as const) {
    for (const malformed of [[scalar], [[scalar]], { value: scalar }]) {
      const context = JSON.parse(JSON.stringify({ ...input.access_context, [field]: malformed }));
      assert.equal(validateAccessContext(context), false);
      error(await adapter.checkAccess(context), 'INVALID_REQUEST');
      error(await adapter.searchPosts({ ...input, access_context: context }), 'INVALID_REQUEST');
    }
  }
  error(await adapter.searchPosts({ ...input, access_context: { ...input.access_context, source_permission: 'DENIED' } }), 'ACCESS_DENIED');
});

test('supported filters apply publication boundaries and language; null dates do not satisfy a range', async () => {
  const adapter = await ready();
  const input = request();
  const page = value(await adapter.searchPosts({ ...input, query: { ...input.query, filters: {
    published_from: '2025-01-01T00:00:00Z', published_to: '2026-01-01T00:00:00Z', language: 'vi',
  } } }));
  assert.equal(page.kind, 'POSTS');
  if (page.kind !== 'POSTS') throw new Error('EXPECTED_POSTS');
  assert.deepEqual(page.page.candidates.map(post => post.post_id), ['fixture-post-2', 'fixture-post-2']);
  const group = value(await adapter.searchPosts({ ...input, query: { ...input.query, source_type: 'PUBLIC_GROUP',
    filters: { published_from: '2020-01-01T00:00:00Z' } } }));
  assert.equal(group.page.candidates.length, 0);
});

test('source publication context stays distinct from author and unknown visibility is preserved', async () => {
  const adapter = await ready();
  const input = request();
  const group = value(await adapter.searchPosts({ ...input, query: { ...input.query, source_type: 'PUBLIC_GROUP' } }));
  const personal = value(await adapter.searchPosts({ ...input, query: { ...input.query, source_type: 'PUBLIC_PERSONAL' } }));
  assert.equal(group.kind, 'POSTS');
  if (group.kind !== 'POSTS') throw new Error('EXPECTED_POSTS');
  assert.equal(group.page.candidates[0]?.source_type, 'PUBLIC_GROUP');
  assert.equal(group.page.candidates[0]?.author_type, 'PAGE');
  assert.equal(personal.page.candidates[0]?.visibility_at_observation, 'UNKNOWN');
});

test('budget stop is distinct from source exhaustion', async () => {
  const adapter = await ready();
  const input = request();
  const page = value(await adapter.searchPosts({ ...input, query: { ...input.query, budget: { max_candidates: 1 } } }));
  assert.equal(page.page.candidates.length, 1);
  assert.deepEqual(page.page.continuation, { status: 'STOP', reason: 'BUDGET_REACHED' });
});

test('cursor binds run/query/policy/filter/profile/account/access context and versions', async () => {
  const adapter = await ready();
  const input = request();
  const cursor = next(value(await adapter.searchPosts(input)));
  const changed: AdapterRequest[] = [
    { ...input, query: { ...input.query, query_id: 'other' } },
    { ...input, query: { ...input.query, run_id: 'other' } },
    { ...input, query: { ...input.query, policy_version: 'other' } },
    { ...input, query: { ...input.query, filters: { language: 'vi' } } },
    { ...input, access_context: { ...input.access_context, profile_id: 'other' } },
    { ...input, access_context: { ...input.access_context, access_context_id: 'other' } },
    { ...input, access_context: { ...input.access_context, account_id: 'account-other', account_binding: 'VERIFIED' } },
  ];
  for (const item of changed) error(await adapter.fetchBatch(item, cursor), 'CHECKPOINT_MISMATCH');
  error(await adapter.fetchBatch(input, { ...cursor, adapter_version: 'other' }), 'CHECKPOINT_MISMATCH');
  error(await adapter.fetchBatch(input, { ...cursor, checkpoint_version: '2' } as unknown as AdapterCheckpoint), 'CHECKPOINT_MISMATCH');
  error(await adapter.fetchBatch(input, { ...cursor, opaque_cursor: 'not-issued' }), 'INVALID_CURSOR');
});

test('retry of an issued checkpoint replays the same candidates and continuation without advancing hidden position', async () => {
  const adapter = await ready({ ...fixture(), page_size: 1 });
  const input = request();
  const cursor = next(value(await adapter.searchPosts(input)));
  const first = value(await adapter.fetchBatch(input, cursor));
  const retry = value(await adapter.fetchBatch(input, cursor));
  assert.deepEqual(first, retry);
});

test('missing or malformed continuation never restarts posts or sources, and lifecycle errors take priority', async () => {
  const adapter = new FakeSocialAdapter(fixture());
  const input = request();
  error(await adapter.fetchBatch(input, null as unknown as AdapterCheckpoint), 'NOT_INITIALIZED');
  value(await adapter.initialize());
  for (const searchMode of ['POST_SEARCH', 'SOURCE_DISCOVERY'] as const) {
    const query: AdapterRequest = { ...input, query: { ...input.query, search_mode: searchMode } };
    const first = value(searchMode === 'POST_SEARCH' ? await adapter.searchPosts(query) : await adapter.discoverSources(query));
    assert.ok(first.page.candidates.length > 0, 'the initial query has candidates a bad continuation must not replay');
    const cursor = next(first);
    const expected = value(await adapter.fetchBatch(query, cursor));
    for (const malformed of [null, undefined, '', 42, [], {}, { opaque_cursor: cursor.opaque_cursor },
      { ...cursor, opaque_cursor: '' }, { ...cursor, adapter_id: null }, { ...cursor, unexpected: true }]) {
      error(await adapter.fetchBatch(query, malformed as AdapterCheckpoint), 'INVALID_CURSOR');
    }
    assert.deepEqual(value(await adapter.fetchBatch(query, cursor)), expected, 'bad continuation did not change valid cursor progress');
  }
  await adapter.stop();
  error(await adapter.fetchBatch(input, null as unknown as AdapterCheckpoint), 'STOPPED');
  error(await adapter.fetchBatch(input, undefined as unknown as AdapterCheckpoint), 'STOPPED');
});

test('rate-limit retry preserves cursor and then returns the intended batch', async () => {
  const adapter = await ready({ ...fixture(), faults: [{ batch_index: 1, code: 'RATE_LIMITED', once: true }] });
  const input = request();
  const cursor = next(value(await adapter.searchPosts(input)));
  const failed = await adapter.fetchBatch(input, cursor);
  error(failed, 'RATE_LIMITED');
  if (failed.status !== 'ERROR') throw new Error('EXPECTED_ERROR');
  assert.equal(failed.retryable, true); assert.equal(failed.retry_after_seconds, 5);
  const result = value(await adapter.fetchBatch(input, cursor));
  assert.equal(result.page.candidates.length, 2);
});

test('auth, challenge, network and schema failures cannot masquerade as an empty successful page', async () => {
  for (const code of ['LOGIN_REQUIRED', 'CHALLENGE', 'NETWORK_ERROR', 'SCHEMA_CHANGED'] as const) {
    const adapter = await ready({ ...fixture(), faults: [{ batch_index: 0, code, once: false }] });
    error(await adapter.searchPosts(request()), code);
  }
});

test('malformed fixture records and numeric platform IDs are quarantined as schema failure', async () => {
  for (const post of [{ post_id: 'missing-fields' }, { ...(fixture().posts[0] as object), post_id: 9007199254740993 }]) {
    const adapter = await ready({ ...fixture(), posts: [post] });
    error(await adapter.searchPosts(request()), 'SCHEMA_CHANGED');
  }
});

test('raw post and source enum arrays or objects produce schema failure instead of typed candidates', async () => {
  for (const [field, scalar] of [['author_type', 'PAGE'], ['visibility_at_observation', 'PUBLIC'],
    ['content_type', 'TEXT_POST'], ['source_type', 'PAGE']] as const) {
    for (const malformed of [[scalar], [[scalar]], { value: scalar }]) {
      const data = fixture();
      const raw = JSON.parse(JSON.stringify({ ...(data.posts[0] as object), [field]: malformed }));
      const adapter = await ready({ ...data, posts: [raw] });
      error(await adapter.searchPosts(request()), 'SCHEMA_CHANGED');
    }
  }
  for (const malformed of [['PUBLIC'], [['PUBLIC']], { value: 'PUBLIC' }]) {
    const data = fixture();
    const raw = JSON.parse(JSON.stringify({ ...(data.sources[0] as object), visibility_at_observation: malformed }));
    const adapter = await ready({ ...data, sources: [raw] });
    const input = request();
    error(await adapter.discoverSources({ ...input, query: { ...input.query, search_mode: 'SOURCE_DISCOVERY' } }), 'SCHEMA_CHANGED');
  }
});

test('source discovery paginates separately and refuses post filters; source feed requires an ID', async () => {
  const adapter = await ready();
  const input = request();
  const sources: AdapterRequest = { ...input, query: { ...input.query, search_mode: 'SOURCE_DISCOVERY' } };
  const first = value(await adapter.discoverSources(sources));
  const last = value(await adapter.fetchBatch(sources, next(first)));
  assert.equal(first.kind, 'SOURCES'); assert.equal(last.kind, 'SOURCES');
  assert.equal(first.page.candidates.length, 2); assert.equal(last.page.candidates.length, 1);
  error(await adapter.searchPosts(sources), 'UNSUPPORTED_MODE');
  error(await adapter.discoverSources({ ...sources, query: { ...sources.query, filters: { language: 'vi' } } }), 'UNSUPPORTED_FILTER');
  assert.equal(validateAdapterRequest(adapter.capabilities, { ...sources, query: { ...sources.query, filters: { language: 'vi' } } })?.code, 'UNSUPPORTED_FILTER');
  error(await adapter.searchPosts({ ...input, query: { ...input.query, search_mode: 'SOURCE_FEED' } }), 'INVALID_REQUEST');
  const feed = value(await adapter.searchPosts({ ...input, query: { ...input.query, search_mode: 'SOURCE_FEED', source_id: 'fixture-page' } }));
  assert.equal(feed.page.candidates.length, 2);
});

test('permalink check is an explicit fixture match, not live source verification', async () => {
  const adapter = await ready();
  const context = request().access_context;
  const result = value(await adapter.verifyPermalink('https://www.facebook.com/fixture-page/posts/fixture-post-2', context));
  assert.deepEqual(result, { url: 'https://www.facebook.com/fixture-page/posts/fixture-post-2', result: 'MATCHED_FIXTURE', post_id: 'fixture-post-2', capture_mode: 'FIXTURE' });
  assert.equal(value(await adapter.verifyPermalink('https://www.facebook.com/unknown', context)).result, 'UNVERIFIED');
  error(await adapter.verifyPermalink('https://facebook.com.attacker.invalid/post', context), 'INVALID_REQUEST');
});

test('lifecycle initialization is idempotent, stop is terminal, and cursors are instance-local', async () => {
  const adapter = new FakeSocialAdapter(fixture());
  error(await adapter.searchPosts(request()), 'NOT_INITIALIZED');
  value(await adapter.initialize()); value(await adapter.initialize());
  const cursor = next(value(await adapter.searchPosts(request())));
  const fresh = await ready();
  value(await fresh.searchPosts(request()));
  error(await fresh.fetchBatch(request(), cursor), 'INVALID_CURSOR');
  await adapter.stop(); await adapter.stop();
  error(await adapter.fetchBatch(request(), cursor), 'STOPPED');
  error(await adapter.initialize(), 'STOPPED');
});

test('caller mutations cannot alter fixture or subsequent result contents', async () => {
  const data = fixture();
  const adapter = new FakeSocialAdapter(data);
  (data.posts as unknown[]).length = 0;
  value(await adapter.initialize());
  const first = value(await adapter.searchPosts(request()));
  (first.page.candidates as unknown[]).length = 0;
  const second = value(await adapter.searchPosts(request()));
  assert.equal(second.page.candidates.length, 2);
});
