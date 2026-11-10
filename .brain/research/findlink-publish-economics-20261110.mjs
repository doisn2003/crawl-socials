// Planning scenarios, not observed revenue, provider quotes, or accounting advice.
// Run: node .brain/research/findlink-publish-economics-20261110.mjs
// All monetary amounts below are VND. Prices/revenue exclude indirect taxes.
import assert from 'node:assert/strict';

const plans = [
  { name: 'Starter', price: 23_000_000, annualCredits: 50_000, infrastructure: 600_000, support: 2_000_000, acquisition: 2_000_000, development: 2_000_000, target: 10_000_000 },
  { name: 'Agency', price: 70_000_000, annualCredits: 200_000, infrastructure: 1_800_000, support: 6_000_000, acquisition: 6_000_000, development: 5_000_000, target: 30_000_000 },
  { name: 'Scale', price: 235_000_000, annualCredits: 1_000_000, infrastructure: 6_000_000, support: 18_000_000, acquisition: 18_000_000, development: 15_000_000, target: 100_000_000 },
];
const scenarios = [
  { name: 'base', fx: 26_000, creditUtilization: 1, uncoveredProviderOverhead: 0.2, supportMultiplier: 1, acquisitionMultiplier: 1, paymentFee: 0.02 },
  { name: 'stress', fx: 28_000, creditUtilization: 1, uncoveredProviderOverhead: 0.2, supportMultiplier: 2, acquisitionMultiplier: 2, paymentFee: 0.03 },
];

function calculate(plan, scenario) {
  const providerUsd = plan.annualCredits / 1_000 * scenario.creditUtilization;
  const providerVnd = providerUsd * scenario.fx;
  const uncoveredProviderCost = providerVnd * scenario.uncoveredProviderOverhead;
  const fixedCost = providerVnd + uncoveredProviderCost + plan.infrastructure
    + plan.support * scenario.supportMultiplier
    + plan.acquisition * scenario.acquisitionMultiplier + plan.development;
  const paymentCost = plan.price * scenario.paymentFee;
  const totalCost = fixedCost + paymentCost;
  const profit = plan.price - totalCost;
  return {
    plan: plan.name, scenario: scenario.name, priceVnd: plan.price,
    annualCredits: plan.annualCredits, providerUsd, providerVnd,
    uncoveredProviderCost, fixedCost, paymentCost, totalCost, profit,
    marginPercent: profit / plan.price * 100,
    targetProfitVnd: plan.target,
    minimumPriceForTargetVnd: Math.ceil((plan.target + fixedCost) / (1 - scenario.paymentFee)),
  };
}

const results = scenarios.flatMap(scenario => plans.map(plan => calculate(plan, scenario)));
assert.deepEqual(results.filter(r => r.scenario === 'base').map(r => r.profit), [14_380_000, 43_560_000, 142_100_000]);
assert.deepEqual(results.filter(r => r.scenario === 'stress').map(r => r.profit), [10_030_000, 30_380_000, 101_350_000]);
for (const r of results) {
  assert.equal(r.profit + r.totalCost, r.priceVnd);
  assert.ok(r.profit >= r.targetProfitVnd);
}
assert.equal(100 / 1_000, 0.1);
assert.equal(100 / 1_000 * scenarios[0].fx, 2_600);
assert.equal(10_000 * 100 / 1_000 * scenarios[0].fx, 26_000_000);
// Same hypothetical token counts, uncached input and billable output.
const comparison = { inputTokens: 1_000_000, outputTokens: 100_000 };
const rates = [
  { model: 'gemini-3.1-flash-lite', tariff: 'standard', input: 0.25, output: 1.5 },
  { model: 'deepseek-flash', tariff: 'off-peak', input: 0.15, output: 0.6 },
  { model: 'deepseek-flash', tariff: 'peak', input: 0.3, output: 1.2 },
];
const tokenExamples = rates.map(rate => ({ ...rate,
  usd: Number(((comparison.inputTokens * rate.input + comparison.outputTokens * rate.output) / 1_000_000).toFixed(6)),
}));
assert.deepEqual(tokenExamples.map(r => r.usd), [0.4, 0.21, 0.42]);
console.log(JSON.stringify({ assumptions: scenarios, plans, results, tokenExamples }, null, 2));
