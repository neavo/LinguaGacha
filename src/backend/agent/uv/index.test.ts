import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

let root = "";

beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-uv-"));
  spawn.mockReset().mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("固定工程并隔离宿主 Python 配置，保留应用代理", async () => {
  const { uv } = await import("./index");
  const { bind_uv } = await import("./runtime");
  bind_uv({ pythonRoot: root, uvExecutable: "application-uv" });
  for (const [key, value] of Object.entries({
    UV_PYTHON: "host-python",
    PYTHONPATH: "host-modules",
    PIP_INDEX_URL: "host-index",
    VIRTUAL_ENV: "host-venv",
    HTTPS_PROXY: "http://app-proxy",
  }))
    vi.stubEnv(key, value);
  await uv.run(["run", "python", "work/a.py"]);
  expect(uv.directory).toBe(path.join(root, "project"));
  expect(spawn).toHaveBeenCalledWith(
    "application-uv",
    ["--no-config", "run", "python", "work/a.py"],
    expect.objectContaining({
      cwd: process.cwd(),
      shell: false,
      env: expect.objectContaining({
        UV_PROJECT: path.join(root, "project"),
        UV_PYTHON_INSTALL_DIR: path.join(root, "interpreters"),
        UV_MANAGED_PYTHON: "1",
        HTTPS_PROXY: "http://app-proxy",
      }),
    }),
  );
  const env = spawn.mock.calls[0]![2].env;
  for (const key of ["UV_PYTHON", "PYTHONPATH", "PIP_INDEX_URL", "VIRTUAL_ENV"])
    expect(env[key]).toBeUndefined();
});

it("初始化清理中断残留，已有工程保留用户声明及缺失状态", async () => {
  const { uv } = await import("./index");
  const { bind_uv } = await import("./runtime");
  bind_uv({ pythonRoot: root, uvExecutable: "application-uv" });
  fs.mkdirSync(`${uv.directory}.prepare`);
  fs.writeFileSync(path.join(`${uv.directory}.prepare`, "partial"), "interrupted");
  await uv.run(["sync"]);
  const declaration = path.join(uv.directory, "pyproject.toml");
  expect(fs.existsSync(declaration)).toBe(true);
  expect(fs.existsSync(path.join(uv.directory, "partial"))).toBe(false);
  fs.writeFileSync(declaration, "user edited");
  await uv.run(["sync"]);
  expect(fs.readFileSync(declaration, "utf8")).toBe("user edited");
  fs.rmSync(declaration);
  await uv.run(["--version"]); // 查询仍可执行，声明由调用者修复。
  expect(fs.existsSync(declaration)).toBe(false);
});
