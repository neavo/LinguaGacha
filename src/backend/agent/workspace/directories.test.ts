import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeFs } from "../../../native/native-fs";
import { AgentWorkspaceDirectories, AGENT_WORKSPACE_LIMIT } from "./directories";
import { AGENT_SESSION_ID_PATTERN } from "../../../shared/agent";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("保留当前和最新工作区，失败下次重试，删除链接不删除共享运行资源", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lg-workspaces-"));
  roots.push(directory);
  const root = path.join(directory, "workspace");
  const native = new NativeFs();
  const report = vi.fn();
  const directories = new AgentWorkspaceDirectories(root, native, report);
  const ids: string[] = [];
  for (let i = 0; i < AGENT_WORKSPACE_LIMIT + 2; i++) {
    const id = await directories.create();
    expect(id).toMatch(AGENT_SESSION_ID_PATTERN);
    ids.push(id);
    fs.utimesSync(directories.path(id), 1_600_000_000 + i, 1_600_000_000 + i);
  }
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
  expect(fs.readdirSync(root)).toHaveLength(AGENT_WORKSPACE_LIMIT);
  expect(fs.existsSync(directories.path(ids[1]!))).toBe(false);
  expect(fs.readFileSync(path.join(shared, "keep"), "utf8")).toBe("keep");
  await directories.touch(ids[0]!);
  expect(native.stat(directories.path(ids[0]!)).mtimeMs).toBeGreaterThan(1_600_000_100_000);
});
