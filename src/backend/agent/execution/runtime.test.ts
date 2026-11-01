import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AgentExecutionRuntime } from "./runtime";

const electron =
  process.env.LINGUAGACHA_TEST_ELECTRON ?? (createRequire(import.meta.url)("electron") as string);
let root = "";
let runtime = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lg-execution-中文 空格-"));
  runtime = path.join(root, "resources/workspace");
  if (process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME)
    await cp(process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME, runtime, { recursive: true });
  else
    execFileSync(
      process.execPath,
      [path.resolve("buildtools/resources/build.mjs"), path.dirname(runtime), "--development"],
      {
        windowsHide: true,
        stdio: "pipe",
      },
    );
}, 60_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** 每个场景拥有独立用户工程，多个实例可共享同一锁路径。 */
function create_runtime(
  name: string,
  resolveProxy: (url: string) => Promise<string> = async () => "DIRECT",
) {
  const shared = path.join(root, name, "node");
  const workspace = path.join(root, name, "workspace");
  return {
    shared,
    workspace,
    execution: new AgentExecutionRuntime({
      runtimeDirectory: runtime,
      executablePath: electron,
      electronVersion: "45.0.0",
      paths: {
        get_agent_node_root_dir: () => shared,
        get_agent_python_root_dir: () => path.join(root, "python"),
        get_agent_execution_lock_path: () => path.join(root, name, "node.lock"),
      },
      proxyResolver: { resolveProxy },
    }),
  };
}

/** 运行环境准备，动作在持有租约期间执行。 */
function prepare(
  fixture: ReturnType<typeof create_runtime>,
  action: () => Promise<void> = async () => {},
) {
  return fixture.execution.with_environment(
    {
      workspacePath: fixture.workspace,
      stdoutPath: "prepare.out",
      stderrPath: "prepare.err",
      timeoutMs: 60_000,
    },
    AbortSignal.timeout(20_000),
    action,
  );
}

it("环境准备与脚本共用唯一截止信号，超时回执保留日志", async () => {
  const fixture = create_runtime("deadline");
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  try {
    const pending = fixture.execution.with_environment(
      {
        workspacePath: fixture.workspace,
        stdoutPath: "deadline.out",
        stderrPath: "deadline.err",
        timeoutMs: 45_000,
      },
      new AbortController().signal,
      async (_owner, _env, signal) => {
        await writeFile(path.join(fixture.workspace, "deadline.out"), "before deadline");
        deadline.abort(new DOMException("test deadline", "TimeoutError"));
        signal.throwIfAborted();
      },
    );
    const error: unknown = await pending.catch((error: unknown) => error);
    expect(error).toMatchObject({
      message: "Workspace execution timed out after 45 seconds.",
      execution: { stdout: { content: "before deadline" }, exitCode: null },
      cause: deadline.signal.reason,
    });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(45_000);
  } finally {
    timeout.mockRestore();
    await fixture.execution.close();
  }
});

it("跨实例共享租约，持有期间拒绝其它执行，释放后可重新取得", async () => {
  const fixture = create_runtime("lease");
  const other = create_runtime("lease");
  try {
    await prepare(fixture, async () => {
      await expect(prepare(other)).rejects.toMatchObject({ code: "runtime.busy" });
    });
    await expect(prepare(other)).resolves.toBeUndefined();
  } finally {
    await fixture.execution.close();
    await other.execution.close();
  }
}, 30_000);
