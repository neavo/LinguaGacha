import { expect, it } from "vitest";
import { choose } from "./engine";

it("selects WebGPU only when a valid CPU baseline is clearly slower", () => {
  expect(choose([100, 110, 90], [80, 85, 200])).toBe("webgpu"); // 中位数 85 ≤ 100 × 0.85。
  expect(choose([100, 100, 100], [90, 90, 90])).toBe("cpu"); // 改善不足以超过测量噪声。
  expect(choose([100], "device lost")).toBe("cpu");
  expect(choose("load failed", [10])).toBe("cpu"); // 没有有效 CPU 基线时不能证明 GPU 结果。
  expect(choose([100], undefined)).toBe("cpu");
});
