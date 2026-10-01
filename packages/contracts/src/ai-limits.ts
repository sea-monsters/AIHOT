/** Site configuration bounds, not a model's context window or output capability. */
export const AI_OUTPUT_TOKENS = { min: 1_024, max: 1_048_576, default: 4_096 } as const;

/** Per-task tool attempts, including cached reads and invalid calls; provider quotas remain separate. */
export const AI_TOOL_LIMITS = {
  identicalConsecutive: 5, sameToolConsecutive: 15, total: 200,
  // One productive tool attempt per round, plus a final tool-free answer.
  modelRounds: 201, contextBytes: 262_144, resultBytes: 2_097_152,
} as const;

export function isValidOutputTokenLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= AI_OUTPUT_TOKENS.min && value <= AI_OUTPUT_TOKENS.max;
}
