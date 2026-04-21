import type { ProofreadingSnapshot } from '@/pages/proofreading-page/types'
import {
  computeProofreadingSnapshot,
  type ProofreadingRuntimeInput,
} from '@/pages/proofreading-page/proofreading-runtime'

type ProofreadingRuntimeWorkerRequest = {
  id: number
  input: ProofreadingRuntimeInput
}

type ProofreadingRuntimeWorkerResponse = {
  id: number
  snapshot: ProofreadingSnapshot
}

const runtime_scope = self

runtime_scope.addEventListener('message', (event: MessageEvent<ProofreadingRuntimeWorkerRequest>) => {
  const request = event.data
  const response: ProofreadingRuntimeWorkerResponse = {
    id: request.id,
    snapshot: computeProofreadingSnapshot(request.input),
  }
  runtime_scope.postMessage(response)
})

export {}
