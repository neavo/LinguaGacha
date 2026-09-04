import { describe, expect, it, vi } from "vitest";

import {
  is_agent_image_file,
  normalize_agent_images,
  resolve_agent_image_size,
} from "./agent-image";

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

  it("等比缩小大图、不放大小图并保留极窄图片", () => {
    const resized = resolve_agent_image_size(3840, 2160);
    expect(resized.width).toBeLessThan(3840);
    expect(resized.width / resized.height).toBe(3840 / 2160);
    expect(resolve_agent_image_size(1000, 500)).toEqual({ width: 1000, height: 500 });
    expect(resolve_agent_image_size(1, 10_000).width).toBe(1);
  });

  it("缩放后编码为 WebP base64 并释放图片资源", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3840, height: 2160, close })),
    );
    const draw_image = vi.fn();
    const to_blob = vi.fn((callback: BlobCallback, type?: string) => {
      expect(type).toBe("image/webp");
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

    expect(canvas.width).toBeLessThan(3840);
    expect(canvas.width / canvas.height).toBe(3840 / 2160);
    expect(draw_image).toHaveBeenCalledWith(expect.anything(), 0, 0, canvas.width, canvas.height);
    expect(result).toEqual([btoa("webp")]);
    expect(close).toHaveBeenCalledOnce();
  });
});
