import { createWorkerClient, type ProofreadingWorkerExecutor } from './workers/worker-client'
import type {
  ProofreadingWorkerInput,
  ProofreadingWorkerResult,
} from './workers/worker.types'

export type ScheduledProofreadingResult = ProofreadingWorkerResult & {
  cancelled?: boolean
}

export class ComputeScheduler {
  private proofreading_run_id = 0
  private readonly worker_client

  constructor(args: { executeProofreadingTask?: ProofreadingWorkerExecutor } = {}) {
    this.worker_client = createWorkerClient(args.executeProofreadingTask)
  }

  cancelProofreadingTask(): void {
    this.proofreading_run_id += 1
  }

  async runProofreadingTask(
    input: ProofreadingWorkerInput,
  ): Promise<ScheduledProofreadingResult> {
    const run_id = this.proofreading_run_id + 1
    this.proofreading_run_id = run_id

    const result = await this.worker_client.runProofreadingTask(input)
    if (run_id !== this.proofreading_run_id) {
      return {
        cancelled: true,
        warningMap: {},
      }
    }

    return result
  }
}
