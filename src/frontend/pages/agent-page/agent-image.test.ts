import { beforeEach, describe, expect, it, vi } from "vitest";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { is_agent_image_file, normalize_agent_images } from "./agent-image";

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: vi.fn() }));
beforeEach(() => {
  vi.mocked(api_fetch).mockReset();
});

describe("Agent 图片上传", () => {
  it("选择、拖入与粘贴使用同一格式筛选", () => {
    for (const type of ["png", "jpeg", "bmp", "webp", "avif"])
      expect(is_agent_image_file(new File([], `a.${type}`, { type: `image/${type}` }))).toBe(true);
    expect(is_agent_image_file(new File([], "a.heic", { type: "image/heic" }))).toBe(false);
  });
  it("上传原始字节，返回后端结果并保持输入顺序", async () => {
    vi.mocked(api_fetch).mockImplementation(
      async (_path, body) => ({ data: `prepared:${(body as { data: string }).data}` }) as never,
    );
    const result = await normalize_agent_images([
      new File(["first-original"], "a.png"),
      new File(["second-original"], "b.jpg"),
    ]);
    expect(result).toEqual([
      `prepared:${btoa("first-original")}`,
      `prepared:${btoa("second-original")}`,
    ]);
    expect(api_fetch).toHaveBeenCalledWith("/api/agent/image/prepare", {
      data: btoa("first-original"),
    });
  });
  it("后端失败时不返回部分附件", async () => {
    vi.mocked(api_fetch)
      .mockResolvedValueOnce({ data: "prepared" })
      .mockRejectedValueOnce(new Error("invalid image"));
    await expect(
      normalize_agent_images([new File(["a"], "a.png"), new File(["b"], "b.png")]),
    ).rejects.toThrow("invalid image");
  });
});
