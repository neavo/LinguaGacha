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

it("环境准备与脚本共用唯一截止信号，超时回执保留日志与无输出秒数", async () => {
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
      get_agent_execution_lock_path: () => path.join(root.path, "node.lock"),
      get_user_data_path: (...parts) => path.join(root.path, "userdata", ...parts),
    },
    proxyResolver: { resolveProxy: async () => "DIRECT" },
  });
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
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
        expect(owner.launch).toHaveBeenCalledWith(expect.any(Object), signal);
        await writeFile(path.join(workspace, "deadline.out"), "before deadline");
        const silent_since = new Date(Date.now() - 120_000); // 两路日志最后一次写入在 120 秒前
        for (const log of ["deadline.out", "deadline.err"])
          await utimes(path.join(workspace, log), silent_since, silent_since);
        deadline.abort(new DOMException("test deadline", "TimeoutError"));
        signal.throwIfAborted();
      },
    );
    const error: unknown = await pending.catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: "Workspace execution timed out after 45 seconds. No output in the last 120 seconds.",
      execution: { stdout: { content: "before deadline" }, exitCode: null },
      cause: deadline.signal.reason,
    });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(45_000);
    const owner = await vi.mocked(Supervisor.acquire).mock.results[0]!.value;
    expect(owner.close).toHaveBeenCalledOnce();
  } finally {
    timeout.mockRestore();
    await execution.close();
  }
});
