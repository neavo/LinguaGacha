import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProofreadingRuntimeClient } from "./proofreading-runtime-client";

type WorkerRequestMessage =
  | {
      id: number;
      type: "hydrate_full";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "apply_item_delta";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "build_list_view";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "read_list_window";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "read_row_ids_range";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "read_items_by_row_ids";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "build_filter_panel";
      input: Record<string, unknown>;
    }
  | {
      id: number;
      type: "dispose_project";
      input: Record<string, unknown>;
    };

class MockWorker {
  static instances: MockWorker[] = [];

  posted_messages: WorkerRequestMessage[] = [];
  terminated = false;
  private message_listener:
    | ((event: MessageEvent<{ id: number; result: unknown }>) => void)
    | null = null;
  private error_listener: ((event: Event) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      this.message_listener = listener as (
        event: MessageEvent<{ id: number; result: unknown }>,
      ) => void;
      return;
    }

    if (type === "error") {
      this.error_listener = listener as (event: Event) => void;
    }
  }

  postMessage(message: WorkerRequestMessage): void {
    this.posted_messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  dispatch_message(id: number, result: unknown): void {
    this.message_listener?.({
      data: {
        id,
        result,
      },
    } as MessageEvent<{ id: number; result: unknown }>);
  }

  dispatch_error(): void {
    this.error_listener?.(new Event("error"));
  }
}

function create_hydration_input() {
  return {
    project_id: "demo",
    revision: 1,
    total_item_count: 0,
    items: [],
    quality: {
      glossary: {
        enabled: false,
        mode: "off",
        revision: 0,
        entries: [],
      },
      pre_replacement: {
        enabled: false,
        mode: "off",
        revision: 0,
        entries: [],
      },
      post_replacement: {
        enabled: false,
        mode: "off",
        revision: 0,
        entries: [],
      },
      text_preserve: {
        enabled: false,
        mode: "off",
        revision: 0,
        entries: [],
      },
    },
    source_language: "JA",
  };
}

function create_list_query() {
  return {
    filters: {
      warning_types: ["NO_WARNING"],
      statuses: ["NONE"],
      file_paths: [],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
    keyword: "",
    scope: "all" as const,
    is_regex: false,
    sort_state: null,
  };
}

describe("createProofreadingRuntimeClient", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("当前环境不支持 Worker 时直接抛出结构化错误", async () => {
    vi.stubGlobal("Worker", undefined);

    const client = createProofreadingRuntimeClient();

    await expect(client.hydrate_full(create_hydration_input())).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "unsupported",
    });
  });

  it("Worker 初始化失败时直接抛出结构化错误", async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error("boom");
      }
    }

    vi.stubGlobal("Worker", ThrowingWorker as unknown as typeof Worker);

    const client = createProofreadingRuntimeClient();

    await expect(client.hydrate_full(create_hydration_input())).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "init_failed",
    });
  });

  it("worker 执行报错时 reject 所有挂起请求", async () => {
    const client = createProofreadingRuntimeClient();
    const result_promise = client.build_list_view(create_list_query());
    const worker = MockWorker.instances[0];

    worker?.dispatch_error();

    await expect(result_promise).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "execution_failed",
    });
    expect(worker?.terminated).toBe(true);
    client.dispose();
  });

  it("会按新协议发送请求并解析 worker 返回结果", async () => {
    const client = createProofreadingRuntimeClient();

    const hydrate_promise = client.hydrate_full(create_hydration_input());
    const worker = MockWorker.instances[0];
    const hydrate_request = worker?.posted_messages[0];
    expect(hydrate_request).toMatchObject({
      type: "hydrate_full",
    });

    worker?.dispatch_message(hydrate_request?.id ?? 0, {
      revision: 1,
      project_id: "demo",
      total_item_count: 0,
      review_item_count: 0,
      warning_item_count: 0,
      default_filters: create_list_query().filters,
    });

    await expect(hydrate_promise).resolves.toMatchObject({
      revision: 1,
      project_id: "demo",
    });

    const list_view_promise = client.build_list_view(create_list_query());
    const list_view_request = worker?.posted_messages[1];
    expect(list_view_request).toMatchObject({
      type: "build_list_view",
    });

    worker?.dispatch_message(list_view_request?.id ?? 0, {
      revision: 1,
      project_id: "demo",
      view_id: "demo-view",
      row_count: 0,
      window_start: 0,
      summary: {
        total_items: 0,
        filtered_items: 0,
        warning_items: 0,
      },
      default_filters: create_list_query().filters,
      filters: create_list_query().filters,
      window_rows: [],
      invalid_regex_message: null,
    });

    await expect(list_view_promise).resolves.toMatchObject({
      revision: 1,
      project_id: "demo",
      window_rows: [],
    });

    const window_promise = client.read_list_window({
      view_id: "demo-view",
      start: 0,
      count: 20,
    });
    const window_request = worker?.posted_messages[2];
    expect(window_request).toMatchObject({
      type: "read_list_window",
      input: {
        view_id: "demo-view",
      },
    });
    worker?.dispatch_message(window_request?.id ?? 0, {
      view_id: "demo-view",
      start: 0,
      rows: [],
    });
    await expect(window_promise).resolves.toMatchObject({
      view_id: "demo-view",
      rows: [],
    });

    const dispose_promise = client.dispose_project("demo");
    const dispose_request = worker?.posted_messages[3];
    expect(dispose_request).toMatchObject({
      type: "dispose_project",
      input: {
        project_id: "demo",
      },
    });
    worker?.dispatch_message(dispose_request?.id ?? 0, null);
    await expect(dispose_promise).resolves.toBeUndefined();
  });
});
