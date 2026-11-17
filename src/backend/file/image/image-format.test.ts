import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { ImageFormat, build_image_text_input, image_record_identities } from "./image-format";
import { read_image_package } from "./image-package";
import { image_fixture, selection_fixture } from "../../../test/image-fixture";
import { write_zip } from "../../../test/zip-fixture";
import JSZip from "jszip";

it("成员不匹配同时报告缺失与多余路径", async () => {
  const fixture = image_fixture(["page"]);
  const archive = await JSZip.loadAsync(await fixture.pack());
  archive.remove("layout-areas/page/text.png");
  archive.file("extra.png", fixture.mask);
  await expect(
    read_image_package(await archive.generateAsync({ type: "uint8array" }), "bad.image"),
  ).rejects.toMatchObject({
    cause: {
      message: expect.stringMatching(
        /missing 1.*layout-areas\/page\/text\.png.*extra 1.*extra\.png/u,
      ),
    },
  });
});

function rgb_png(
  pixels: readonly [number, number, number][],
  width: number,
  height: number,
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y * width + x]!;
      const off = y * (1 + width * 3) + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

it("超额成员声明在解压前拒绝", async () => {
  const oversized = Buffer.from(await image_fixture(["page1", "page2"]).pack());
  const directory = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); // 定位中央目录首条记录签名。
  oversized.writeUInt32LE(1_000_000_000, directory + 24); // 偏移 +24 为未压缩体积字段。
  await expect(read_image_package(oversized, "oversized.image")).rejects.toMatchObject({
    code: "file.asset_too_large",
  });
});

