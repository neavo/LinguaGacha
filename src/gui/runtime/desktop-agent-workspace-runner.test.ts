import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_WORKSPACE_API,
  AGENT_WORKSPACE_MAX_RESULT_BYTES,
} from "../../shared/backend-runtime";

const electron_mocks = vi.hoisted(() => {
  const register_schemes = vi.fn();
  const protocol_handle = vi.fn();
  const protocol_unhandle = vi.fn();
  const on_before_request = vi.fn();
  const permission_check = vi.fn();
  const permission_request = vi.fn();
  const session_on = vi.fn();
  const clear_storage_data = vi.fn<() => Promise<void>>(async () => undefined);
  const runner_session = {
    protocol: { handle: protocol_handle, unhandle: protocol_unhandle },
    webRequest: { onBeforeRequest: on_before_request },
    setPermissionCheckHandler: permission_check,
    setPermissionRequestHandler: permission_request,
    on: session_on,
    clearStorageData: clear_storage_data,
  };
  const execute_javascript = vi.fn(async (_script: string) => '{"changed":2}');
  class BrowserWindow {
    static instances: BrowserWindow[] = [];
    destroyed = false;
    loadURL = vi.fn(async () => undefined);
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      executeJavaScript: execute_javascript,
    };

    constructor(readonly options: Record<string, unknown>) {
      BrowserWindow.instances.push(this);
    }

    destroy(): void {
      this.destroyed = true;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }
  }
  return {
    register_schemes,
    protocol_handle,
    protocol_unhandle,
    on_before_request,
    permission_check,
    permission_request,
    session_on,
    clear_storage_data,
    from_partition: vi.fn(() => runner_session),
    execute_javascript,
    BrowserWindow,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electron_mocks.BrowserWindow,
  protocol: { registerSchemesAsPrivileged: electron_mocks.register_schemes },
  session: { fromPartition: electron_mocks.from_partition },
}));

import {
  DesktopAgentWorkspaceRunner,
  register_agent_workspace_scheme,
} from "./desktop-agent-workspace-runner";

let workspace_path = "";
let session_root = "";
const ORIGINAL_ITEMS = '{"value":"original"}\n';

beforeEach(() => {
  vi.clearAllMocks();
  electron_mocks.BrowserWindow.instances.length = 0;
  electron_mocks.execute_javascript.mockReset().mockResolvedValue('{"changed":2}');
  electron_mocks.clear_storage_data.mockReset().mockResolvedValue(undefined);
  session_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-runner-"));
  workspace_path = path.join(session_root, "workspace");
  fs.mkdirSync(path.join(session_root, "task"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "items"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "changes", "items"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace_path, "contract.json"),
    JSON.stringify({
      limits: {
        query_page_default: 20,
        query_page_max: 100,
        literal_match_examples_default: 3,
      },
      datasets: { items: { path: "items/entries.jsonl" } },
      changes: { items: { updates: { path: "changes/items/updates.jsonl" } } },
    }),
  );
  fs.writeFileSync(path.join(workspace_path, "items", "entries.jsonl"), ORIGINAL_ITEMS);
  fs.writeFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fs.rmSync(session_root, { recursive: true, force: true });
});

