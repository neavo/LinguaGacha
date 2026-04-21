import type {
  ProofreadingWorkerInput,
  ProofreadingWorkerResult,
} from './worker.types'
import { runProofreadingWorkerTask } from './proofreading-worker'

export type ProofreadingWorkerExecutor = (
  input: ProofreadingWorkerInput,
) => Promise<ProofreadingWorkerResult>

export function createWorkerClient(
  executeProofreadingTask: ProofreadingWorkerExecutor = runProofreadingWorkerTask,
) {
  return {
    runProofreadingTask(input: ProofreadingWorkerInput): Promise<ProofreadingWorkerResult> {
      return executeProofreadingTask(input)
    },
  }
}