it("图片写回区分完成空正文与未翻译，并固定原稿身份", async () => {
  const fixture = image_fixture();
  const bytes = await fixture.pack();
  const format = new ImageFormat();
  const items = (await format.read(bytes, "book.image")).items;
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  const { input } = await build_image_text_input(bytes, items, "book.image");
  expect(input.records).toMatchObject([
    { output: "translated", text: "" },
    { output: null, text: null },
  ]);
  items[0]!.dst = items[0]!.src;
  const same = (await build_image_text_input(bytes, items, "book.image")).input;
  expect(same.records[0]!.text).toBe(items[0]!.src);
  await expect(
    build_image_text_input(bytes, [items[0]!, items[0]!], "book.image"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
  await expect(
    build_image_text_input(bytes, [{ ...items[0]!, src: "wrong" }], "book.image"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });

  const recreated = structuredClone(fixture.book);
  recreated.bookId = "recreated";
  recreated.pages[0]!.pageId = "recreated-page";
  const recreatedRecords = structuredClone(fixture.records);
  recreatedRecords[0]!.pageId = "recreated-page";
  expect([...image_record_identities(recreated, recreatedRecords).keys()]).toEqual([
    ...image_record_identities(fixture.book, fixture.records).keys(),
  ]);
});

it("零文本封面完整保留，并允许导出空词条列表", async () => {
  const fixture = image_fixture(["cover"]);
  const page = fixture.book.pages[0]!;
  page.textBoxes = [];
  page.regions = [];
  fixture.clean.pages[0]!.regions = [];
  fixture.records.length = 0;
  const bytes = await fixture.pack();
  expect((await read_image_package(bytes, "cover.image")).book.pages).toHaveLength(1);
  expect((await build_image_text_input(bytes, [], "cover.image")).input).toMatchObject({
    records: [],
  });
});

it("EXCLUDED 条目成功输出原图且保留译文", async () => {
  const fixture = image_fixture();
  const bytes = await fixture.pack();
  const format = new ImageFormat();
  const items = (await format.read(bytes, "book.image")).items;
  items[1]!.status = "EXCLUDED";
  items[1]!.dst = "既有译文";
  const input = (await build_image_text_input(bytes, items, "book.image")).input;
  expect(input.records[1]).toEqual({
    pageId: "second",
    regionId: "text",
    output: "original",
    text: null,
  });
});

it.each(["selection", "identity", "record", "path", "region", "cleanStatus", "maskMissing"])(
  "在图片归档入口拒绝 %s 损坏",
  async (kind) => {
    const f = image_fixture();
    const page = f.book.pages[0]!;
    const cleanPage = f.clean.pages[0]!;
    if (kind === "selection") page.regions[0]!.layoutArea.path = "../mask.png";
    if (kind === "identity") f.book.pages[1]!.pageId = page.pageId;
    if (kind === "record") f.records.reverse().pop();
    if (kind === "path") page.original = "../escape.png";
    if (kind === "region") page.regions.push(structuredClone(page.regions[0]!));
    if (kind === "cleanStatus") cleanPage.regions[0]!.status = "failed";
    if (kind === "maskMissing") delete cleanPage.regions[0]!.eraseMask;
    await expect(read_image_package(await f.pack(), "bad.image")).rejects.toMatchObject({
      code: "file.invalid_structure",
    });
  },
);

it("实际消字掩码不能超出排版区域", async () => {
  const fixture = image_fixture(["p1"]);
  const page = fixture.book.pages[0]!,
    clean = fixture.clean.pages[0]!;
  const region = page.regions[0]!;
  const original = rgb_png(
    [
      [0, 0, 0],
      [10, 20, 30],
    ],
    2,
    1,
  );
  const output = rgb_png(
    [
      [255, 255, 255],
      [10, 20, 30],
    ],
    2,
    1,
  );
  const selection = selection_fixture([255, 255]);
  const mask = selection_fixture([255, 0]);
  page.width = 2;
  clean.regions[0]!.eraseMask = "erase-masks/p1/text.png";
  const entries = new Map<string, string | Uint8Array>([
    [page.original, original],
    [clean.clean, output],
    [region.layoutArea.path, selection],
    [clean.regions[0]!.eraseMask!, mask],
    ["items.json", JSON.stringify(fixture.records)],
  ]);
  const archive = async () => {
    entries.set("image.json", JSON.stringify(fixture.book));
    entries.set("clean.json", JSON.stringify(fixture.clean));
    return write_zip(entries);
  };
  await read_image_package(await archive(), "repair.image");
  const outside = selection_fixture([0, 255]);
  entries.set(region.layoutArea.path, outside);
  await expect(read_image_package(await archive(), "outside.image")).rejects.toThrow(
    "exceeds region layout area",
  );
});

it.each(["nonbinary", "empty"])("选区资产拒绝 %s", async (kind) => {
  const f = image_fixture(["p1"]);
  const page = f.book.pages[0]!;
  const region = page.regions[0]!;
  let mask = f.mask;
  if (kind === "nonbinary" || kind === "empty") {
    mask = selection_fixture([kind === "empty" ? 0 : 128]);
  }
  const output = f.original;
  const entries = new Map<string, string | Uint8Array>([
    ["image.json", JSON.stringify(f.book)],
    ["items.json", JSON.stringify(f.records)],
    ["clean.json", JSON.stringify(f.clean)],
    [page.original, f.original],
    [f.clean.pages[0]!.clean, output],
    [region.layoutArea.path, mask],
  ]);
  if (f.clean.pages[0]!.regions[0]!.status === "cleaned")
    entries.set(f.clean.pages[0]!.regions[0]!.eraseMask!, mask);
  await expect(read_image_package(await write_zip(entries), "bad.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it("语义区域保持独立时允许排版区域重叠", async () => {
  const fixture = image_fixture(["p1"]);
  const page = fixture.book.pages[0]!;
  page.textBoxes.push({ ...structuredClone(page.textBoxes[0]!), textBoxId: "t2" });
  page.regions.push({
    ...structuredClone(page.regions[0]!),
    regionId: "second",
    textBoxIds: ["t2"],
    layoutArea: { ...page.regions[0]!.layoutArea, path: "layout-areas/p1/second.png" },
  });
  fixture.clean.pages[0]!.regions.push({
    ...structuredClone(fixture.clean.pages[0]!.regions[0]!),
    regionId: "second",
    eraseMask: "erase-masks/p1/second.png",
  });
  fixture.records.push({ pageId: "p1", regionId: "second", message: "第二段" });
  expect((await read_image_package(await fixture.pack(), "overlap.image")).book.pages).toHaveLength(
    1,
  );
});
