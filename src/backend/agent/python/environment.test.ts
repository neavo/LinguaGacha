import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PythonApi } from "./index";

const calls = vi.hoisted(() => ({ uv: vi.fn(), python_process: vi.fn() }));

let root: string;
let directory: string;
let venv: string;
let selected: string;
let python: PythonApi;
let fail = "";
let prefix = "";

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("./runtime", async (original) => ({
    ...(await original<typeof import("./runtime")>()),
    ...calls,
  }));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-python-"));
  directory = path.join(root, "environments/3.13");
  venv = path.join(directory, ".venv");
  selected = path.join(root, "interpreters/cpython-3.13.8/python.exe");
  fail = "";
  prefix = "";
  calls.uv.mockReset().mockImplementation(async (args: string[]) => {
    if (args[0] === "python" && args[1] === "install") {
      fs.mkdirSync(path.dirname(selected), { recursive: true });
      fs.writeFileSync(selected, "interpreter");
      return "";
    }
    if (args[0] === "python" && args[1] === "find") return selected;
    if (args[0] === "python" && args[1] === "list")
      return JSON.stringify([
        { version: "3.13.8", path: selected },
        { version: "3.14.0", path: null },
        { version: "3.13.1", path: process.execPath },
      ]);
    if (args[0] === "venv") {
      fs.rmSync(venv, { recursive: true, force: true });
      fs.mkdirSync(path.join(venv, process.platform === "win32" ? "Scripts" : "bin"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(venv, "pyvenv.cfg"), "home = managed");
      prefix = "";
      return "";
    }
    // 包写入前必须已验证独立 venv，半成品不能通过模拟器掩盖。
    if (["sync", "add", "remove"].includes(args[0]!)) {
      expect(fs.existsSync(path.join(venv, "pyvenv.cfg"))).toBe(true);
      expect(prefix).toBe("");
    }
    if (args[0] === "sync" && !fs.existsSync(path.join(directory, "uv.lock")))
      fs.writeFileSync(path.join(directory, "uv.lock"), "locked");
    if (args[0] === "add" || args[0] === "remove") {
      const declaration = path.join(directory, "pyproject.toml");
      const previous = fs.readFileSync(declaration, "utf8");
      // 在读取与写入之间让出调度，只有完整操作串行才能保留两次声明。
      await new Promise((resolve) => setImmediate(resolve));
      const names = args.slice(args.indexOf("--") + 1);
      fs.writeFileSync(declaration, previous + `\n# ${args[0]} ${names.join(",")}\n`);
    }
    if (args[0] === fail) throw new Error(`fixture ${fail} failed`);
    return "";
  });
  calls.python_process.mockReset().mockImplementation(async () =>
    JSON.stringify({
      version: "3.13.8",
      prefix: prefix || venv,
      basePrefix: path.dirname(selected),
      baseExecutable: selected,
    }),
  );
  const runtime = await import("./runtime");
  runtime.bind_python({ pythonRoot: root, uvExecutable: path.join(root, "uv") });
  python = (await import("./index")).python;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

it("并行安装保留两次声明，排队时复制参数，失败后可恢复并继续", async () => {
  const env = python.environment();
  await env.ensure();
  const args = ["alpha"];
  const first = env.install(args);
  args[0] = "changed";
  await Promise.all([first, env.install(["beta"])]);
  expect(fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8")).toContain(
    "# add alpha\n\n# add beta",
  );
  fail = "add";
  await expect(env.install(["broken"])).rejects.toThrow("fixture add failed");
  expect(fs.existsSync(path.join(directory, ".incomplete"))).toBe(true);
  await expect(env.info()).rejects.toThrow("incomplete");
  fail = "";
  await env.remove(["broken"]);
  expect(fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8")).toContain("# add broken");
  expect(fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8")).toContain(
    "# remove broken",
  );
  expect(fs.existsSync(path.join(directory, ".incomplete"))).toBe(false);
  await expect(env.info()).resolves.toMatchObject({ version: "3.13.8", directory });
});

it.each(["missing-config", "base-prefix", "incomplete"])(
  "%s 统一重建安装树，保留声明和锁",
  async (kind) => {
    await python.environment().ensure();
    fs.appendFileSync(path.join(directory, "pyproject.toml"), "# user intent\n");
    fs.writeFileSync(path.join(venv, "partial-wheel"), "broken");
    if (kind === "missing-config") fs.unlinkSync(path.join(venv, "pyvenv.cfg"));
    if (kind === "base-prefix") prefix = path.dirname(selected);
    if (kind === "incomplete") fs.writeFileSync(path.join(directory, ".incomplete"), "");
    fs.writeFileSync(path.join(directory, "uv.lock"), "existing resolution");
    await python.environment().ensure();
    expect(fs.existsSync(path.join(venv, "partial-wheel"))).toBe(false);
    expect(fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8")).toContain(
      "# user intent",
    );
    expect(fs.readFileSync(path.join(directory, "uv.lock"), "utf8")).toBe("existing resolution");
    expect(fs.existsSync(path.join(directory, ".incomplete"))).toBe(false);
  },
);

it("恢复失败保留声明和标记，脚本非零退出不标记环境损坏", async () => {
  const env = python.environment();
  await env.ensure();
  const declaration = fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8");
  fs.writeFileSync(path.join(directory, ".incomplete"), "");
  fail = "sync";
  await expect(env.run(["-c", "print(1)"])).rejects.toThrow("fixture sync failed");
  expect(fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8")).toBe(declaration);
  expect(fs.existsSync(path.join(directory, ".incomplete"))).toBe(true);
  expect(calls.uv.mock.calls.some(([args]) => args[0] === "run")).toBe(false);
  fail = "run";
  await expect(env.run(["-c", "raise Exception()"])).rejects.toThrow("fixture run failed");
  expect(fs.existsSync(path.join(directory, ".incomplete"))).toBe(false);
});

it("已有项目缺失声明时报错，越界目录链接不被清理", async () => {
  const env = python.environment();
  await env.ensure();
  fs.unlinkSync(path.join(directory, "pyproject.toml"));
  await expect(python.environment().ensure()).rejects.toThrow("declaration is missing");
  fs.writeFileSync(path.join(directory, "pyproject.toml"), "keep");
  fs.rmSync(venv, { recursive: true });
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "user.txt"), "keep");
  fs.symlinkSync(outside, venv, process.platform === "win32" ? "junction" : "dir");
  await expect(env.install(["alpha"])).rejects.toThrow("must not be a link");
  expect(fs.readFileSync(path.join(outside, "user.txt"), "utf8")).toBe("keep");
});

it("版本和包参数收窄，list 过滤外部解释器且不初始化环境", async () => {
  for (const version of ["", "--help", "3.13.8", "../3.13", "3.13\0"])
    expect(() => python.environment({ version })).toThrow("minor version");
  const env = python.environment();
  await env.ensure();
  expect(() => env.install([])).toThrow("nonempty");
  expect(() => env.remove(["\0"])).toThrow("NUL");
  calls.uv.mockClear();
  await expect(python.list()).resolves.toEqual([{ version: "3.13.8", executable: selected }]);
  expect(calls.uv).toHaveBeenCalledOnce();
});

it("未完成声明不可解析时，仍可显式移除坏依赖", async () => {
  const env = python.environment();
  await env.ensure();
  fs.writeFileSync(path.join(directory, ".incomplete"), "");
  fail = "sync";
  const previous = calls.uv.getMockImplementation()!;
  calls.uv.mockImplementation(async (args: string[]) => {
    if (args[0] === "remove") fail = "";
    return previous(args);
  });
  calls.uv.mockClear();
  const repair = python.environment();
  expect(calls.uv).not.toHaveBeenCalled();
  await repair.remove(["broken"]);
  expect(fs.readFileSync(path.join(directory, "pyproject.toml"), "utf8")).toContain(
    "# remove broken",
  );
  expect(fs.existsSync(path.join(directory, ".incomplete"))).toBe(false);
});

it("已经是最新补丁时升级保留健康安装树", async () => {
  await python.environment().ensure();
  const installed = path.join(venv, "installed-package-data");
  fs.writeFileSync(installed, "installed");
  await python.environment().upgrade();
  expect(fs.readFileSync(installed, "utf8")).toBe("installed");
});
