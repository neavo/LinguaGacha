import { expect, it } from "vitest";
import { create_image_output } from "./emit-image";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../workspace/runtime/policy";

it("累计大小超限释放槽位和额度，后续输出仍能补足额度", async () => {
  const { imageCount: count, imageOutputBytes: limit } = AGENT_WORKSPACE_RUNTIME_POLICY;
  const chunk = Math.floor(limit / (count - 1) / 4) * 4 - 4;
  const remaining = limit - chunk * (count - 1); // 为最后一个槽位留下可精确补足的额度。
  const output = create_image_output(async (path) => ({
    data: "A".repeat(path === "refused" ? remaining + 4 : path === "last" ? remaining : chunk),
    mimeType: "image/webp",
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  }));
  const signal = new AbortController().signal;
  for (let i = 0; i < count - 1; i++) await output.emitImage("image", signal);
  // 反复拒绝后仍能补足，证明失败同时释放槽位且未增加字节计数。
  for (let i = 0; i < count; i++)
    await expect(output.emitImage("refused", signal)).rejects.toThrow("refused");
  await output.emitImage("last", signal);
  expect(output.read()).toHaveLength(count);
  expect(output.read().every((image) => image.path !== "refused")).toBe(true);
  expect(output.read().reduce((total, { image }) => total + image.data.length, 0)).toBe(limit);
});
