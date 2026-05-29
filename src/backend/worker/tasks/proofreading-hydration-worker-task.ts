import {
  evaluateProofreadingSlice,
  type ProofreadingEvaluatedSlice,
  type ProofreadingHydrationInput,
} from "../../../shared/proofreading/proofreading-list-reader";

export type ProofreadingHydrationWorkerTaskInput = ProofreadingHydrationInput;

export function run_proofreading_hydration_worker_task(
  input: ProofreadingHydrationWorkerTaskInput,
): ProofreadingEvaluatedSlice {
  return evaluateProofreadingSlice(input);
}
