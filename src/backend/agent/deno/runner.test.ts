import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import deno_runtime_manifest from "../../../../buildtools/builder/deno-runtime-manifest.json";

const process_mocks = vi.hoisted(() => ({ spawn: vi.fn(), stat: vi.fn() }));

vi.mock("node:child_process", () => ({
  default: { spawn: process_mocks.spawn },
  spawn: process_mocks.spawn,
}));
vi.mock("../../../native/native-fs", () => ({ default_native_fs: { stat: process_mocks.stat } }));

import { AgentWorkspaceScriptError, DenoAgentWorkspaceRunner } from "./runner";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

describe("DenoAgentWorkspaceRunner", () => {
  beforeEach(() => {
    process_mocks.spawn.mockReset();
    process_mocks.stat.mockReset().mockReturnValue({ isFile: () => true });
  });
  afterEach(() => vi.useRealTimers());

  it("用固定权限参数、cwd 与唯一 stdin 请求执行 runtime", async () => {
    const version = fake_process();
    const script = fake_process();
    process_mocks.spawn.mockReturnValueOnce(version.child).mockReturnValueOnce(script.child);
    const runner = build_runner();

    const initialized = runner.initialize();
    expect(process_mocks.spawn).toHaveBeenCalledOnce();
    version.stdout.end(
      `deno ${deno_runtime_manifest.version} (stable, release, x86_64-pc-windows-msvc)\n`,
    );
    version.close(0);
    await initialized;

    const result = runner.run(
      {
        workspacePath: "E:/workspace",
        script: "return { changed: 2 };",
        todos: ["处理目标"],
      },
      new AbortController().signal,
    );
    const stdin = read_stream(script.stdin);
    script.stdout.end(JSON.stringify({ ok: true, result: { changed: 2 }, todos: ["核验结果"] }));
    script.close(0);

    await expect(result).resolves.toEqual({ result: { changed: 2 }, todos: ["核验结果"] });
    expect(JSON.parse(await stdin)).toEqual({
      script: "return { changed: 2 };",
      todos: ["处理目标"],
    });
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
        "--deny-net",
        "--deny-env",
        "--deny-sys",
        "--deny-run",
        "--deny-ffi",
        "--allow-read=E:\\workspace",
        "--allow-write=E:\\workspace\\changes,E:\\workspace\\task,E:\\workspace\\scratch",
        "E:\\runtime\\deno-runtime.js",
      ],
      expect.objectContaining({ cwd: "E:\\workspace", shell: false, windowsHide: true }),
    );
  });

  it("把 runtime 错误 envelope 收窄为脚本错误并隐藏绝对路径", async () => {
    const child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(child.child);
    const result = build_runner().run(
      { workspacePath: "E:/workspace", script: "throw new Error();", todos: [] },
      new AbortController().signal,
    );
    child.stdout.end(
      JSON.stringify({
        ok: false,
        message: "E:/workspace/changes/items/updates.jsonl failed\ntrace",
      }),
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

  it("abort 先终止进程、等待 close，再以原始原因结算", async () => {
    const child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(child.child);
    const controller = new AbortController();
    const reason = new Error("stop");
    const result = build_runner().run(
      {
        workspacePath: "E:/workspace",
        script: "await new Promise(() => {});",
        todos: [],
      },
      controller.signal,
    );
    let settled = false;
    void result.catch(() => {
      settled = true;
    });

    controller.abort(reason);
    expect(child.kill).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.close(null);
    await expect(result).rejects.toBe(reason);
  });

  it("超时和超大 stdout 都终止进程并等待 close", async () => {
    vi.useFakeTimers();
    const timeout_child = fake_process();
    const large_child = fake_process();
    process_mocks.spawn
      .mockReturnValueOnce(timeout_child.child)
      .mockReturnValueOnce(large_child.child);

    const timed_out = build_runner().run(
      {
        workspacePath: "E:/workspace",
        script: "await new Promise(() => {});",
        todos: [],
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs);
    expect(timeout_child.kill).toHaveBeenCalledOnce();
    timeout_child.close(null);
    await expect(timed_out).rejects.toThrow("timed out");

    const too_large = build_runner().run(
      { workspacePath: "E:/workspace", script: "return null;", todos: [] },
      new AbortController().signal,
    );
    large_child.stdout.write(Buffer.alloc(AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes * 3));
    expect(large_child.kill).toHaveBeenCalledOnce();
    large_child.close(null);
    await expect(too_large).rejects.toThrow("too large");
  });

  it.each([
    ["非零退出", { stdout: "", code: 1 }],
    ["空输出", { stdout: "", code: 0 }],
    ["坏 JSON", { stdout: "not-json", code: 0 }],
    ["坏 envelope", { stdout: "{}", code: 0 }],
    ["坏 Todo", { stdout: '{"ok":true,"result":null,"todos":[" "]}', code: 0 }],
  ])("%s 作为 runtime execution failure", async (_label, outcome) => {
    const child = fake_process();
    process_mocks.spawn.mockReturnValueOnce(child.child);
    const result = build_runner().run(
      { workspacePath: "E:/workspace", script: "return null;", todos: [] },
      new AbortController().signal,
    );
    child.stdout.end(outcome.stdout);
    child.close(outcome.code);
    await expect(result).rejects.toThrow();
  });
});

function build_runner(): DenoAgentWorkspaceRunner {
  return new DenoAgentWorkspaceRunner({
    executablePath: "E:/runtime/deno.exe",
    runtimeEntryPath: "E:/runtime/deno-runtime.js",
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

async function read_stream(stream: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
