import {
  compute_project_prefilter_mutation,
  type ProjectPrefilterMutationInput,
  type ProjectPrefilterMutationOutput,
} from "@/app/project/derived/project-prefilter";

type ProjectPrefilterWorkerRequest = {
  id: number;
  input: ProjectPrefilterMutationInput;
};

type ProjectPrefilterWorkerResponse = {
  id: number;
  output: ProjectPrefilterMutationOutput;
};

const runtime_scope = self;

runtime_scope.addEventListener("message", (event: MessageEvent<ProjectPrefilterWorkerRequest>) => {
  const request = event.data;
  const response: ProjectPrefilterWorkerResponse = {
    id: request.id,
    output: compute_project_prefilter_mutation(request.input),
  };
  runtime_scope.postMessage(response);
});

export {};
