import JSZip from "jszip";
import { expect, it } from "vitest";

import { image_fixture, image_png, patch_fixture, png_chunk } from "../../../test/image-fixture";
import { read_image_package } from "./image-package";

const WIDTH = 3;
const HEIGHT = 5;
const SCANLINES = [
  [0, 0, 255, 255], // None
  [1, 255, 1, 255], // Sub
  [2, 1, 255, 1], // Up
  [3, 255, 0, 129], // Average
  [4, 1, 255, 255], // Paeth，第二个样本必须取左侧预测值。
] as const;
const LAYOUT_SCANLINES = Buffer.from(SCANLINES.flat());
// 灰度与 alpha 共享滤波后的样本。RGB 刻意使用非二值数据。
const PATCH_SCANLINES = Buffer.from(
  SCANLINES.flatMap(([filter, ...samples]) => [
    filter,
    ...samples.flatMap((alpha) => [30, 210, 95, alpha]),
  ]),
);

const LAYOUT = image_png(WIDTH, HEIGHT, 0, LAYOUT_SCANLINES);
const PATCH = image_png(WIDTH, HEIGHT, 6, PATCH_SCANLINES);

/** 固定原图和清单，只有被测像素成员随用例变化。 */
async function read_with_pixels(layoutArea: Uint8Array = LAYOUT, patch: Buffer = PATCH) {
  const { pack } = image_fixture(["page"], {
    original: LAYOUT,
    size: [WIDTH, HEIGHT],
    layoutArea,
    patch,
  });
  return read_image_package(await pack(), "book.image");
}

/** 在两个 IDAT 之间插入指定块，空值生成合法分片。 */
function split_layout_idat(interruption: Buffer = Buffer.alloc(0)): Buffer {
  const idat = 33; // 签名与完整 IHDR 之后是夹具唯一的 IDAT。
  const start = idat + 8;
  const end = start + LAYOUT.readUInt32BE(idat);
  const middle = start + Math.floor((end - start) / 2);
  return Buffer.concat([
    LAYOUT.subarray(0, idat),
    png_chunk("IDAT", LAYOUT.subarray(start, middle)),
    interruption,
    png_chunk("IDAT", LAYOUT.subarray(middle, end)),
    LAYOUT.subarray(end + 4),
  ]);
}

it("成员不匹配同时报告缺失与多余路径", async () => {
  const fixture = image_fixture(["page"]);
  const archive = await JSZip.loadAsync(await fixture.pack());
  archive.remove("patches/page/text.png");
  archive.file("extra.png", fixture.patch);
  await expect(
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "bad.image"),
  ).rejects.toMatchObject({
    cause: {
      message: expect.stringMatching(/missing 1.*patches\/page\/text\.png.*extra 1.*extra\.png/u),
    },
  });
});

it("读取使用五种 PNG 滤波和连续 IDAT 分片的掩码与补丁", async () => {
  await expect(read_with_pixels(split_layout_idat())).resolves.toBeDefined();
});

it.each([
  ["layout area", image_png(WIDTH, HEIGHT, 0, LAYOUT_SCANLINES.with(WIDTH + 1 + 2, 129)), PATCH],
  ["patch alpha", LAYOUT, image_png(WIDTH, HEIGHT, 6, PATCH_SCANLINES.with(-1, 128))],
])("拒绝逆滤波后出现非二值像素的 %s", async (channel, layout, patch) => {
  await expect(read_with_pixels(layout, patch)).rejects.toThrow(`Image ${channel} must be binary`);
});

it.each([
  ["不连续的 IDAT", split_layout_idat(png_chunk("tEXt", Buffer.from("note\0split")))],
  ["缺少 IEND", LAYOUT.subarray(0, -12)],
  ["Adam7 隔行", LAYOUT.with(28, 1)],
  ["未知行滤波", image_png(WIDTH, HEIGHT, 0, LAYOUT_SCANLINES.with(0, 5))],
  ["空掩码", image_png(WIDTH, HEIGHT, 0, Buffer.alloc(LAYOUT_SCANLINES.length))],
  ["像素数据不足", image_png(WIDTH, HEIGHT, 0, LAYOUT_SCANLINES.subarray(0, -1))],
])("拒绝 %s", async (_description, layout) => {
  await expect(read_with_pixels(layout)).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("像素数据超出尺寸时在解压阶段中止", async () => {
  const oversized = image_png(WIDTH, HEIGHT, 0, Buffer.concat([LAYOUT_SCANLINES, Buffer.of(0)]));
  await expect(read_with_pixels(oversized)).rejects.toMatchObject({
    code: "file.invalid_structure",
    cause: { code: "ERR_BUFFER_TOO_LARGE" },
  });
});

it("超额成员声明在解压前拒绝", async () => {
  const oversized = Buffer.from(await image_fixture(["page1", "page2"]).pack());
  const directory = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); // 定位中央目录首条记录签名。
  oversized.writeUInt32LE(1_000_000_000, directory + 24); // 偏移 +24 为未压缩体积字段。
  await expect(read_image_package(oversized, "oversized.image")).rejects.toMatchObject({
    code: "file.asset_too_large",
  });
});

it.each(["box", "patch"] as const)("拒绝超出页面的 %s", async (kind) => {
  const fixture = image_fixture(["page"]);
  const region = fixture.book.pages[0]!.regions[0]!;
  const box = kind === "box" ? region.box : region.patch!.box;
  box[0] = 1;
  await expect(read_image_package(await fixture.pack(), "bad.image")).rejects.toThrow(
    "Image region bounds exceed page",
  );
});

it("拒绝补丁尺寸与区域不符的归档", async () => {
  const archive = await JSZip.loadAsync(await image_fixture(["page"]).pack());
  archive.file("patches/page/text.png", patch_fixture([255, 0]));
  await expect(
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "bad.image"),
  ).rejects.toThrow("matching its box");
});
