import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("node:child_process", () => ({ fork }));

import { AgentWorkspaceRunner, AgentWorkspaceScriptError } from "./runner";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

const workspace_path = path.resolve("workspace");
const runtime_entry_path = path.resolve("runtime/runtime.mjs");
const request = { workspacePath: workspace_path, script: "return null;", todos: [] };
const complete = {
  type: "complete",
  response: { ok: true, result: { changed: 2 }, todos: ["核验结果"] },
};

beforeEach(() => fork.mockReset());
afterEach(() => vi.useRealTimers());

describe("AgentWorkspaceRunner", () => {
  it("复用当前可执行文件并通过 IPC 返回结果", async () => {
    const child = fake_process();
    fork.mockReturnValue(child);
    const result = build_runner().run(request, new AbortController().signal);
    expect(child.send).toHaveBeenCalledWith(
      { type: "start", script: request.script, todos: [] },
      expect.any(Function),
    );
    expect(fork).toHaveBeenCalledWith(
      runtime_entry_path,
      [],
      expect.objectContaining({
        execPath: process.execPath,
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" }),
      }),
    );
    child.emit("message", complete);
    child.emit("close", 0);
    await expect(result).resolves.toEqual({ result: { changed: 2 }, todos: ["核验结果"] });
  });

  it("并发代理请求传回宿主规则，取消后丢弃迟到响应", async () => {
    const child = fake_process();
    fork.mockReturnValue(child);
    let pending_signal: AbortSignal | undefined;
    let finish_pending: (rules: string) => void = () => undefined;
    const runner = build_runner(async (url, signal) => {
      if (url.endsWith("/ready")) return "PROXY proxy.example:8080";
      pending_signal = signal;
      return await new Promise<string>((resolve) => {
        finish_pending = resolve;
      });
    });
    const result = runner.run(request, new AbortController().signal);
    child.emit("message", { type: "proxy_request", id: 1, url: "https://example.com/ready" });
    await vi.waitFor(() =>
      expect(child.send).toHaveBeenCalledWith(
        { type: "proxy_result", id: 1, result: { ok: true, rules: "PROXY proxy.example:8080" } },
        expect.any(Function),
      ),
    );
    child.emit("message", { type: "proxy_request", id: 2, url: "https://example.com/pending" });
    child.emit("message", { type: "proxy_cancel", id: 2 });
    expect(pending_signal?.aborted).toBe(true);
    finish_pending("DIRECT");
    await Promise.resolve();
    child.emit("message", complete);
    child.emit("close", 0);
    await result;
    expect(child.send).toHaveBeenCalledTimes(2);
  });

  it("脚本错误隐藏工作区绝对路径", async () => {
    const child = fake_process();
    fork.mockReturnValue(child);
    const result = build_runner().run(request, new AbortController().signal);
    child.emit("message", {
      type: "complete",
      response: { ok: false, message: `${workspace_path}/work/file failed\ntrace` },
    });
    child.emit("close", 0);
    await expect(result).rejects.toBeInstanceOf(AgentWorkspaceScriptError);
    await expect(result).rejects.toThrow("[workspace]/work/file failed");
  });

  it.each(["abort", "timeout"])("%s 先终止子进程，等 close 后结算", async (kind) => {
    vi.useFakeTimers();
    const child = fake_process();
    fork.mockReturnValue(child);
    const controller = new AbortController();
    const result = build_runner().run(request, controller.signal);
    let settled = false;
    void result.catch(() => {
      settled = true;
    });
    if (kind === "abort") controller.abort(new Error("stop"));
    else await vi.advanceTimersByTimeAsync(AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs);
    expect(child.kill).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", null);
    await expect(result).rejects.toThrow(kind === "abort" ? "stop" : "timed out");
  });

  it.each([
    ["非零退出", complete, 1],
    ["无结果", undefined, 0],
    ["坏结果", { type: "complete", response: {} }, 0],
    ["坏 Todo", { type: "complete", response: { ok: true, result: null, todos: [" "] } }, 0],
  ])("%s 返回执行错误", async (_label, message, code) => {
    const child = fake_process();
    fork.mockReturnValue(child);
    const result = build_runner().run(request, new AbortController().signal);
    if (message !== undefined) child.emit("message", message);
    child.emit("close", code);
    await expect(result).rejects.toThrow();
  });
});

/** 子进程 close 由用例触发，验证等待实际退出的契约。 */
function fake_process() {
  return Object.assign(new EventEmitter(), {
    connected: true,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => callback(null)),
    kill: vi.fn(() => true),
  });
}

/** 测试只替换宿主代理端口，启动路径由统一 fixture 提供。 */
function build_runner(
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
) {
  return new AgentWorkspaceRunner({
    runtimeEntryPath: runtime_entry_path,
    systemProxyResolver: { resolveProxy },
  });
}
