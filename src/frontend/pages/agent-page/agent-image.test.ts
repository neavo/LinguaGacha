import { afterEach, describe, expect, it, vi } from "vitest";

import {
  is_agent_image_file,
  normalize_agent_images,
  resolve_agent_image_size,
} from "./agent-image";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Agent 图片标准化", () => {
  it("接纳五类输入格式并拒绝 HEIC", () => {
    for (const [name, type] of [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.bmp", "image/bmp"],
      ["a.webp", "image/webp"],
      ["a.avif", "image/avif"],
    ]) {
      expect(is_agent_image_file(new File([], name!, { type }))).toBe(true);
    }
    expect(is_agent_image_file(new File([], "a.heic", { type: "image/heic" }))).toBe(false);
  });

  it("在 1920 边界内等比缩小且不放大小图", () => {
    expect(resolve_agent_image_size(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(resolve_agent_image_size(1000, 500)).toEqual({ width: 1000, height: 500 });
    expect(resolve_agent_image_size(1, 10_000)).toEqual({ width: 1, height: 1920 });
  });

  it("保持透明画布并按 WebP 85 编码", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3840, height: 2160, close })),
    );
    const draw_image = vi.fn();
    const to_blob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      expect(type).toBe("image/webp");
      expect(quality).toBe(0.85);
      callback(new Blob(["webp"], { type: "image/webp" }));
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: draw_image })),
      toBlob: to_blob,
    };
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);

    const result = await normalize_agent_images([new File([], "a.png", { type: "image/png" })]);

    expect(canvas).toMatchObject({ width: 1920, height: 1080 });
    expect(draw_image).toHaveBeenCalledWith(expect.anything(), 0, 0, 1920, 1080);
    expect(result).toEqual([btoa("webp")]);
    expect(close).toHaveBeenCalledOnce();
  });
});
