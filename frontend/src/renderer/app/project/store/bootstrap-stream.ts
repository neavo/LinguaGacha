export type BootstrapStreamEvent = {
  type: string;
  stage?: string;
  message?: string;
  payload?: Record<string, unknown>;
  projectRevision?: number;
  sectionRevisions?: Record<string, number>;
};

export async function consumeBootstrapStream(args: {
  open: () => AsyncIterable<BootstrapStreamEvent>;
  onStageStarted?: (stage: string) => void;
  onStagePayload: (stage: string, payload: Record<string, unknown>) => void;
  onCompleted?: (projectRevision: number, sectionRevisions: Record<string, number>) => void;
}): Promise<void> {
  for await (const event of args.open()) {
    if (event.type === "stage_started" && typeof event.stage === "string") {
      args.onStageStarted?.(event.stage);
      continue;
    }

    if (
      event.type === "stage_payload" &&
      typeof event.stage === "string" &&
      event.payload !== undefined
    ) {
      args.onStagePayload(event.stage, event.payload);
      continue;
    }

    if (event.type === "completed") {
      args.onCompleted?.(Number(event.projectRevision ?? 0), event.sectionRevisions ?? {});
    }
  }
}
