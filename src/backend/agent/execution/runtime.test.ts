import { mkdir, utimes, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { Supervisor } from "../../../native/supervisor";
import { AgentExecutionRuntime } from "./runtime";

vi.mock("../../../native/supervisor", () => ({
  Supervisor: {
    acquire: vi.fn(async () => ({
      launch: vi.fn(async () => ({ exitCode: 0, signal: null })),
      close: vi.fn(async () => {}),
    })),
  },
}));

it("独立脚本共享一次环境准备，取消一条执行不影响另一条", async () => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-execution-deadline-"));
  await mkdir(path.join(root.path, "runtime"));
  await writeFile(path.join(root.path, "runtime/prepare.mjs"), "");
  const aria2 = path.join(root.path, "bin", `${process.platform}-${process.arch}`, "aria2");
  await mkdir(aria2, { recursive: true });
  await writeFile(
    path.join(aria2, process.platform === "win32" ? "aria2c.exe" : "aria2c"),
    "fixture",
  );
  const workspace = path.join(root.path, "workspace");
  const execution = new AgentExecutionRuntime({
    runtimeDirectory: root.path,
    fontsDirectory: path.join(root.path, "fonts"),
    executablePath: process.execPath,
    electronVersion: "45.0.0",
    paths: {
      get_agent_node_root_dir: () => path.join(root.path, "node"),
      get_agent_models_dir: () => path.join(root.path, "models"),
      get_agent_media_cache_dir: () => path.join(root.path, "cache/media"),
      get_agent_python_root_dir: () => path.join(root.path, "python"),
      get_agent_preparation_lock_path: () => path.join(root.path, "node.lock"),
      get_user_data_path: (...parts) => path.join(root.path, "userdata", ...parts),
    },
    proxyResolver: { resolveProxy: async () => "DIRECT" },
  });
  vi.mocked(Supervisor.acquire).mockClear();
  const deadline = new AbortController();
  const other_deadline = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(deadline.signal)
    .mockReturnValueOnce(other_deadline.signal);
  const first_started = Promise.withResolvers<void>();
  const other_completed = Promise.withResolvers<void>();
  try {
    const pending = execution.with_environment(
      {
        workspacePath: workspace,
        stdoutPath: "deadline.out",
        stderrPath: "deadline.err",
        timeoutMs: 45_000,
      },
      new AbortController().signal,
      async (owner, _env, signal) => {
        expect(owner.launch).not.toHaveBeenCalled();
        await writeFile(path.join(workspace, "deadline.out"), "before deadline");
        const silent_since = new Date(Date.now() - 120_000); // 两路日志最后一次写入在 120 秒前
        for (const log of ["deadline.out", "deadline.err"])
          await utimes(path.join(workspace, log), silent_since, silent_since);
        first_started.resolve();
        await other_completed.promise;
        deadline.abort(new DOMException("test deadline", "TimeoutError"));
        signal.throwIfAborted();
      },
    );
    const result = pending.catch((error: unknown) => error);
    await Promise.race([
      first_started.promise,
      result.then((error) => {
        throw error;
      }),
    ]);
    const second = await execution.with_environment(
      {
        workspacePath: workspace,
        stdoutPath: "other.out",
        stderrPath: "other.err",
        timeoutMs: 45_000,
      },
      new AbortController().signal,
      async () => "finished",
    );
    expect(second).toBe("finished");
    other_completed.resolve();
    const error = await result;
    expect(error).toMatchObject({
      message: "Workspace execution timed out after 45 seconds. No output in the last 120 seconds.",
      execution: { stdout: { content: "before deadline" }, exitCode: null },
      cause: deadline.signal.reason,
    });
    expect(timeout).toHaveBeenCalledTimes(2);
    const acquired = vi.mocked(Supervisor.acquire);
    expect(acquired.mock.calls.map(([, lock]) => lock)).toEqual([
      path.join(root.path, "node.lock"),
      undefined,
      undefined,
    ]);
    const owners = await Promise.all(acquired.mock.results.map(({ value }) => value));
    expect(owners[0]!.launch).toHaveBeenCalledOnce();
    expect(owners.every((owner) => vi.mocked(owner.close).mock.calls.length === 1)).toBe(true);
  } finally {
    other_completed.resolve();
    timeout.mockRestore();
    await execution.close();
  }
});
