// Checks P00 design artifacts. This is not a production campaign preflight or crawler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const validatorRoot = option('--validator-root');
const validatorRequire = validatorRoot ? createRequire(path.join(path.resolve(validatorRoot), 'package.json')) : require;
let Ajv;
try { Ajv = validatorRequire('ajv'); }
catch { throw new Error('Ajv 8 is required. Use --validator-root <directory with Ajv installed>; P01.01 will add CSD devDependencies.'); }
const validatorVersion = validatorRequire('ajv/package.json').version;
assert.ok(validatorVersion.startsWith('8.'), 'Use Ajv 8');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const schema = readJson('.brain/specs/campaign.schema.json');
const example = readJson('.brain/specs/campaign.example.json');
const coffee = readJson('.brain/specs/campaign.coffee.json');
const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false });
// The contract permits UTC Z only. Compare normalized ISO to reject impossible dates.
ajv.addFormat('date-time', value => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => '.' + (fraction || '').padEnd(3, '0') + 'Z');
  return date.toISOString() === normalized;
});
const validate = ajv.compile(schema);
const results = [];
function check(name, body) { body(); results.push(name); }
function expectConfig(name, base, mutate, expected) {
  check(name, () => {
    const spec = structuredClone(base);
    mutate(spec);
    assert.equal(validate(spec), expected, name + ': ' + JSON.stringify(validate.errors));
  });
}

