import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { encode_frame } from "./channel";
import { run_helper } from "./helper";

const spawned = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock("node:child_process", () => ({ spawn: () => spawned.child }));

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
  const pending = run_helper("python", "helper.py", "operation", {}, () => inference.promise)
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
