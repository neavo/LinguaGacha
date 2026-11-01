import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepare_node_environment } from "./prepare";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));

let directory: string;
let runtime: string;
let root: string;
const manifest = '{"name":"fixture","private":true}';

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("process", { ...process, platform: "win32" });
  directory = await mkdtemp(path.join(os.tmpdir(), "lg-node-prepare-"));
  runtime = path.join(directory, "runtime");
  root = path.join(directory, "userdata/node");
  await mkdir(path.join(runtime, "seed/node_modules/fixture"), { recursive: true });
  await writeFile(path.join(runtime, "seed/package.json"), manifest);
  await writeFile(path.join(runtime, "seed/node_modules/fixture/index.js"), "export default 42;");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

it.each(["EPERM", "EBUSY"])("Windows 的 %s 短暂占用解除后完成首次初始化", async (code) => {
  vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error("busy"), { code }));
  await prepare_node_environment(runtime, root);
  expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(manifest);
  expect(await readFile(path.join(root, "node_modules/fixture/index.js"), "utf8")).toBe(
    "export default 42;",
  );
  expect(await readFile(path.join(root, "npmrc"), "utf8")).toContain("${LG_NODE_ROOT}/cache");
  await expect(readFile(path.join(`${root}.prepare`, "package.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("持续占用有界失败并保留原始错误，下次准备回收暂存材料后恢复", async () => {
  const error = Object.assign(new Error("still busy"), { code: "EPERM" });
  vi.mocked(rename).mockRejectedValue(error);
  await expect(prepare_node_environment(runtime, root)).rejects.toBe(error);
  await expect(readFile(path.join(root, "package.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(path.join(`${root}.prepare`, "package.json"), "utf8")).toBe(manifest);
  const waits = vi.mocked(setTimeout).mock.calls;
  expect(waits.length).toBeGreaterThan(0);
  expect(waits.reduce((total, [delay]) => total + (delay ?? 0), 0)).toBeLessThanOrEqual(5_000);

  await writeFile(path.join(`${root}.prepare`, "partial"), "previous attempt");
  vi.mocked(rename).mockReset();
  await prepare_node_environment(runtime, root);
  expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(manifest);
  await expect(readFile(path.join(root, "partial"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  ["win32", "EIO"],
  ["linux", "EPERM"],
  ["darwin", "EBUSY"],
])("%s 的 %s 直接交回调用者", async (platform, code) => {
  vi.stubGlobal("process", { ...process, platform });
  const error = Object.assign(new Error("rename failed"), { code });
  vi.mocked(rename).mockRejectedValueOnce(error);
  await expect(prepare_node_environment(runtime, root)).rejects.toBe(error);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(setTimeout).not.toHaveBeenCalled();
});
