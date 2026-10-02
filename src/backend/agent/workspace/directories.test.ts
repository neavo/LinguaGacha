import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeFs } from "../../../native/native-fs";
import { AgentWorkspaceDirectories, AGENT_WORKSPACE_LIMIT } from "./directories";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("按时间清理会话，失败下次重试并保留链接目标与其它目录", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lg-workspaces-"));
  roots.push(directory);
  const root = path.join(directory, "workspace");
  const native = new NativeFs();
  const report = vi.fn();
  const directories = new AgentWorkspaceDirectories(root, native, report);
  const ids: string[] = [];
  for (let i = 0; i < AGENT_WORKSPACE_LIMIT + 2; i++) {
    const id = await directories.create();
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/u);
    ids.push(id);
    fs.utimesSync(directories.path(id), 1_600_000_000 + i, 1_600_000_000 + i);
  }
  const unrelated = path.join(root, "unrelated");
  fs.mkdirSync(unrelated);
  fs.utimesSync(unrelated, 1, 1);
  const shared = path.join(directory, "runtime");
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(shared, "keep"), "keep");
  native.create_directory_link(shared, path.join(directories.path(ids[1]!), "node_modules"));
  fs.utimesSync(directories.path(ids[1]!), 1_600_000_001, 1_600_000_001);
  const remove = native.remove_async.bind(native);
  vi.spyOn(native, "remove_async").mockImplementationOnce(async () => {
    throw new Error("busy");
  });
  await directories.prune(ids[0]!);
  expect(report).toHaveBeenCalledOnce();
  expect(fs.existsSync(directories.path(ids[0]!))).toBe(true);
  vi.mocked(native.remove_async).mockImplementation(remove);
  await directories.prune(ids[0]!);
  expect(fs.readdirSync(root)).toHaveLength(AGENT_WORKSPACE_LIMIT + 1);
  expect(fs.existsSync(unrelated)).toBe(true);
  expect(fs.existsSync(directories.path(ids[1]!))).toBe(false);
  expect(fs.readFileSync(path.join(shared, "keep"), "utf8")).toBe("keep");
  await directories.touch(ids[0]!);
  expect(native.stat(directories.path(ids[0]!)).mtimeMs).toBeGreaterThan(1_600_000_100_000);
});

it("原子创建撞名后重试并保留已有目录内容", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-workspace-collision-"));
  roots.push(root);
  const report = vi.fn();
  const directories = new AgentWorkspaceDirectories(root, new NativeFs(), report);
  fs.mkdirSync(directories.path("00000000"));
  fs.writeFileSync(path.join(directories.path("00000000"), "keep"), "existing");
  let attempt = 0;
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((bytes: Uint8Array) => {
    bytes.fill(attempt++ === 0 ? 0 : 36);
    return bytes;
  }) as typeof crypto.getRandomValues);

  expect(await directories.create()).toBe("aaaaaaaa");
  expect(fs.readFileSync(path.join(directories.path("00000000"), "keep"), "utf8")).toBe("existing");
  expect(report).not.toHaveBeenCalled();
});

it("路径入口拒绝目录穿越与非法会话身份", () => {
  const directories = new AgentWorkspaceDirectories(os.tmpdir(), new NativeFs(), vi.fn());
  for (const id of ["../other", "abCD12_3", "abcD1234\n"]) {
    expect(() => directories.path(id)).toThrowError(
      expect.objectContaining({ code: "request.validation_failed" }),
    );
  }
});
