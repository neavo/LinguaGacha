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
    const id = i === 1 ? "-t75szF5" : await directories.create();
    if (i === 1) fs.mkdirSync(directories.path(id));
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
  await directories.prune(new Set([ids[0]!]));
  expect(report).toHaveBeenCalledOnce();
  expect(fs.existsSync(directories.path(ids[0]!))).toBe(true);
  vi.mocked(native.remove_async).mockImplementation(remove);
  await directories.prune(new Set([ids[0]!]));
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
    bytes.fill(attempt++ === 0 ? 0 : 10);
    return bytes;
  }) as typeof crypto.getRandomValues);

  expect(await directories.create()).toBe("aaaaaaaa");
  expect(fs.readFileSync(path.join(directories.path("00000000"), "keep"), "utf8")).toBe("existing");
  expect(report).not.toHaveBeenCalled();
});

it("路径入口接受既有身份并拒绝越界目录名", () => {
  const directories = new AgentWorkspaceDirectories(os.tmpdir(), new NativeFs(), vi.fn());
  for (const id of ["-t75szF5", "abCD12_3", "chat-long-name"]) {
    expect(directories.path(id)).toBe(path.join(os.tmpdir(), id));
  }
  for (const id of [
    "",
    ".",
    "..",
    "../other",
    "..\\other",
    "/other",
    "C:other",
    "abc\0def",
    ".. ",
  ]) {
    expect(() => directories.path(id)).toThrowError(
      expect.objectContaining({ code: "request.validation_failed" }),
    );
  }
});

it("同路径和工程移走时复用材料身份并更新认领标记", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-workspace-claim-"));
  roots.push(root);
  const directories = new AgentWorkspaceDirectories(
    path.join(root, "workspace"),
    new NativeFs(),
    vi.fn(),
  );
  const original = path.join(root, "original.lg");
  const moved = path.join(root, "moved.lg");
  fs.writeFileSync(original, "");
  const id = await directories.create();
  expect(await directories.claim(id, original, false)).toBe(id);
  expect(await directories.claim(id, original, false)).toBe(id);
  fs.renameSync(original, moved);
  expect(await directories.claim(id, moved, false)).toBe(id);
  expect(fs.readFileSync(path.join(directories.path(id), ".project-path"), "utf8")).toBe(moved);
});

it.each([false, true])("现存所有者或在用身份触发副本，inUse=%s", async (in_use) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-workspace-copy-"));
  roots.push(root);
  const native = new NativeFs();
  const directories = new AgentWorkspaceDirectories(path.join(root, "workspace"), native, vi.fn());
  const id = await directories.create();
  const source = directories.path(id);
  const original = path.join(root, "original.lg");
  const duplicate = path.join(root, "duplicate.lg");
  if (!in_use) {
    fs.writeFileSync(original, "");
    await directories.claim(id, original, false);
  }
  for (const name of ["work", "uploads", "sources", "run", "changes"]) {
    fs.mkdirSync(path.join(source, name));
    fs.writeFileSync(path.join(source, name, "entry"), name);
  }
  fs.writeFileSync(path.join(source, "items.jsonl"), "transient");
  native.create_directory_link(path.join(source, "sources"), path.join(source, "work", "link"));

  const copy = await directories.claim(id, duplicate, in_use);
  const destination = directories.path(copy);
  expect(copy).not.toBe(id);
  expect(fs.readdirSync(destination).sort()).toEqual([".project-path", "uploads", "work"]);
  expect(fs.readFileSync(path.join(destination, ".project-path"), "utf8")).toBe(duplicate);
  expect(fs.readFileSync(path.join(destination, "work", "entry"), "utf8")).toBe("work");
  expect(fs.readFileSync(path.join(destination, "uploads", "entry"), "utf8")).toBe("uploads");
  expect(fs.readdirSync(path.join(destination, "work"))).toEqual(["entry"]);
  fs.writeFileSync(path.join(destination, "work", "entry"), "duplicate only");
  expect(fs.readFileSync(path.join(source, "work", "entry"), "utf8")).toBe("work");
});

it("跳过顶层目录链接，拷贝失败时清理已创建的副本并保留原错误", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-workspace-copy-failure-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const native = new NativeFs();
  const directories = new AgentWorkspaceDirectories(workspace, native, vi.fn());
  const id = await directories.create();
  const source = directories.path(id);
  const duplicate = path.join(root, "duplicate.lg");
  fs.mkdirSync(path.join(source, "work"));
  native.create_directory_link(path.join(source, "work"), path.join(source, "uploads"));
  const copy = await directories.claim(id, duplicate, true);
  expect(fs.readdirSync(directories.path(copy)).sort()).toEqual([".project-path", "work"]);
  const failure = new Error("copy failed");
  vi.spyOn(native, "copy_dir_async").mockRejectedValueOnce(failure);
  await expect(directories.claim(id, duplicate, true)).rejects.toBe(failure);
  expect(fs.readdirSync(workspace).sort()).toEqual([copy, id].sort());
});
