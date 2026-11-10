import { beforeEach, expect, it, vi } from "vitest";
import { DeviceFailure } from "./inference-engine";
import { probe_gpu } from "./probe";
const fake = vi.hoisted(() => ({
  ready: vi.fn(),
  request: vi.fn(),
  operate: vi.fn(),
}));
vi.mock("./preparation", () => ({ ensure_ready: fake.ready }));
vi.mock("./engine", () => ({ operate: fake.operate }));
beforeEach(() => {
  vi.resetAllMocks();
});
it("probes once and waits for the operation to finish", async () => {
  fake.request.mockImplementation(async (_stream, kind, header, payload) => {
    expect(kind).toBe("asr");
    expect(header.shape[1]).toBeGreaterThan(0);
    const data = new Float32Array(payload.buffer);
    expect(data.length).toBe(header.shape.reduce((size: number, n: number) => size * n, 1));
    expect(data.every(Number.isFinite)).toBe(true);
  });
  const finished = Promise.withResolvers<void>(); // 独立控制执行完成，避免复制引擎的收尾实现。
  fake.operate.mockImplementationOnce(async (action, options) => {
    expect(options).toEqual({ device: "gpu" });
    await action({ request: fake.request });
    await finished.promise;
  });
  let completed = false;
  const result = probe_gpu().then((value) => {
    completed = true;
    return value;
  });
  await vi.waitFor(() => expect(fake.request).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  finished.resolve();
  await expect(result).resolves.toEqual({ available: true });
  expect(fake.request).toHaveBeenCalledOnce();
});
it("reports only device failures as unavailable, propagating preparation and close errors", async () => {
  fake.operate.mockRejectedValue(new DeviceFailure("GPU unavailable"));
  await expect(probe_gpu()).resolves.toEqual({ available: false, reason: "GPU unavailable" });
  const close = new Error("must end run");
  fake.operate.mockRejectedValue(close);
  await expect(probe_gpu()).rejects.toBe(close);
  const prepare = new Error("missing model");
  fake.ready.mockRejectedValue(prepare);
  fake.operate.mockClear();
  await expect(probe_gpu()).rejects.toBe(prepare);
  expect(fake.operate).not.toHaveBeenCalled();
});
