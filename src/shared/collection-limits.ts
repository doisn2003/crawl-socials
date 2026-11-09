/** Product limits shared by UI/config and bounded collection workers. */
export const MAX_RESULT_TARGET = 5_000;
export const MAX_RAW_POSTS = 50_000;
export const MAX_SEARCH_QUERIES = 240;
export const DEFAULT_RAW_CAP = 5_000;
export const DEFAULT_RUN_BUDGET_USD = 3;
export const DEFAULT_USER_SPEND_LIMITS = { totalUsd: 30, dailyUsd: 6 } as const;
export const DEFAULT_RUN_MINUTES = 720;
