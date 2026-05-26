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

function create_client_with_hydration_workers(worker_count: number) {
  const scheduler = new ProjectUiWorkerScheduler(
    () => new MockWorker("project-ui-worker-entry.js") as unknown as Worker,
  );
  return createProjectUiWorkerClient(scheduler, {
    hydrationWorkerCount: worker_count,
    createHydrationScheduler: () => {
      return new ProjectUiWorkerScheduler(
        () => new MockWorker("project-ui-worker-entry.js") as unknown as Worker,
      );
    },
  });
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

    const row_index = client.resolve_proofreading_row_index({
      view_id: "view-1",
      row_id: "42",
    });
    expect(worker?.posted_messages[1]).toMatchObject({
      type: "proofreading.resolve_row_index",
      input: {
        view_id: "view-1",
        row_id: "42",
      },
    });
    worker?.dispatch_message(2, 7);
    await expect(row_index).resolves.toBe(7);

    const statistics = client.compute_quality_statistics({
      rules: [],
      srcTexts: [],
      dstTexts: [],
      relationCandidates: [],
    });
    expect(worker?.posted_messages[2]).toMatchObject({
      type: "quality.compute_statistics",
    });
    worker?.dispatch_message(3, { results: {} });
    await expect(statistics).resolves.toEqual({ results: {} });

    const dispose = client.dispose_project("demo");
    expect(worker?.posted_messages[3]).toMatchObject({
      type: "project.dispose",
      input: {
        projectId: "demo",
      },
    });
    worker?.dispatch_message(4, null);
    await expect(dispose).resolves.toBeUndefined();
    client.dispose();
  });

  it("大项目校对 hydrate 会按统一容量分片后在主 worker 合并", async () => {
    const client = create_client_with_hydration_workers(2);
    const hydration = client.hydrate_proofreading_full({
      projectId: "demo",
      revisions: {
        items: 1,
        quality: 1,
        proofreading: 1,
      },
      total_item_count: 1024,
      upsertItems: Array.from({ length: 1024 }, (_value, index) => {
        return {
          item_id: index + 1,
          file_path: "chapter.txt",
          row_number: index + 1,
          src: `src-${index + 1}`,
          dst: `dst-${index + 1}`,
          status: "NONE",
          text_type: "NONE",
          retry_count: 0,
        };
      }),
      quality: {
        glossary: { enabled: false, mode: "off", revision: 0, entries: [] },
        pre_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
        post_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
        text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
      },
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });

    const primary_worker = MockWorker.instances[0];
    const shard_worker = MockWorker.instances[1];
    expect(primary_worker?.posted_messages[0]).toMatchObject({
      type: "proofreading.evaluate_hydration_slice",
    });
    expect(shard_worker?.posted_messages[0]).toMatchObject({
      type: "proofreading.evaluate_hydration_slice",
    });
    expect(primary_worker?.posted_messages[0]?.input).toMatchObject({
      upsertItems: expect.arrayContaining([expect.objectContaining({ item_id: 1 })]),
    });
    expect(shard_worker?.posted_messages[0]?.input).toMatchObject({
      upsertItems: expect.arrayContaining([expect.objectContaining({ item_id: 513 })]),
    });

    primary_worker?.dispatch_message(1, {
      projectId: "demo",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 1024,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      rawItems: [{ item_id: 1 }],
      evaluatedItems: [{ item_id: 1, row_id: "1" }],
    });
    shard_worker?.dispatch_message(1, {
      projectId: "demo",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 1024,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      rawItems: [{ item_id: 513 }],
      evaluatedItems: [{ item_id: 513, row_id: "513" }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(primary_worker?.posted_messages[1]).toMatchObject({
      type: "proofreading.hydrate_evaluated_full",
      input: {
        rawItems: [{ item_id: 1 }, { item_id: 513 }],
        evaluatedItems: [
          { item_id: 1, row_id: "1" },
          { item_id: 513, row_id: "513" },
        ],
      },
    });
    primary_worker?.dispatch_message(2, {
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
    client.dispose();
  });

  it("释放项目会取消正在进行的分片 hydrate 并阻止主 worker 合并", async () => {
    const client = create_client_with_hydration_workers(2);
    const hydration = client.hydrate_proofreading_full({
      projectId: "demo",
      revisions: {
        items: 1,
        quality: 1,
        proofreading: 1,
      },
      total_item_count: 1024,
      upsertItems: Array.from({ length: 1024 }, (_value, index) => {
        return {
          item_id: index + 1,
          file_path: "chapter.txt",
          row_number: index + 1,
          src: `src-${index + 1}`,
          dst: `dst-${index + 1}`,
          status: "NONE",
          text_type: "NONE",
          retry_count: 0,
        };
      }),
      quality: {
        glossary: { enabled: false, mode: "off", revision: 0, entries: [] },
        pre_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
        post_replacement: { enabled: false, mode: "off", revision: 0, entries: [] },
        text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
      },
      sourceLanguage: "JA",
      targetLanguage: "ZH",
    });
    const hydration_rejection = expect(hydration).rejects.toMatchObject({ code: "stale" });
    const primary_worker = MockWorker.instances[0];
    const shard_worker = MockWorker.instances[1];

    const dispose = client.dispose_project("demo");
    primary_worker?.dispatch_message(1, {
      projectId: "demo",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 1024,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      rawItems: [{ item_id: 1 }],
      evaluatedItems: [{ item_id: 1, row_id: "1" }],
    });
    shard_worker?.dispatch_message(1, {
      projectId: "demo",
      revisions: { items: 1, quality: 1, proofreading: 1 },
      total_item_count: 1024,
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      rawItems: [{ item_id: 513 }],
      evaluatedItems: [{ item_id: 513, row_id: "513" }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(primary_worker?.posted_messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "proofreading.hydrate_evaluated_full" }),
      ]),
    );
    expect(primary_worker?.posted_messages[1]).toMatchObject({
      type: "project.dispose",
      input: { projectId: "demo" },
    });
    expect(shard_worker?.posted_messages[1]).toMatchObject({
      type: "project.dispose",
      input: { projectId: "demo" },
    });
    primary_worker?.dispatch_message(2, null);
    shard_worker?.dispatch_message(2, null);

    await hydration_rejection;
    await expect(dispose).resolves.toBeUndefined();
    client.dispose();
  });
});
