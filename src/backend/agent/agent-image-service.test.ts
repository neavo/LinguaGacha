import { expect, it, vi } from "vitest";
import { AgentImageService, AGENT_IMAGE_POLICY } from "./agent-image-service";
import {
  AGENT_IMAGE_MAX_EDGE,
  type AgentImageHostOperation,
  type AgentImageHostResult,
} from "../../shared/agent-image";

/** 测试服务的字节身份与缓存，真实解码由 Electron 集成测试覆盖。 */
function webp(marker: number, size = 16): Uint8Array {
  const bytes = Buffer.alloc(size, marker);
  bytes.write("RIFF", 0);
  bytes.write("WEBP", 8);
  return bytes;
}

it("相同输入复用结果，内容变化重新处理", async () => {
  const output = webp(2);
  const host = vi.fn(async () => ({
    bytes: output,
    width: 100,
    height: 50,
    originalWidth: 100,
    originalHeight: 50,
  }));
  const service = new AgentImageService(host);
  const source = webp(1);
  const image = await service.prepare(source);
  expect(await service.prepare(source)).toBe(image);
  expect(host).toHaveBeenCalledTimes(1);
  source[15] = 3;
  await service.prepare(source);
  expect(host).toHaveBeenCalledTimes(2);
});

it("缓存淘汰后，已有消息仍持有完整图片，重读只重新计算", async () => {
  const host = vi.fn(async (request: AgentImageHostOperation) => ({
    bytes: webp(request.bytes[15]!, AGENT_IMAGE_POLICY.maxBytes),
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  }));
  const service = new AgentImageService(host);
  const first = await service.prepare(webp(1));
  for (let marker = 2; marker <= 6; marker++) await service.prepare(webp(marker));
  const calls = host.mock.calls.length;
  expect(await service.prepare(webp(1))).toEqual(first);
  expect(host).toHaveBeenCalledTimes(calls + 1);
  expect(Buffer.from(first.data, "base64")[15]).toBe(1);
});

it("同一原图按单次尺寸隔离缓存，在途参数修改不会改变结果校验", async () => {
  const large_edge = AGENT_IMAGE_MAX_EDGE;
  const small_edge = Math.floor(large_edge / 2);
  const host = vi.fn(async (request: AgentImageHostOperation) => ({
    bytes: webp(request.policy.maxEdge === large_edge ? 2 : 3),
    width: request.policy.maxEdge,
    height: Math.floor(request.policy.maxEdge / 2),
    originalWidth: large_edge * 2,
    originalHeight: large_edge,
  }));
  const service = new AgentImageService(host);
  const source = webp(1);
  const small = await service.prepare(source, undefined, { maxEdge: small_edge });
  const options = { maxEdge: large_edge };
  const pending = service.prepare(source, undefined, options);
  options.maxEdge = small_edge;
  const large = await pending;
  expect(small.width).toBe(small_edge);
  expect(large.width).toBe(large_edge);
  expect(await service.prepare(source, undefined, { maxEdge: small_edge })).toBe(small);
  expect(await service.prepare(source, undefined, { maxEdge: large_edge })).toBe(large);
  expect(host).toHaveBeenCalledTimes(2);
});

it("重置取消在途转换，迟到结果不能重新填入缓存", async () => {
  let finish!: (result: AgentImageHostResult) => void;
  const host = vi.fn(
    () =>
      new Promise<AgentImageHostResult>((resolve) => {
        finish = resolve;
      }),
  );
  const service = new AgentImageService(host);
  const source = webp(1);
  const pending = service.prepare(source);
  const rejected = expect(pending).rejects.toMatchObject({ code: "runtime.cancelled" });
  service.clear();
  finish({ bytes: source, width: 1, height: 1, originalWidth: 1, originalHeight: 1 });
  await rejected;
  host.mockResolvedValue({
    bytes: source,
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  });
  await service.prepare(source);
  expect(host).toHaveBeenCalledTimes(2);
});

it("失败不进入缓存，输入格式在宿主调用前校验", async () => {
  const host = vi
    .fn()
    .mockRejectedValueOnce(new Error("decode failed"))
    .mockResolvedValue({
      bytes: webp(1),
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
    });
  const service = new AgentImageService(host);
  await expect(service.prepare(new Uint8Array([1, 2]))).rejects.toMatchObject({
    code: "request.validation_failed",
  });
  expect(host).not.toHaveBeenCalled();
  await expect(service.prepare(webp(1))).rejects.toMatchObject({
    cause: { message: "decode failed" },
  });
  await service.prepare(webp(1));
  expect(host).toHaveBeenCalledTimes(2);
});

it("相同原图的并发请求共享转换，单个调用取消不影响其它消费者", async () => {
  let resolve!: (value: AgentImageHostResult) => void;
  const pending = new Promise<AgentImageHostResult>((done) => {
    resolve = done;
  });
  const host = vi.fn(() => pending);
  const service = new AgentImageService(host);
  const controller = new AbortController();
  const first = service.prepare(webp(1), controller.signal);
  const second = service.prepare(webp(1));
  const rejected = expect(first).rejects.toBeDefined();
  controller.abort();
  await rejected;
  resolve({ bytes: webp(2), width: 1, height: 1, originalWidth: 1, originalHeight: 1 });
  await expect(second).resolves.toMatchObject({ mimeType: "image/webp" });
  expect(host).toHaveBeenCalledTimes(1);
});
