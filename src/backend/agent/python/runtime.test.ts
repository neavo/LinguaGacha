import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

beforeEach(() => {
  vi.resetModules();
  spawn.mockReset();
});

it("未绑定进程明确失败，绑定冻结配置且命令保留代理并隔离宿主 Python 配置", async () => {
  const { bind_python, uv } = await import("./runtime");
  await expect(uv(["python", "list"], "list")).rejects.toThrow("not bound");
  const config = { pythonRoot: process.cwd(), uvExecutable: "application-uv" };
  bind_python(config);
  config.uvExecutable = "changed";
  vi.stubEnv("UV_PYTHON", "host-python");
  vi.stubEnv("PYTHONPATH", "host-modules");
  vi.stubEnv("PIP_INDEX_URL", "host-index");
  vi.stubEnv("VIRTUAL_ENV", "host-venv");
  vi.stubEnv("HTTPS_PROXY", "http://app-proxy");
  let child!: EventEmitter;
  spawn.mockImplementation(() => {
    child = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
    return child;
  });
  const result = uv(["python", "list"], "list", true);
  expect(spawn).toHaveBeenCalledWith(
    "application-uv",
    ["--no-config", "python", "list"],
    expect.objectContaining({
      shell: false,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
      env: expect.objectContaining({
        HTTPS_PROXY: "http://app-proxy",
        UV_MANAGED_PYTHON: "1",
        UV_PYTHON_DOWNLOADS: "never",
      }),
    }),
  );
  const env = spawn.mock.calls[0]![2].env;
  for (const key of ["UV_PYTHON", "PYTHONPATH", "PIP_INDEX_URL", "VIRTUAL_ENV"])
    expect(env[key]).toBeUndefined();
  expect(process.env.UV_PYTHON).toBe("host-python");
  child.emit("close", 1, null);
  await expect(result).rejects.toThrow("exitCode=1");
});

it("启动失败等 close 才结算，错误保留 cause", async () => {
  const { bind_python, uv } = await import("./runtime");
  bind_python({ pythonRoot: process.cwd(), uvExecutable: "missing" });
  const child = new EventEmitter();
  spawn.mockReturnValue(child);
  let settled = false;
  const result = uv([], "launch").catch((error: unknown) => {
    settled = true;
    return error;
  });
  const cause = new Error("ENOENT");
  child.emit("error", cause);
  await Promise.resolve();
  expect(settled).toBe(false);
  child.emit("close", -1, null);
  expect(await result).toMatchObject({ cause });
});
