export type ProofreadingWorkerItem = {
  item_id: number
  src: string
  dst: string
  status: string
  file_path: string
}

export type ProofreadingWorkerGlossaryTerm = {
  src: string
  dst: string
}

export type ProofreadingWorkerConfig = {
  source_language: string
  check_similarity: boolean
}

export type ProofreadingWorkerInput = {
  items: ProofreadingWorkerItem[]
  glossary: ProofreadingWorkerGlossaryTerm[]
  config: ProofreadingWorkerConfig
}

export type ProofreadingWorkerResult = {
  warningMap: Record<string, string[]>
}
