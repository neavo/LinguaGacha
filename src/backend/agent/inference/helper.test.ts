import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { expect, it, vi } from "vitest";
import { encode_frame } from "./channel";
import { run_helper } from "./helper";

const spawned = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => spawned.child) }));

it("请求编码失败时不启动 helper", async () => {
  vi.mocked(spawn).mockClear();
  await expect(
    run_helper("python", "lg.test.helper", "operation", { value: 1n }),
  ).rejects.toThrow();
  expect(spawn).not.toHaveBeenCalled();
});

it("首次写入失败后等待 helper 退出并保留原始错误", async () => {
  const failure = new Error("write failed");
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), {
      write: () => {
        throw failure;
      },
    }),
    kill: vi.fn(() => true),
  });
  spawned.child = child;
  let finished = false;
  const pending = run_helper("python", "lg.test.helper", "operation", {})
    .catch((error: unknown) => error)
    .finally(() => {
      finished = true;
    });
  await Promise.resolve();
  expect(child.kill).toHaveBeenCalledOnce();
  expect(finished).toBe(false);
  child.emit("close", 1);
  expect(await pending).toBe(failure);
});

it("helper 提前退出后仍等待在途原生作业收尾", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), {
      writable: true,
      write: () => true,
      end: () => undefined,
    }),
    kill: () => true,
  });
  spawned.child = child;
  const inference = Promise.withResolvers<{ header: Record<string, unknown> }>();
  let finished = false;
  const pending = run_helper("python", "lg.test.helper", "operation", {}, () => inference.promise)
    .catch((error) => error)
    .finally(() => {
      finished = true;
    });
  child.stdout.emit("data", Buffer.concat(encode_frame({ id: 1, kind: "inpaint" })));
  child.emit("close", 1);
  await Promise.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  inference.resolve({ header: {} });
  expect(await pending).toBeInstanceOf(Error);
  expect(finished).toBe(true);
});
