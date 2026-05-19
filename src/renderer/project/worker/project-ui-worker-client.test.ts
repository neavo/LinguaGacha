import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectUiWorkerClient } from "@/project/worker/project-ui-worker-client";
import { ProjectUiWorkerScheduler } from "@/project/worker/project-ui-worker-scheduler";
import type {
  ProjectUiWorkerRequest,
  ProjectUiWorkerResponse,
} from "@/project/worker/project-ui-worker-protocol";

class MockWorker {
  static instances: MockWorker[] = [];

  posted_messages: ProjectUiWorkerRequest[] = [];
  private message_listener: ((event: MessageEvent<ProjectUiWorkerResponse>) => void) | null = null;

  public constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  public addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      this.message_listener = listener as (event: MessageEvent<ProjectUiWorkerResponse>) => void;
    }
  }

  public postMessage(message: ProjectUiWorkerRequest): void {
    this.posted_messages.push(message);
  }

  public terminate(): void {}

  public dispatch_message(id: number, result: unknown): void {
    this.message_listener?.({
      data: {
        id,
        ok: true,
        result,
      },
    } as MessageEvent<ProjectUiWorkerResponse>);
  }
}

function create_client() {
  const scheduler = new ProjectUiWorkerScheduler(
    () => new MockWorker("project-ui-worker-entry.js") as unknown as Worker,
  );
  return createProjectUiWorkerClient(scheduler);
}

describe("createProjectUiWorkerClient", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("把校对、质量统计和项目释放请求统一发送到 Project UI Worker", async () => {
    const client = create_client();
    const hydration = client.hydrate_proofreading_full({
      projectId: "demo",
      revisions: {
        items: 1,
        quality: 1,
        proofreading: 1,
      },
      total_item_count: 0,
      upsertItems: [],
      quality: {
        glossary: { enabled: false, mode: "off", revision: 0, entries: [] },
        pre_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
        post_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
        text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
      },
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });
    const worker = MockWorker.instances[0];
    expect(worker?.posted_messages[0]).toMatchObject({
      type: "proofreading.hydrate_full",
    });
    worker?.dispatch_message(1, {
      projectId: "demo",
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      revisions: {
        items: 1,
        quality: 1,
        proofreading: 1,
      },
      defaultFilters: {
        warning_types: [],
        statuses: [],
        file_paths: [],
        glossary_terms: [],
        include_without_glossary_miss: true,
      },
    });
    await expect(hydration).resolves.toMatchObject({
      projectId: "demo",
    });

    const statistics = client.compute_quality_statistics({
      rules: [],
      srcTexts: [],
      dstTexts: [],
      relationCandidates: [],
    });
    expect(worker?.posted_messages[1]).toMatchObject({
      type: "quality.compute_statistics",
    });
    worker?.dispatch_message(2, { results: {} });
    await expect(statistics).resolves.toEqual({ results: {} });

    const dispose = client.dispose_project("demo");
    expect(worker?.posted_messages[2]).toMatchObject({
      type: "project.dispose",
      input: {
        projectId: "demo",
      },
    });
    worker?.dispatch_message(3, null);
    await expect(dispose).resolves.toBeUndefined();
    client.dispose();
  });
});
