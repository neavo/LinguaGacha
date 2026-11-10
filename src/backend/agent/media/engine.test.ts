import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ close: vi.fn(async () => undefined), created: vi.fn() }));
vi.mock("./inference-engine", async (original) => {
  const actual = await original<typeof import("./inference-engine")>();
  return {
    ...actual,
    Engine: class {
      failed = false;
      constructor(profile: unknown) {
        fake.created(profile);
      }
      close = fake.close;
    },
  };
});
vi.mock("../npm", () => ({ npm: { directory: "/shared/node" } }));
vi.mock("../npm/runtime", () => ({ npm_configuration: () => ({ runtimeDirectory: "/runtime" }) }));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "/shared/node/node_modules/onnxruntime-node/index.js" }),
}));
vi.mock("../../../native/native-fs", () => ({
  default_native_fs: {
    read_text_file: () => {
      throw Object.assign(new Error("not cached"), { code: "ENOENT" });
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  fake.created.mockClear();
  fake.close.mockReset().mockResolvedValue(undefined);
});

it("discards the failed GPU operation and reruns the entire action exactly once", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  const action = vi
    .fn()
    .mockRejectedValueOnce(new DeviceFailure("lost", "det"))
    .mockResolvedValueOnce("complete");
  await expect(operate(action)).resolves.toBe("complete");
  expect(action).toHaveBeenCalledTimes(2);
  expect(fake.close).toHaveBeenCalledTimes(2);
  expect(fake.created.mock.calls.at(-1)).toEqual([{ asr: "cpu", det: "cpu" }]);
});

it("does not start a CPU rerun or another operation after unconfirmed shutdown", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  fake.close.mockRejectedValue(new Error("shutdown timed out"));
  const action = vi.fn().mockRejectedValue(new DeviceFailure("lost", "asr"));
  await expect(operate(action)).rejects.toThrow("shutdown timed out");
  await expect(operate(action)).rejects.toThrow("shutdown timed out");
  expect(action).toHaveBeenCalledTimes(1);
  expect(fake.created).toHaveBeenCalledTimes(1);
});

it("preserves the original failure when the one allowed CPU rerun also fails", async () => {
  const { operate } = await import("./engine");
  const { DeviceFailure } = await import("./inference-engine");
  const cpu = new Error("CPU failed");
  const action = vi
    .fn()
    .mockRejectedValueOnce(new DeviceFailure("device lost", "det"))
    .mockRejectedValueOnce(cpu);
  await expect(operate(action)).rejects.toMatchObject({
    message: expect.stringContaining("device lost"),
    cause: cpu,
  });
  expect(action).toHaveBeenCalledTimes(2);
});
