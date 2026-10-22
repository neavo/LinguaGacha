import path from "node:path";
import { expect, it, vi } from "vitest";
import { GameDirectoryOperations } from "./game-directory-operations";
import { NativeFs } from "../../../../native/native-fs";

it("整批占用范围，父子目录互斥，相邻目录可以推进，失败后释放", async () => {
  const operations = new GameDirectoryOperations();
  const root = path.resolve("game");
  const release = Promise.withResolvers<void>();
  const first = operations.run([root, root, path.join(root, "data")], () => release.promise);
  const rejected = vi.fn(async () => undefined);
  try {
    for (const directory of [root, path.dirname(root), path.join(root, "data")])
      await expect(
        operations.run([path.resolve("other"), directory], rejected),
      ).rejects.toMatchObject({
        code: "file.busy",
        public_details: { directory: new NativeFs().to_identity_path(directory) },
      });
    expect(rejected).not.toHaveBeenCalled();
    await expect(
      operations.run([root + "2", path.resolve("other")], async () => "ok"),
    ).resolves.toBe("ok");
  } finally {
    release.resolve();
    await first;
  }
  const failure = new Error("operation failed");
  await expect(
    operations.run([root], async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  await expect(operations.run([root], async () => "released")).resolves.toBe("released");
});

it("停止取消全部操作并等到收尾，停止期间拒绝新操作", async () => {
  const operations = new GameDirectoryOperations();
  const release = Promise.withResolvers<void>();
  const signals: AbortSignal[] = [];
  const jobs = ["first", "second"].map((directory) =>
    operations.run([directory], async (signal) => {
      signals.push(signal);
      await release.promise;
      signal.throwIfAborted();
    }),
  );
  const settled = Promise.allSettled(jobs);
  const finished = vi.fn();
  const stopping = Promise.all([operations.stop(), operations.stop()]).then(finished);
  try {
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await expect(operations.run(["third"], async () => undefined)).rejects.toMatchObject({
      code: "runtime.disposed",
    });
    expect(finished).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await settled;
    await stopping;
  }
  expect((await settled).every((result) => result.status === "rejected")).toBe(true);
  expect(finished).toHaveBeenCalledOnce();
});

it("调用方取消后仍持有目录，直到恢复完成", async () => {
  const operations = new GameDirectoryOperations();
  const controller = new AbortController();
  const release = Promise.withResolvers<void>();
  const job = operations.run(
    ["game"],
    async (signal) => {
      await release.promise;
      signal.throwIfAborted();
    },
    controller.signal,
  );
  const result = expect(job).rejects.toThrow("cancelled");
  try {
    controller.abort(new Error("cancelled"));
    await expect(operations.run(["game"], async () => undefined)).rejects.toMatchObject({
      code: "file.busy",
    });
  } finally {
    release.resolve();
    await result;
  }
  await expect(operations.run(["game"], async () => undefined)).resolves.toBeUndefined();
});
