import {
  evaluateProofreadingSlice,
  type ProofreadingEvaluatedSlice,
  type ProofreadingSyncInput,
} from "../../../shared/proofreading/proofreading-list-reader";

/**
 * ProofreadingSyncWorkerTaskInput 复用校对列表同步输入，保持 worker 载荷与共享算法一致。
 */
export type ProofreadingSyncWorkerTaskInput = ProofreadingSyncInput;

/**
 * 在 worker 线程评估校对分片，只返回可序列化的原始行和评估行。
 */
export function run_proofreading_sync_worker_task(
  input: ProofreadingSyncWorkerTaskInput,
): ProofreadingEvaluatedSlice {
  return evaluateProofreadingSlice(input);
}
