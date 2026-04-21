export type QualityStatisticsWorkerInput = {
  rules: Array<{
    key: string
    pattern: string
    mode: string
    case_sensitive?: boolean
  }>
  srcTexts: string[]
  dstTexts: string[]
}

export async function runQualityStatisticsWorkerTask(
  input: QualityStatisticsWorkerInput,
): Promise<{
  results: Record<string, { matched_item_count: number; subset_parents?: string[] }>
  subset_parents: Record<string, string[]>
}> {
  const results: Record<string, { matched_item_count: number; subset_parents?: string[] }> = {}

  for (const rule of input.rules) {
    results[rule.key] = {
      matched_item_count: input.srcTexts.filter((text) => text.includes(rule.pattern)).length,
    }
  }

  return {
    results,
    subset_parents: {},
  }
}
