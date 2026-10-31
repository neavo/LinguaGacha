import type { AgentNodeRuntime } from "../../node/runtime";
import type { Supervisor } from "../../../../native/supervisor";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { default_native_fs } from "../../../../native/native-fs";

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("node:child_process", () => ({ fork }));

import { AgentWorkspaceRunner, type AgentWorkspaceRunRequest } from "./runner";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

let directory = "";
let request: AgentWorkspaceRunRequest;
let handles: FileHandle[] = [];
let settle: Supervisor["settle"];
let attach: Supervisor["attach"];
let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fork.mockReset();
  settle = async () => ({ exitCode: 0, signal: null });
  attach = async () => {};
  stop = vi.fn();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "lg-runner-"));
  const workspacePath = path.join(directory, "workspace");
  const package_directory = path.join(directory, "node_modules/@lg/workspace");
  fs.mkdirSync(package_directory, { recursive: true });
  fs.writeFileSync(
    path.join(package_directory, "package.json"),
    JSON.stringify({
      name: "@lg/workspace",
      type: "module",
      exports: { "./bootstrap": "./bootstrap.mjs" },
    }),
  );
  fs.mkdirSync(path.join(workspacePath, "work/runs"), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, "changes"));
  fs.writeFileSync(path.join(package_directory, "bootstrap.mjs"), "");
  request = {
    workspacePath,
    scriptPath: "work/runs/test.mjs",
    stdoutPath: "work/runs/test.stdout.log",
    stderrPath: "work/runs/test.stderr.log",
  };
  handles = [];
  const open = default_native_fs.open_file.bind(default_native_fs);
  vi.spyOn(default_native_fs, "open_file").mockImplementation(async (file, flags) => {
    const handle = await open(file, flags);
    handles.push(handle);
    return handle;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("AgentWorkspaceRunner", () => {
  it("两路文件始终建立，正常退出后关闭句柄", async () => {
    const { child, result } = await start_run();
    expect(child.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start" }),
      expect.any(Function),
    );
    child.emit("close", 0);
    await expect(result).resolves.toMatchObject({
      exitCode: 0,
      stdout: { path: request.stdoutPath, bytes: 0, content: "" },
      stderr: { path: request.stderrPath, bytes: 0, content: "" },
    });
    expect(fs.readFileSync(output_path("stdout"), "utf8")).toBe("");
    expect(fs.readFileSync(output_path("stderr"), "utf8")).toBe("");
    expect(handles.map((handle) => handle.fd)).toEqual([-1, -1]);
  });

  it("并发代理请求传回宿主规则，取消后丢弃迟到响应", async () => {
    let pending_signal: AbortSignal | undefined;
    let finish_pending: (value: string) => void = () => undefined;
    const { child, result } = await start_run(async (url, signal) => {
      if (url.endsWith("/ready")) return "PROXY proxy.example:8080";
      pending_signal = signal;
      return await new Promise<string>((resolve) => {
        finish_pending = resolve;
      });
    });
    child.emit("message", {
      type: "request",
      id: 1,
      request: { kind: "resolve_proxy", url: "https://example.com/ready" },
    });
    await vi.waitFor(() =>
      expect(child.send).toHaveBeenCalledWith(
        { type: "response", id: 1, result: { ok: true, value: "PROXY proxy.example:8080" } },
        expect.any(Function),
      ),
    );
    child.emit("message", {
      type: "request",
      id: 2,
      request: { kind: "resolve_proxy", url: "https://example.com/pending" },
    });
    child.emit("message", { type: "cancel", id: 2 });
    expect(pending_signal?.aborted).toBe(true);
    finish_pending("DIRECT");
    child.emit("close", 0);
    await result;
    expect(child.send).toHaveBeenCalledTimes(2);
  });

  it("父进程拒绝专用工程导出请求，不调用打印宿主", async () => {
    const host = vi.fn(async () => ({ path: "work/result.pdf" }));
    request = { ...request, host };
    const { child, result } = await start_run();
    child.emit("message", {
      type: "request",
      id: 1,
      request: { kind: "export_pdf", file_path: "book.pdf", fp: "old-version" },
    });
    await vi.waitFor(() =>
      expect(child.send).toHaveBeenCalledWith(
        {
          type: "response",
          id: 1,
          result: { ok: false, message: expect.any(String) },
        },
        expect.any(Function),
      ),
    );
    expect(host).not.toHaveBeenCalled();
    child.emit("close", 0);
    await result;
  });

  it("程序退出后等待宿主回收，取消后不发送迟到结果", async () => {
    let host_signal: AbortSignal | undefined;
    let finish: () => void = () => undefined;
    request = {
      ...request,
      host: async (_request, signal) => {
        host_signal = signal;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { path: "work/result.pdf" };
      },
    };
    const { child, result } = await start_run();
    child.emit("message", {
      type: "request",
      id: 1,
      request: { kind: "print_pdf", html: "<p>test</p>" },
    });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    child.emit("close", 0);
    expect(host_signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await result;
    expect(child.send).toHaveBeenCalledTimes(1);
  });

  it("监管失败也等待在途宿主请求实际结算", async () => {
    const supervision = Promise.withResolvers<{ exitCode: number | null; signal: string | null }>();
    settle = () => supervision.promise;
    const operation = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    const { child, result } = await start_run(async () => {
      started.resolve();
      return await operation.promise;
    });
    child.emit("message", {
      type: "request",
      id: 1,
      request: { kind: "resolve_proxy", url: "https://example.com/pending" },
    });
    await started.promise;
    let settled = false;
    const failure = new Error("supervisor disappeared");
    const outcome = result.catch((error: unknown) => {
      settled = true;
      return error;
    });
    supervision.reject(failure);
    child.emit("close", 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    operation.resolve("DIRECT");
    expect(await outcome).toBe(failure);
    expect(handles.map((handle) => handle.fd)).toEqual([-1, -1]);
  });

  it("登记期间停止由监管器回收，保留停止原因且不直接结束待登记进程", async () => {
    const registered = Promise.withResolvers<void>();
    const settling = Promise.withResolvers<void>();
    attach = () => registered.promise;
    settle = async (signal) => {
      settling.resolve();
      signal.throwIfAborted();
      return { exitCode: 0, signal: null };
    };
    const controller = new AbortController();
    const stopped = new Error("stop while registering");
    const { child, result } = await start_run(undefined, controller.signal);
    const outcome = result.catch((error: unknown) => error);
    controller.abort(stopped);
    registered.resolve();
    await settling.promise;
    child.emit("close", null, "SIGKILL");
    expect(await outcome).toBe(stopped);
    expect(child.kill).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(child.send).not.toHaveBeenCalled();
    expect(handles.map((handle) => handle.fd)).toEqual([-1, -1]);
  });

  it("非零退出携带执行记录并关闭句柄", async () => {
    const { child, result } = await start_run();
    child.write_stdout("failed output");
    child.emit("close", 1);
    await expect(result).rejects.toMatchObject({
      execution: {
        exitCode: 1,
        stdout: { path: request.stdoutPath, content: "failed output" },
      },
    });
    expect(handles.map((handle) => handle.fd)).toEqual([-1, -1]);
  });

  it.each(["abort", "timeout"])("%s 等 close 后结算，保留输出并关闭句柄", async (kind) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { child, result } = await start_run(undefined, controller.signal);
    child.write_stdout("已完成部分");
    let settled = false;
    void result.catch(() => {
      settled = true;
    });
    if (kind === "abort") controller.abort(new Error("stop"));
    else await vi.advanceTimersByTimeAsync(AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs);
    expect(stop).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", null, "SIGKILL");
    await expect(result).rejects.toThrow(kind === "abort" ? "stop" : "timed out");
    expect(fs.readFileSync(output_path("stdout"), "utf8")).toBe("已完成部分");
    expect(handles.map((handle) => handle.fd)).toEqual([-1, -1]);
  });

  it("第二路文件打开失败时关闭第一路句柄", async () => {
    vi.mocked(default_native_fs.open_file)
      .mockImplementationOnce(async (file) => {
        const handle = await fs.promises.open(file, "w");
        handles.push(handle);
        return handle;
      })
      .mockRejectedValueOnce(new Error("output unavailable"));
    await expect(build_runner().run(request, new AbortController().signal)).rejects.toThrow(
      "output unavailable",
    );
    expect(fork).not.toHaveBeenCalled();
    expect(handles[0]?.fd).toBe(-1);
  });
});

/** 等文件句柄就绪后再模拟子进程行为，输出通过生产 stdio 中的真实描述符写入。 */
async function start_run(
  resolveProxy?: (url: string, signal?: AbortSignal) => Promise<string>,
  signal = new AbortController().signal,
) {
  let child!: ReturnType<typeof fake_process>;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  fork.mockImplementation((_file, _args, options) => {
    const stdout: unknown = options.stdio[1];
    const stderr: unknown = options.stdio[2];
    if (typeof stdout !== "number" || typeof stderr !== "number")
      throw new Error("Expected file descriptors");
    child = fake_process(stdout);
    started();
    return child;
  });
  const result = build_runner(resolveProxy).run(request, signal);
  await Promise.race([ready, result]);
  return { child, result };
}

/** close 由用例触发，用于观察进程退出前后的互斥和句柄生命周期。 */
function fake_process(stdout: number) {
  return Object.assign(new EventEmitter(), {
    connected: true,
    pid: 123,
    write_stdout: (text: string) => fs.writeSync(stdout, text),
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => callback(null)),
    kill: vi.fn(() => true),
  });
}

/** 日志路径由执行请求提供，测试不另行生成一套文件名。 */
function output_path(channel: "stdout" | "stderr") {
  return path.join(
    request.workspacePath,
    channel === "stdout" ? request.stdoutPath : request.stderrPath,
  );
}

/** 测试只替换宿主代理端口。 */
function build_runner(
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string> = async () => "DIRECT",
) {
  const owner = {
    attach: (...args: Parameters<Supervisor["attach"]>) => attach(...args),
    settle: (...args: Parameters<Supervisor["settle"]>) => settle(...args),
    stop,
  } as unknown as Supervisor;
  const with_environment: AgentNodeRuntime["with_environment"] = async (
    _request,
    signal,
    _mode,
    action,
  ) => {
    signal.throwIfAborted();
    return await action(owner, process.env, signal);
  };
  return new AgentWorkspaceRunner({
    node: {
      root: directory,
      directory,
      executable: process.execPath,
      with_environment,
    } as AgentNodeRuntime,
    paths: {
      get_agent_user_skill_dir: () => path.join(directory, "user-skills"),
      get_agent_builtin_skill_dir: () => path.join(directory, "builtin-skills"),
    },
    proxyResolver: { resolveProxy },
  });
}
