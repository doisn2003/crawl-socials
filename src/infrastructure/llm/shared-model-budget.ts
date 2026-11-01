/** Synchronous reservation accounting across model gateways in the same campaign process.
 * Each gateway reconstructs its own account from its durable ledger before any calls start.
 */
export function createSharedModelBudget(limitUsd: number) {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw Error('MODEL_BUDGET_INVALID');
  const accounts = new Map<string, number>();
  const used = () => [...accounts.values()].reduce((sum, value) => sum + value, 0);
  return {
    limitUsd,
    setAccounted(owner: string, amount: number) {
      if (!owner || !Number.isFinite(amount) || amount < 0) throw Error('MODEL_BUDGET_ACCOUNT_INVALID');
      accounts.set(owner, amount);
    },
    canReserve(amount: number) { return Number.isFinite(amount) && amount >= 0 && used() + amount <= limitUsd; },
    remaining() { return Math.max(0, limitUsd - used()); },
  };
}
export type SharedModelBudget = ReturnType<typeof createSharedModelBudget>;
