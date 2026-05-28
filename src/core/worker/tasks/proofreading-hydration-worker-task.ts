import {
  evaluateProofreadingRuntimeSlice,
  type ProofreadingRuntimeEvaluatedSliceResult,
  type ProofreadingRuntimeHydrationInput,
} from "../../../shared/proofreading/proofreading-read-model";

export type ProofreadingHydrationWorkerTaskInput = ProofreadingRuntimeHydrationInput;

export function run_proofreading_hydration_worker_task(
  input: ProofreadingHydrationWorkerTaskInput,
): ProofreadingRuntimeEvaluatedSliceResult {
  return evaluateProofreadingRuntimeSlice(input);
}
