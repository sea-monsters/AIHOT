/** Site configuration bounds, not a model's context window or output capability. */
export const AI_OUTPUT_TOKENS = { min: 1_024, max: 1_048_576, default: 4_096 } as const;

export function isValidOutputTokenLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= AI_OUTPUT_TOKENS.min && value <= AI_OUTPUT_TOKENS.max;
}
