import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import { type ImageTextHostResult, type ImageTextPage } from "../../../shared/image-text";
import { image_sha256 } from "../../file/image/image-format";
import { create_image_text_renderer, validate_image_text_page } from "./render-image-text";

const result: ImageTextHostResult = {
  environment: {
    fontSha256: "a".repeat(64),
    rendererSha256: "b".repeat(64),
    chromium: "fixture",
    platform: "fixture",
    arch: "fixture",
    raster: "chromium-native-dpr1",
  },
  regions: [],
};

it("进入宿主前拒绝被改写的材料和非有限距离值", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-text-material-"));
  const host = vi.fn(async () => result);
  const render = create_image_text_renderer({
    root: temporary.path,
    nativeFs: default_native_fs,
    imageTextHost: host,
  });
  const file = path.join(temporary.path, "input.json");
  const binary = Buffer.alloc(4);
  binary.writeFloatLE(NaN);
  const page: ImageTextPage = {
    pageId: "p",
    width: 1,
    height: 1,
    regions: [
      {
        regionId: "r",
        blockId: "B1",
        text: "A",
        box: [0, 0, 1, 1],
        centroid: [0.5, 0.5],
        direction: "horizontal-tb",
        fill: { color: [255, 255, 255] },
        distance: binary.toString("base64"),
      },
    ],
  };
  const bytes = JSON.stringify(page);
  fs.writeFileSync(file, bytes);
  await expect(
    render(
      { kind: "render_image_text_page", inputPath: file, inputSha256: "0".repeat(64) },
      new AbortController().signal,
    ),
  ).rejects.toThrow("digest mismatch");
  await expect(
    render(
      { kind: "render_image_text_page", inputPath: file, inputSha256: image_sha256(bytes) },
      new AbortController().signal,
    ),
  ).rejects.toThrow("distance field");
  expect(host).not.toHaveBeenCalled();
  binary.writeFloatLE(1);
  page.regions[0]!.distance = binary.toString("base64");
  expect(() => validate_image_text_page(page)).not.toThrow();
  expect(() =>
    validate_image_text_page({ ...page, regions: [...page.regions, ...page.regions] }),
  ).toThrow("coordinates");
});

it.each(["cancel", "write failure"])("结果材料在 %s 后回收，原始原因继续传播", async (mode) => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-text-cancel-"));
  const controller = new AbortController();
  const reason = new Error(mode);
  const write = default_native_fs.write_file.bind(default_native_fs);
  using spy = vi
    .spyOn(default_native_fs, "write_file")
    .mockImplementationOnce(async (file, data) => {
      await write(file, data);
      if (mode === "cancel") controller.abort(reason);
      else throw reason;
    });
  const render = create_image_text_renderer({
    root: temporary.path,
    nativeFs: default_native_fs,
    imageTextHost: async () => result,
  });
  await expect(
    render(
      { kind: "render_image_text_page", inputPath: null, inputSha256: null },
      controller.signal,
    ),
  ).rejects.toBe(reason);
  expect(spy).toHaveBeenCalledOnce();
  expect(fs.readdirSync(path.join(temporary.path, "work"))).toEqual([]);
});
