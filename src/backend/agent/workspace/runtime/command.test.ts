import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { command_arguments, run_command } from "./command";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

beforeEach(() => {
  spawn.mockReset();
});

it("参数复制后校验，拒绝非数组、非字符串、空位和 NUL", () => {
  const args = ["install"];
  const copy = command_arguments(args, "tool");
  args.push("changed");
  expect(copy).toEqual(["install"]);
  // @ts-expect-error 运行时收窄模型传入的任意值。
  expect(() => command_arguments("install", "tool")).toThrow(TypeError);
  const sparse = Object.assign([], { 1: "a" }); // 空位必须同样被拒绝
  for (const bad of [[1], ["a\0b"], sparse] as unknown as string[][])
    expect(() => command_arguments(bad, "tool")).toThrow(TypeError);
});

it("启动失败等 close 才结算并保留 cause，非零退出抛错", async () => {
  const failed = new EventEmitter();
  spawn.mockReturnValueOnce(failed);
  let settled = false;
  const result = run_command("tool", "missing", [], { cwd: process.cwd() }).catch(
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  const cause = new Error("ENOENT");
  failed.emit("error", cause);
  await Promise.resolve();
  expect(settled).toBe(false);
  failed.emit("close", -1, null);
  expect(await result).toMatchObject({ cause });

  const exited = new EventEmitter();
  spawn.mockReturnValueOnce(exited);
  const exit = run_command("tool", "tool", [], { cwd: process.cwd() });
  exited.emit("close", 1, null);
  await expect(exit).rejects.toThrow("tool failed (exitCode=1");
});
