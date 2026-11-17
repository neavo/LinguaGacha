import { afterAll, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const python_root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-inference-python-"));
const fake = vi.hoisted(() => ({ uv: vi.fn() }));
vi.mock("../uv", () => ({ uv: { directory: python_root, run: fake.uv } }));
afterAll(() => fs.rmSync(python_root, { recursive: true, force: true }));

it("Python 环境缺失时明确失败，补齐解释器后可定位且不隐式同步", async () => {
  const { python } = await import("./environment");
  expect(() => python()).toThrow("run uv sync --inexact through @lg/uv first");
  expect(fake.uv).not.toHaveBeenCalled();
  const executable = path.join(
    python_root,
    ".venv",
    ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "");
  expect(python()).toBe(executable);
});
