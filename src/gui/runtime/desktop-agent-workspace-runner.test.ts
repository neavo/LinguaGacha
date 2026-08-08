import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const from_partition = vi.fn(() => runner_session);
  const execute_javascript = vi.fn(async () => '{"changed":2}');
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
    from_partition,
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
  handle_agent_workspace_protocol_request,
  register_agent_workspace_scheme,
  resolve_workspace_path,
} from "./desktop-agent-workspace-runner";

let workspace_path = "";

beforeEach(() => {
  vi.clearAllMocks();
  electron_mocks.BrowserWindow.instances.length = 0;
  workspace_path = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-runner-"));
  fs.mkdirSync(path.join(workspace_path, "target"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "context"), { recursive: true });
  fs.mkdirSync(path.join(workspace_path, "scratch"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(workspace_path, { recursive: true, force: true });
});

describe("Agent 工作区私有协议", () => {
  it("注册私有 scheme，并以无 Node 的独立沙箱窗口执行脚本", async () => {
    register_agent_workspace_scheme();
    const runner = new DesktopAgentWorkspaceRunner();

    const result = await runner.run(
      { workspacePath: workspace_path, script: "return { changed: 2 }" },
      new AbortController().signal,
    );

    expect(electron_mocks.register_schemes).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: "lg-agent-workspace",
        privileges: expect.objectContaining({
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        }),
      }),
    ]);
    expect(electron_mocks.from_partition).toHaveBeenCalledWith("agent-workspace", {
      cache: false,
    });
    const target_window = electron_mocks.BrowserWindow.instances[0];
    expect(target_window?.options).toMatchObject({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });
    expect(target_window?.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('new AsyncFunction("workspace", "return { changed: 2 }")'),
      true,
    );
    expect(electron_mocks.clear_storage_data).toHaveBeenCalledOnce();
    expect(target_window?.destroyed).toBe(true);
    expect(result).toEqual({ result: { changed: 2 } });

    runner.dispose();
    expect(electron_mocks.protocol_unhandle).toHaveBeenCalledWith("lg-agent-workspace");
  });

  it("main 对脚本结果独立执行 64 KiB 上限并销毁窗口", async () => {
    const runner = new DesktopAgentWorkspaceRunner();
    const oversized = JSON.stringify("x".repeat(64 * 1024));
    electron_mocks.execute_javascript.mockResolvedValueOnce(oversized);
    const execution = runner.run(
      { workspacePath: workspace_path, script: "return null" },
      new AbortController().signal,
    );

    await expect(execution).rejects.toThrow("脚本返回结果过大");
    const target_window = electron_mocks.BrowserWindow.instances[0];
    expect(target_window?.destroyed).toBe(true);
  });

  it("首个异步准备阶段即拒绝并发脚本", async () => {
    let release_storage: () => void = () => undefined;
    electron_mocks.clear_storage_data.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          release_storage = resolve;
        }),
    );
    const runner = new DesktopAgentWorkspaceRunner();
    const first = runner.run(
      { workspacePath: workspace_path, script: "return null" },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(electron_mocks.clear_storage_data).toHaveBeenCalledOnce());

    await expect(
      runner.run(
        { workspacePath: workspace_path, script: "return null" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("正在运行");

    release_storage();
    await expect(first).resolves.toEqual({ result: { changed: 2 } });
  });

  it("拒绝绝对路径、反斜线和根目录穿越", () => {
    expect(() => resolve_workspace_path(workspace_path, "../secret.txt")).toThrow("越界");
    expect(() => resolve_workspace_path(workspace_path, "C:/secret.txt")).toThrow("非法");
    expect(() => resolve_workspace_path(workspace_path, "context\\secret.txt")).toThrow("非法");
  });

  it("流式覆盖 target 文件并保持 context 只读", async () => {
    const content = "译文".repeat(400_000);
    const target_response = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/target/items.jsonl", {
        method: "PUT",
        body: content,
      }),
    );

    expect(target_response.status).toBe(204);
    expect(fs.readFileSync(path.join(workspace_path, "target", "items.jsonl"), "utf-8")).toBe(
      content,
    );

    const context_response = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/context/items.jsonl", {
        method: "PUT",
        body: "bad",
      }),
    );
    expect(context_response.status).toBe(403);
    expect(fs.existsSync(path.join(workspace_path, "context", "items.jsonl"))).toBe(false);
  });

  it("写入流失败时保留原 target 并清理临时文件", async () => {
    const target_path = path.join(workspace_path, "target", "items.jsonl");
    fs.writeFileSync(target_path, "original", "utf-8");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("stream failed"));
      },
    });

    const response = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/target/items.jsonl", {
        method: "PUT",
        body,
        // Chromium 上传流要求 half duplex；Node Request 同样校验该字段。
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(400);
    expect(fs.readFileSync(target_path, "utf-8")).toBe("original");
    expect(fs.readdirSync(path.dirname(target_path))).toEqual(["items.jsonl"]);
  });

  it("允许读取上下文并只删除 scratch", async () => {
    fs.writeFileSync(path.join(workspace_path, "context", "project.json"), '{"ok":true}');
    fs.writeFileSync(path.join(workspace_path, "scratch", "report.txt"), "report");

    const read_response = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/context/project.json"),
    );
    expect(await read_response.text()).toBe('{"ok":true}');

    const delete_response = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/scratch/report.txt", {
        method: "DELETE",
      }),
    );
    expect(delete_response.status).toBe(204);
    expect(fs.existsSync(path.join(workspace_path, "scratch", "report.txt"))).toBe(false);

    const denied = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/context/project.json", {
        method: "DELETE",
      }),
    );
    expect(denied.status).toBe(403);
  });

  it("文件系统错误不会向脚本泄露工作区绝对路径", async () => {
    const response = await handle_agent_workspace_protocol_request(
      workspace_path,
      new Request("lg-agent-workspace://workspace/files/context/missing.json"),
    );
    const message = await response.text();

    expect(response.status).toBe(400);
    expect(message).toBe("工作区文件操作失败。");
    expect(message).not.toContain(workspace_path);
  });
});