// Synthetic resolved configuration used only to exercise the schema. No budget or permission is granted.
const resolved = structuredClone(coffee);
resolved.mode = 'BENCHMARK';
resolved.open_questions = [];
resolved.budgets = { currency: 'VND', max_cost: 0, max_requests: 1000, max_operator_minutes: 0, max_storage_mb: 256 };
expectConfig('illustrative draft validates', example, () => {}, true);
expectConfig('confirmed coffee draft validates with operational unknowns', coffee, () => {}, true);
expectConfig('example cannot become benchmark by mode change', example, s => { s.mode = 'BENCHMARK'; }, false);
expectConfig('coffee cannot benchmark with null budgets and unknowns', coffee, s => { s.mode = 'BENCHMARK'; }, false);
expectConfig('synthetic resolved configuration validates schema only', resolved, () => {}, true);
expectConfig('benchmark rejects example-only workload', resolved, s => { s.workload.confirmation = 'EXAMPLE_ONLY'; }, false);
expectConfig('benchmark rejects unresolved question', resolved, s => { s.open_questions = ['O03']; }, false);
expectConfig('benchmark rejects unknown source inclusion', resolved, s => { s.source_requirements.PUBLIC_PERSONAL.in_scope = null; }, false);
expectConfig('benchmark rejects unknown source minimum', resolved, s => { s.source_requirements.PUBLIC_GROUP.minimum_valid_unique_posts = null; }, false);
expectConfig('rejects missing source category', resolved, s => { delete s.source_requirements.PUBLIC_PERSONAL; }, false);
expectConfig('rejects negative source minimum', resolved, s => { s.source_requirements.PAGE.minimum_valid_unique_posts = -1; }, false);
expectConfig('excluded source cannot have positive minimum', resolved, s => { s.source_requirements.PAGE.in_scope = false; }, false);
expectConfig('benchmark needs at least one included source', resolved, s => {
  for (const source of Object.values(s.source_requirements)) { source.in_scope = false; source.minimum_valid_unique_posts = 0; }
}, false);
expectConfig('generic schema allows explicitly optional source with minimum zero', resolved, s => { s.source_requirements.PAGE.minimum_valid_unique_posts = 0; }, true);
expectConfig('rejects target below 1000', resolved, s => { s.target.valid_unique_posts = 999; }, false);
expectConfig('rejects deadline over 24 hours', resolved, s => { s.target.max_wall_time_seconds = 90000; }, false);
expectConfig('rejects resettable clock policy', resolved, s => { s.target.clock_policy = 'RESET_ON_RESTART'; }, false);
expectConfig('rejects another platform', resolved, s => { s.platform = 'YOUTUBE'; }, false);
expectConfig('public MVP rejects joined-groups scope', resolved, s => { s.collection_scope = 'JOINED_GROUPS'; }, false);
expectConfig('public MVP rejects private-group source category', resolved, s => { s.source_requirements.PRIVATE_GROUP = { in_scope: true, minimum_valid_unique_posts: 1 }; }, false);
expectConfig('rejects empty keyword list', resolved, s => { s.workload.keywords = []; }, false);
expectConfig('rejects whitespace-only keyword', resolved, s => { s.workload.keywords = ['   ']; }, false);
expectConfig('rejects duplicate keyword', resolved, s => { s.workload.keywords.push(s.workload.keywords[0]); }, false);
expectConfig('rejects missing intent', resolved, s => { s.workload.intent = null; }, false);
expectConfig('rejects unknown content types', resolved, s => { s.workload.content_types = ['COMMENT']; }, false);
expectConfig('benchmark rejects unresolved geography', resolved, s => { s.workload.geography.mode = 'UNRESOLVED'; }, false);
expectConfig('ANY geography cannot silently become hard filter', resolved, s => { s.workload.geography.places = ['Hà Nội']; }, false);
expectConfig('INCLUDE geography requires evidence rule', resolved, s => {
  s.workload.geography = { mode: 'INCLUDE', places: ['Hà Nội'], preferred_places: [], evidence_rule: null };
}, false);
expectConfig('rejects null budget', resolved, s => { s.budgets.max_cost = null; }, false);
expectConfig('rejects negative budget', resolved, s => { s.budgets.max_operator_minutes = -1; }, false);
expectConfig('rejects zero request allowance', resolved, s => { s.budgets.max_requests = 0; }, false);
expectConfig('rejects root credential field', resolved, s => { s.access_token = 'synthetic'; }, false);
expectConfig('rejects nested credential field', resolved, s => { s.workload.password = 'synthetic'; }, false);
expectConfig('rejects numeric campaign ID', resolved, s => { s.campaign_id = 123; }, false);
expectConfig('rejects unbounded window with hidden lower bound', resolved, s => { s.historical_window.from_utc = '2020-01-01T00:00:00Z'; }, false);
expectConfig('RANGE window accepts UTC timestamps', resolved, s => {
  s.historical_window = { mode: 'RANGE', from_utc: '2020-01-01T00:00:00Z', to_utc: '2026-01-01T00:00:00.123Z' };
}, true);
expectConfig('rejects impossible calendar date', resolved, s => {
  s.historical_window = { mode: 'RANGE', from_utc: '2026-02-30T00:00:00Z', to_utc: '2026-03-02T00:00:00Z' };
}, false);
expectConfig('rejects timestamp without UTC Z', resolved, s => {
  s.historical_window = { mode: 'RANGE', from_utc: '2020-01-01T00:00:00+07:00', to_utc: '2026-01-01T00:00:00Z' };
}, false);
expectConfig('bounded expansion requires frozen rule version', resolved, s => { s.discovery_policy.expansion_rule_version = null; }, false);
expectConfig('disabled expansion cannot contain extra keywords', resolved, s => {
  s.discovery_policy = { ...s.discovery_policy, expansion: 'DISABLED', allowed_expansions: ['cafe'], expansion_rule_version: null };
}, false);
expectConfig('frozen allowlist cannot be empty', resolved, s => {
  s.discovery_policy = { ...s.discovery_policy, expansion: 'FROZEN_ALLOWLIST', allowed_expansions: [], expansion_rule_version: null };
}, false);
expectConfig('frozen allowlist accepts explicit related keywords', resolved, s => {
  s.discovery_policy = { ...s.discovery_policy, expansion: 'FROZEN_ALLOWLIST', allowed_expansions: ['cafe hẹn hò'], expansion_rule_version: null };
}, true);
check('coffee configuration preserves user requirements and unresolved operations', () => {
  assert.equal(coffee.workload.confirmation, 'USER_CONFIRMED');
  assert.equal(coffee.mode, 'DRAFT');
  assert.equal(coffee.collection_scope, 'PUBLIC_DISCOVERY');
  assert.equal(coffee.workload.geography.mode, 'ANY');
  assert.deepEqual(coffee.workload.geography.preferred_places, ['Hà Nội']);
  assert.equal(coffee.workload.language, null);
  assert.equal(coffee.historical_window.mode, 'UNBOUNDED');
  assert.equal(coffee.target.valid_unique_posts, 1000);
  assert.equal(coffee.target.max_wall_time_seconds, 86400);
  assert.equal(coffee.target.after_target_policy, 'CONTINUE_WHILE_PRODUCTIVE_WITHIN_BUDGET');
  for (const source of Object.values(coffee.source_requirements)) {
    assert.deepEqual(source, { in_scope: true, minimum_valid_unique_posts: 1 });
  }
  assert.equal(coffee.discovery_policy.expansion, 'BOUNDED_INTENT');
  assert.equal(coffee.discovery_policy.expansion_rule_version, 'coffee-intent-v1');
  assert.deepEqual(coffee.open_questions, ['O03', 'O04', 'O06']);
  assert.ok(['max_cost', 'max_requests', 'max_operator_minutes', 'max_storage_mb'].every(key => coffee.budgets[key] === null));
});
check('new document links resolve locally', () => {
  const docs = ['.brain/specs/product_contract.md', '.brain/specs/hotmatch_reuse_inventory.md',
    '.brain/decisions/ADR-001-runtime-and-reuse.md', '.brain/evidence/p00-validation-2026-10-27.md'];
  for (const file of docs) {
    const fullPath = path.join(root, file);
    const body = fs.readFileSync(fullPath, 'utf8');
    for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^(https?:|mailto:)/.test(link)) continue;
      const target = path.resolve(path.dirname(fullPath), link);
      // A clean first run creates its own linked report only after all checks pass.
      const isPendingReport = option('--output') && target === path.join(root, '.brain/evidence/p00-contract-checks.json')
        && target === path.resolve(option('--output'));
      assert.ok(fs.existsSync(target) || isPendingReport, file + ': broken link ' + link);
    }
  }
});
const output = JSON.stringify({ check: 'P00 design artifacts', date: '2026-10-27',
  node: process.versions.node, validator: 'ajv ' + validatorVersion, passed: results.length,
  results, limitations: ['Schema configuration checks only; no runtime acceptance evaluator implemented',
    'Synthetic BENCHMARK object grants no budget/access and does not run collection'] }, null, 2) + '\n';
if (option('--output')) fs.writeFileSync(path.resolve(option('--output')), output);
else process.stdout.write(output);
