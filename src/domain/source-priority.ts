import type { SourceKind } from './conversation.js';

const kinds: readonly SourceKind[] = ['PROFILE', 'GROUP', 'PAGE', 'UNKNOWN'];

/** Source metadata is only the final tie-breaker after the semantic ranking dimensions.
 * Omitted preferences retain the deployed legacy order, including PAGE = UNKNOWN.
 * A partial explicit order leaves all unmentioned source kinds tied, never excluded. */
export function sourcePriorityScores(priority?: readonly SourceKind[]): Record<SourceKind, number> {
  if (priority === undefined) return { PROFILE: 3, GROUP: 2, PAGE: 1, UNKNOWN: 1 };
  if (!Array.isArray(priority) || priority.length < 1 || priority.length > kinds.length
    || priority.some(kind => !kinds.includes(kind)) || new Set(priority).size !== priority.length) throw Error('SOURCE_PRIORITY_INVALID');
  return Object.fromEntries(kinds.map(kind => {
    const index = priority.indexOf(kind);
    return [kind, index < 0 ? 0 : priority.length - index];
  })) as Record<SourceKind, number>;
}
