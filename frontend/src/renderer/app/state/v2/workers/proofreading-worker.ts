import type {
  ProofreadingWorkerInput,
  ProofreadingWorkerResult,
} from './worker.types'

export async function runProofreadingWorkerTask(
  input: ProofreadingWorkerInput,
): Promise<ProofreadingWorkerResult> {
  const warningMap: Record<string, string[]> = {}

  for (const item of input.items) {
    const warnings: string[] = []
    if (input.config.check_similarity && item.src === item.dst) {
      warnings.push('SIMILARITY')
    }
    if (
      input.glossary.some((term) => {
        return item.src.includes(term.src) && !item.dst.includes(term.dst)
      })
    ) {
      warnings.push('GLOSSARY')
    }
    warningMap[String(item.item_id)] = warnings
  }

  return {
    warningMap,
  }
}
