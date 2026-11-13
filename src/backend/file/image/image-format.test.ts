import { expect, it } from "vitest";
import {
  ImageFormat,
  image_sha256,
  image_records_sha256,
  read_image_package,
} from "./image-format";
import { image_fixture } from "../../../test/image-fixture";

it("原始 ZIP 目录的重复名称与超额声明在解压前拒绝", async () => {
  const bytes = Buffer.from(await image_fixture(["page1", "page2"]).pack());
  const duplicate = Buffer.from(bytes);
  const from = Buffer.from("originals/page2.png"),
    to = Buffer.from("originals/page1.png");
  for (
    let offset = duplicate.indexOf(from);
    offset !== -1;
    offset = duplicate.indexOf(from, offset + to.length)
  )
    to.copy(duplicate, offset); // 同步改写本地头与中央目录中的同名成员，模拟 ZIP 重复名攻击。
  await expect(read_image_package(duplicate, "duplicate.image")).rejects.toMatchObject({
    cause: { message: "Duplicate ZIP entry" },
  });
  const oversized = Buffer.from(bytes);
  const directory = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); // 定位中央目录首条记录签名。
  oversized.writeUInt32LE(1_000_000_000, directory + 24); // 偏移 +24 为未压缩体积字段。
  await expect(read_image_package(oversized, "oversized.image")).rejects.toMatchObject({
    code: "file.asset_too_large",
  });
});

it("生成清单区分空译文和回原文，并与当前原稿及文本字节绑定", async () => {
  const fixture = image_fixture();
  const bytes = await fixture.pack();
  const format = new ImageFormat();
  const items = (await format.read(bytes, "book.image")).items;
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  const output = await format.render(bytes, items, "book.image", {
    generationId: "generation",
    projectPath: "project.lg",
    revisions: { files: 1, items: 2 },
  });
  expect(JSON.parse(output.text).map((row: { message: string }) => row.message)).toEqual([
    "",
    "うん",
  ]);
  expect(output.manifest.rows.map((row) => row.completed)).toEqual([true, false]);
  expect(output.manifest.sourceSha256).toBe(image_sha256(bytes));
  expect(output.manifest.itemsSha256).toBe(image_sha256(output.text));
});

it("零文本封面完整保留，并可生成空完成清单", async () => {
  const fixture = image_fixture(["cover"]);
  fixture.book.pages[0]!.regions = [];
  fixture.records.length = 0;
  const bytes = await fixture.pack();
  const output = await new ImageFormat().render(bytes, [], "cover.image", {
    generationId: "cover",
    projectPath: "p.lg",
    revisions: {},
  });
  expect(output.manifest.rows).toEqual([]);
  expect((await read_image_package(bytes, "cover.image")).book.pages).toHaveLength(1);
});

it.each(["version", "geometry", "identity", "record", "digest", "path", "region"])(
  "在图片归档入口拒绝 %s 损坏",
  async (kind) => {
    const f = image_fixture();
    const page = f.book.pages[0]!;
    if (kind === "version") Object.assign(f.book, { version: 2 });
    if (kind === "geometry") page.regions[0]!.bbox.width = 2;
    if (kind === "identity") f.book.pages[1]!.pageId = page.pageId;
    if (kind === "record") f.records.reverse().pop();
    if (kind === "digest") page.sha256 = "0".repeat(64);
    if (kind === "path") page.original = "../escape.png";
    if (kind === "region") page.regions.push(structuredClone(page.regions[0]!));
    await expect(read_image_package(await f.pack(), "bad.image")).rejects.toMatchObject({
      code: "file.invalid_structure",
    });
  },
);

it("词条摘要与几何解耦，仍绑定原文和有序身份", () => {
  const { book, records } = image_fixture();
  const digest = image_records_sha256(book, records);
  book.pages[0]!.regions[0]!.bbox = { x: 5, y: 6, width: 80, height: 90 };
  book.pages[0]!.regions[0]!.style = { fontSize: 30 };
  book.pages[0]!.regions[0]!.disposition = "preserve";
  expect(image_records_sha256(book, records)).toBe(digest);
  expect(image_records_sha256(book, [...records].reverse())).not.toBe(digest);
  records[0]!.message = "原文修订";
  expect(image_records_sha256(book, records)).not.toBe(digest);
});