describe("DesktopAgentWorkspaceRunner", () => {
  it("注册完整沙箱边界，并在结果过门后提交脚本事务", async () => {
    register_agent_workspace_scheme();
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'const rows = []; for await (const row of workspace.iterateJsonl(workspace.contract.datasets.items.path)) rows.push(row); await workspace.writeText(workspace.contract.changes.items.updates.path, "changed"); return { text: await workspace.readText(workspace.contract.changes.items.updates.path), rows, api: Object.keys(workspace).sort() };',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      status: "success",
      result: {
        text: "changed",
        rows: [{ value: "original" }],
        api: Object.keys(AGENT_WORKSPACE_API.members).sort(),
      },
    });
    expect(fs.readFileSync(path.join(workspace_path, "items", "entries.jsonl"), "utf-8")).toBe(
      ORIGINAL_ITEMS,
    );
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("changed");
    expect(electron_mocks.register_schemes).toHaveBeenCalledWith([
      {
        scheme: "lg-agent-workspace",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
    ]);
    expect(electron_mocks.from_partition).toHaveBeenCalledWith("agent-workspace", { cache: false });
    expect(electron_mocks.BrowserWindow.instances[0]?.options).toMatchObject({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });
    expect(electron_mocks.BrowserWindow.instances[0]?.destroyed).toBe(true);

    const filter = electron_mocks.on_before_request.mock.calls[0]?.[0] as
      | ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void)
      | undefined;
    if (filter === undefined) throw new Error("缺少网络过滤器");
    const network_result = vi.fn();
    const workspace_result = vi.fn();
    filter({ url: "https://example.com" }, network_result);
    filter({ url: "lg-agent-workspace://workspace/files/prompts.json" }, workspace_result);
    expect(network_result).toHaveBeenCalledWith({ cancel: true });
    expect(workspace_result).toHaveBeenCalledWith({ cancel: false });
    expect(electron_mocks.permission_check.mock.calls[0]?.[0]()).toBe(false);
    const permission_result = vi.fn();
    electron_mocks.permission_request.mock.calls[0]?.[0](undefined, undefined, permission_result);
    expect(permission_result).toHaveBeenCalledWith(false);
    const download_event = { preventDefault: vi.fn() };
    electron_mocks.session_on.mock.calls[0]?.[1](download_event);
    expect(download_event.preventDefault).toHaveBeenCalledOnce();

    runner.dispose();
    expect(electron_mocks.protocol_unhandle).toHaveBeenCalledWith("lg-agent-workspace");
  });

  it("语法错误回滚事务并保留工作区", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      { workspacePath: workspace_path, script: "const = ;" },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "failed",
      workspaceState: "preserved",
      failure: "execution_failed",
    });
    runner.dispose();
  });

  it("入口函数未显式返回结果时回滚本次事务", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'await workspace.writeText(workspace.contract.changes.items.updates.path, "changed");',
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "failed",
      workspaceState: "preserved",
      failure: "execution_failed",
      message: expect.stringContaining("显式返回 JSON"),
    });
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("");
    runner.dispose();
  });

  it("脚本结果按原生 JSON 语义省略 undefined 后提交事务", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'const dataset = workspace.contract.datasets.items; await workspace.writeText(workspace.contract.changes.items.updates.path, "changed"); return { dataset: { path: dataset.path, schema: dataset.schema } };',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      status: "success",
      result: { dataset: { path: "items/entries.jsonl" } },
    });
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("changed");
    runner.dispose();
  });

  it("无法序列化脚本结果时回滚本次事务", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'await workspace.writeText(workspace.contract.changes.items.updates.path, "changed"); const result = {}; result.self = result; return result;',
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "failed",
      workspaceState: "preserved",
      failure: "execution_failed",
    });
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("");
    runner.dispose();
  });

  it("流式脚本写入完整确定性变换并只返回摘要", async () => {
    const item_count = 3;
    fs.writeFileSync(
      path.join(workspace_path, "items", "entries.jsonl"),
      `${Array.from({ length: item_count }, (_, index) =>
        JSON.stringify({ item_id: index + 1, dst: `A-${(index + 1).toString()}` }),
      ).join("\n")}\n`,
      "utf-8",
    );
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'let updated = 0; async function* changes() { for await (const row of workspace.iterateJsonl(workspace.contract.datasets.items.path)) { updated += 1; yield { item_id: row.item_id, dst: row.dst.replace("A-", "B-") }; } } await workspace.writeJsonl(workspace.contract.changes.items.updates.path, changes()); return { updated };',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "success", result: { updated: item_count } });
    expect(
      fs
        .readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8")
        .trim()
        .split("\n"),
    ).toHaveLength(item_count);
    runner.dispose();
  });

  it("脚本超时销毁 renderer 并回滚事务", async () => {
    vi.useFakeTimers();
    electron_mocks.execute_javascript.mockImplementationOnce(
      async () => await new Promise<string>(() => undefined),
    );
    const runner = new DesktopAgentWorkspaceRunner();
    const running = runner.run(
      { workspacePath: workspace_path, script: "await pending;" },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(electron_mocks.execute_javascript).toHaveBeenCalledOnce());

    await vi.runOnlyPendingTimersAsync();

    await expect(running).resolves.toMatchObject({
      status: "failed",
      workspaceState: "preserved",
      failure: "execution_failed",
    });
    expect(electron_mocks.BrowserWindow.instances[0]?.destroyed).toBe(true);
    expect(fs.readdirSync(path.join(workspace_path, ".transactions"))).toEqual([]);
  });

  it("脚本可组合 bundle 内置只读方法与正式字面匹配", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    fs.writeFileSync(
      path.join(workspace_path, "items", "entries.jsonl"),
      `${JSON.stringify({ item_id: 1, src: "Straße", name_src: "" })}\n`,
    );
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'const query = await workspace.queryItems({ limit: 7 }); const matches = await workspace.matchLiterals({ patterns: [{ key: "road", text: "STRASSE", case_sensitive: false }] }); return { query, matches };',
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "success",
      result: {
        query: {
          total_item_count: 1,
          items: [{ item_id: 1, src: "Straße", name_src: "" }],
        },
        matches: {
          scanned_item_count: 1,
          matched_item_count: 1,
          patterns: [
            {
              key: "road",
              matched_item_count: 1,
              example_matches: [{ item_id: 1, field: "src" }],
            },
          ],
        },
      },
    });
    expect(fs.readdirSync(path.join(workspace_path, ".transactions"))).toEqual([]);
  });

  it("脚本可以捕获只读方法参数异常并继续提交当前事务", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'let message = ""; try { await workspace.queryItems([]); } catch (error) { message = error.message; } await workspace.writeText(workspace.contract.changes.items.updates.path, "recovered"); return { message };',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      status: "success",
      result: { message: expect.stringContaining("queryItems") },
    });
    expect(
      fs.readFileSync(path.join(workspace_path, "changes", "items", "updates.jsonl"), "utf-8"),
    ).toBe("recovered");
  });

  it("私有协议发现可信快照损坏时返回 invalidated 而非脚本校验失败", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    fs.writeFileSync(
      path.join(workspace_path, "items", "entries.jsonl"),
      `${JSON.stringify({ item_id: 0, src: "A", name_src: "" })}\n`,
    );
    prepare_program_execution();

    const result = await runner.run(
      {
        workspacePath: workspace_path,
        script:
          'return await workspace.matchLiterals({ patterns: [{ key: "a", text: "A", case_sensitive: true }] });',
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "failed",
      workspaceState: "invalidated",
      failure: "workspace_invalid",
    });
  });

  it("脚本异常返回可修复消息并隐藏工作区绝对路径", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    electron_mocks.execute_javascript.mockRejectedValueOnce(
      new Error(`第十步语法错误：${workspace_path}\\secret`),
    );

    const result = await runner.run(
      { workspacePath: workspace_path, script: "bad" },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "failed",
      workspaceState: "preserved",
      failure: "execution_failed",
    });
    if (result.status !== "failed") throw new Error("脚本异常没有返回失败结果");
    expect(result.message).toContain("[workspace]");
    expect(result.message).not.toContain(workspace_path);
    expect(fs.readFileSync(path.join(workspace_path, "items", "entries.jsonl"), "utf-8")).toBe(
      ORIGINAL_ITEMS,
    );
  });

  it("超大结果回滚事务并返回 preserved", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    electron_mocks.execute_javascript.mockResolvedValueOnce(
      `"${"x".repeat(AGENT_WORKSPACE_MAX_RESULT_BYTES)}"`,
    );

    await expect(
      runner.run(
        { workspacePath: workspace_path, script: "return big;" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      workspaceState: "preserved",
      failure: "execution_failed",
    });
    expect(fs.readFileSync(path.join(workspace_path, "items", "entries.jsonl"), "utf-8")).toBe(
      ORIGINAL_ITEMS,
    );
  });

  it("停止会等待当前事务回滚后再以原始原因拒绝", async () => {
    let reject_execution: ((error: Error) => void) | undefined;
    electron_mocks.execute_javascript.mockImplementationOnce(
      async () =>
        await new Promise<string>((_resolve, reject) => {
          reject_execution = reject;
        }),
    );
    const runner = new DesktopAgentWorkspaceRunner();
    const controller = new AbortController();
    const reason = new Error("用户停止");
    const running = runner.run(
      { workspacePath: workspace_path, script: "await pending;" },
      controller.signal,
    );
    await vi.waitFor(() => expect(electron_mocks.execute_javascript).toHaveBeenCalledOnce());

    controller.abort(reason);
    reject_execution?.(new Error("renderer destroyed"));

    await expect(running).rejects.toBe(reason);
    expect(fs.readdirSync(path.join(workspace_path, ".transactions"))).toEqual([]);
  });

  it("从异步准备开始拒绝并发操作", async () => {
    let release: (() => void) | undefined;
    electron_mocks.clear_storage_data.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const runner = new DesktopAgentWorkspaceRunner();
    const first = runner.run(
      { workspacePath: workspace_path, script: "return null;" },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(electron_mocks.clear_storage_data).toHaveBeenCalledOnce());

    await expect(
      runner.run(
        { workspacePath: workspace_path, script: "return null;" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("An agent workspace operation is already running.");
    release?.();
    await expect(first).resolves.toMatchObject({ status: "success" });
  });
});

/** 在测试进程执行 renderer 程序，并把相对 fetch 接回 runner 已注册的私有协议。 */
function prepare_program_execution(): void {
  const handler = electron_mocks.protocol_handle.mock.calls[0]?.[1] as
    | ((request: Request) => Promise<Response>)
    | undefined;
  if (handler === undefined) throw new Error("缺少工作区协议处理器");
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const raw_url = input instanceof Request ? input.url : String(input);
      const request_init =
        init?.body instanceof ReadableStream ? ({ ...init, duplex: "half" } as RequestInit) : init;
      return await handler(
        new Request(new URL(raw_url, "lg-agent-workspace://workspace/__runner__"), request_init),
      );
    },
  );
  electron_mocks.execute_javascript.mockImplementationOnce(
    async (script: string) => await (0, eval)(script),
  );
}
