import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UV_INDEXES } from "./runtime";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

let root = "";
const call = vi.fn(async () => "mirror"); // 宿主返回的对话默认源

/** 每个用例重新加载模块，绑定独立的 uv 配置与宿主请求通道。 */
async function load_uv() {
  const { uv } = await import("./index");
  const { bind_uv } = await import("./runtime");
  const { bind_workspace_requests } = await import("../workspace/runtime/request-channel");
  bind_uv({ pythonRoot: root, uvExecutable: "application-uv" });
  bind_workspace_requests({ call });
  return uv;
}

beforeEach(() => {
  vi.resetModules();
  call.mockClear();
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
  const uv = await load_uv();
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
        UV_DEFAULT_INDEX: UV_INDEXES.mirror,
      }),
    }),
  );
  const env = spawn.mock.calls[0]![2].env;
  for (const key of ["UV_PYTHON", "PYTHONPATH", "PIP_INDEX_URL", "VIRTUAL_ENV"])
    expect(env[key]).toBeUndefined();
});

it("初始化清理中断残留，已有工程保留用户声明及缺失状态", async () => {
  const uv = await load_uv();
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

it("只给取包命令补默认索引，显式来源、本地操作与程序参数不触发查询", async () => {
  const uv = await load_uv();
  const index = async (args: string[]) => {
    spawn.mockClear();
    await uv.run(args);
    return spawn.mock.calls[0]![2].env.UV_DEFAULT_INDEX as string | undefined;
  };
  for (const args of [
    ["add", "numpy"],
    ["remove", "numpy"],
    ["lock"],
    ["pip", "install", "x"],
    ["tool", "run", "ruff", "--index", "program-arg"],
    ["run", "python", "-i", "x.py"],
    ["--directory", "project", "run", "-p", "3.14", "python"],
    ["run", "--with=numpy", "python", "--offline"],
    ["run", "--", "python", "--index", "x"],
  ])
    expect(await index(args), args.join(" ")).toBe(UV_INDEXES.mirror);
  call.mockClear();
  for (const args of [
    ["--version"],
    ["--version", "sync"],
    ["-V", "run"],
    ["python", "install"],
    ["pip", "list"],
    ["add", "x", "--default-index", "https://example/simple"],
    ["add", "x", "--index=https://example/simple"],
    ["sync", "--no-index"],
    ["run", "-ihttps://example/simple", "python"],
    ["sync", "--offline"],
    ["add", "--help"],
    ["run", "--no-sync", "python", "x.py"],
    ["run", "--with", "numpy", "--index", "https://example/simple", "python"],
    ["tool", "run", "--from", "ruff", "--offline", "ruff"],
    ["--directory", "project", "run", "--no-sync", "python"],
  ])
    expect(await index(args), args.join(" ")).toBeUndefined();
  expect(call).not.toHaveBeenCalled();
  call.mockResolvedValueOnce("official");
  expect(await index(["sync"])).toBe(UV_INDEXES.official);
  expect(call).toHaveBeenCalledWith({ kind: "resolve_package_source" });
});
