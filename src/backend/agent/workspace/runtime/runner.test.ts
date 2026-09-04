import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";
import deno_runtime_manifest from "../../../../../buildtools/builder/deno-runtime-manifest.json";

const process_mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), stat: vi.fn() }));

vi.mock("node:child_process", () => ({
  default: { execFile: process_mocks.execFile, spawn: process_mocks.spawn },
  execFile: process_mocks.execFile,
  spawn: process_mocks.spawn,
}));
vi.mock("../../../../native/native-fs", () => ({
  default_native_fs: { stat: process_mocks.stat },
}));

import { AgentWorkspaceScriptError, DenoAgentWorkspaceRunner } from "./runner";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

describe("DenoAgentWorkspaceRunner", () => {
  beforeEach(() => {
    process_mocks.execFile
      .mockReset()
      .mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(
            null,
            `deno ${deno_runtime_manifest.version} (stable, release, x86_64-pc-windows-msvc)\n`,
            "",
          );
        },
      );
    process_mocks.spawn.mockReset();
    process_mocks.stat.mockReset().mockReturnValue({ isFile: () => true });
  });

  it("用固定联网权限、确定代理环境与 start/complete 协议执行 runtime", async () => {
    const script = fake_process();
    process_mocks.spawn.mockReturnValueOnce(script.child);
    const runner = build_runner();

    await runner.initialize();
    expect(process_mocks.execFile).toHaveBeenCalledWith(
      "E:\\runtime\\deno.exe",
      ["--version"],
      expect.objectContaining({
        cwd: "E:\\runtime",
        maxBuffer: expect.any(Number),
        timeout: expect.any(Number),
        windowsHide: true,
      }),
      expect.any(Function),
    );

    const result = runner.run(
      {
        workspacePath: "E:/workspace",
        script: "return { changed: 2 };",
        todos: ["处理目标"],
      },
      new AbortController().signal,
    );
    await expect(read_line(script.stdin)).resolves.toEqual({
      type: "start",
      script: "return { changed: 2 };",
      todos: ["处理目标"],
    });
    script.stdout.write(
      `${JSON.stringify({
        type: "complete",
        response: { ok: true, result: { changed: 2 }, todos: ["核验结果"] },
      })}\n`,
    );
    script.close(0);

    await expect(result).resolves.toEqual({ result: { changed: 2 }, todos: ["核验结果"] });
    expect(process_mocks.spawn).toHaveBeenLastCalledWith(
      "E:\\runtime\\deno.exe",
      [
        "run",
        "--quiet",
        "--no-prompt",
        "--no-config",
        "--no-lock",
        "--no-npm",
        "--no-remote",
        "--deny-import",
        "--deny-env",
        "--deny-sys",
        "--deny-run",
        "--deny-ffi",
        "--allow-net",
        "--allow-read=E:\\workspace",
        "--allow-write=E:\\workspace\\changes,E:\\workspace\\task,E:\\workspace\\scratch",
        "E:\\runtime\\deno-runtime.js",
      ],
      expect.objectContaining({
        cwd: "E:\\workspace",
        env: expect.objectContaining({
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          ALL_PROXY: "",
          NO_PROXY: "",
        }),
        shell: false,
        windowsHide: true,
      }),
    );
  });

  it("把并发代理请求关联到 Electron 当前路线并支持单请求取消", async () => {
    const script = fake_process();
    const pending = new Map<string, AbortSignal>();
    const resolve_proxy = vi.fn(
      (url: string, signal?: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          if (signal === undefined) throw new Error("缺少代理取消信号");
          pending.set(url, signal);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (url.endsWith("/proxy")) resolve("PROXY proxy.example:8080");
        }),
    );
    process_mocks.spawn.mockReturnValueOnce(script.child);
    const result = build_runner(resolve_proxy).run(
      { workspacePath: "E:/workspace", script: "return null;", todos: [] },
      new AbortController().signal,
    );
    await read_line(script.stdin);

    script.stdout.write('{"type":"proxy_request","id":1,"url":"https://example.com/proxy"}\n');
    await expect(read_line(script.stdin)).resolves.toEqual({
      type: "proxy_result",
      id: 1,
      result: {
        ok: true,
        route: { kind: "proxy", uri: "http://proxy.example:8080/" },
      },
    });

    script.stdout.write('{"type":"proxy_request","id":2,"url":"https://example.com/cancel"}\n');
    await vi.waitFor(() => expect(pending.has("https://example.com/cancel")).toBe(true));
    script.stdout.write('{"type":"proxy_cancel","id":2}\n');
    await vi.waitFor(() => expect(pending.get("https://example.com/cancel")?.aborted).toBe(true));

    script.stdout.write('{"type":"complete","response":{"ok":true,"result":null,"todos":[]}}\n');
    script.close(0);
    await expect(result).resolves.toEqual({ result: null, todos: [] });
  });

  it("把 runtime 错误收窄为脚本错误并隐藏绝对路径", async () => {
    const child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(child.child);
    const result = build_runner().run(
      { workspacePath: "E:/workspace", script: "throw new Error();", todos: [] },
      new AbortController().signal,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "complete",
        response: {
          ok: false,
          message: "E:/workspace/changes/items/updates.jsonl failed\ntrace",
        },
      })}\n`,
    );
    child.close(0);

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: "Error",
        message: "[workspace]/changes/items/updates.jsonl failed",
      }),
    );
    await expect(result).rejects.toBeInstanceOf(AgentWorkspaceScriptError);
  });

  it("abort 和超时都先终止进程、等待 close 再结算", async () => {
    const aborted_child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(aborted_child.child);
    const controller = new AbortController();
    const reason = new Error("stop");
    const aborted = build_runner().run(
      { workspacePath: "E:/workspace", script: "await pending;", todos: [] },
      controller.signal,
    );
    let settled = false;
    void aborted.catch(() => {
      settled = true;
    });
    controller.abort(reason);
    expect(aborted_child.kill).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    aborted_child.close(null);
    await expect(aborted).rejects.toBe(reason);

    vi.useFakeTimers();
    const timeout_child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(timeout_child.child);
    const timed_out = build_runner().run(
      { workspacePath: "E:/workspace", script: "await pending;", todos: [] },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs);
    expect(timeout_child.kill).toHaveBeenCalledOnce();
    timeout_child.close(null);
    await expect(timed_out).rejects.toThrow("timed out");
    vi.useRealTimers();
  });

  it.each([
    ["非零退出", '{"type":"complete","response":{"ok":true,"result":null,"todos":[]}}\n', 1],
    ["空输出", "", 0],
    ["坏 JSON", "not-json\n", 0],
    ["坏 envelope", '{"type":"complete","response":{}}\n', 0],
    ["坏 Todo", '{"type":"complete","response":{"ok":true,"result":null,"todos":[" "]}}\n', 0],
  ])("%s 作为 runtime execution failure", async (_label, stdout, code) => {
    const child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(child.child);
    const result = build_runner().run(
      { workspacePath: "E:/workspace", script: "return null;", todos: [] },
      new AbortController().signal,
    );
    child.stdout.write(stdout);
    child.close(code);
    await expect(result).rejects.toThrow();
  });
});

function build_runner(
  resolve_proxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
): DenoAgentWorkspaceRunner {
  return new DenoAgentWorkspaceRunner({
    executablePath: "E:/runtime/deno.exe",
    runtimeEntryPath: "E:/runtime/deno-runtime.js",
    systemProxyResolver: { resolveProxy: resolve_proxy },
  });
}

function fake_process() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return {
    child,
    stdin: child.stdin,
    stdout: child.stdout,
    kill: child.kill,
    close: (code: number | null) => child.emit("close", code),
  };
}

async function read_line(stream: PassThrough): Promise<unknown> {
  const existing = stream.read() as Buffer | null;
  const chunk = existing ?? (await new Promise<Buffer>((resolve) => stream.once("data", resolve)));
  return JSON.parse(chunk.toString("utf8").trim()) as unknown;
}
