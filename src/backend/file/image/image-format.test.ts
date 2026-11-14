import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  ImageFormat,
  compute_clean_status,
  erase_input_digest,
  image_record_identities,
  image_sha256,
  read_image_package,
  validate_image_book,
} from "./image-format";
import { image_fixture } from "../../../test/image-fixture";
import { write_zip } from "../../../test/zip-fixture";

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

it("按工作台口径渲染 items.json，区分空译文与回原文", async () => {
  const fixture = image_fixture();
  const bytes = await fixture.pack();
  const format = new ImageFormat();
  const items = (await format.read(bytes, "book.image")).items;
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  const text = await format.render_text(bytes, items, "book.image");
  expect(JSON.parse(text).map((row: { message: string }) => row.message)).toEqual(["", "うん"]);
});

it("零文本封面完整保留，并允许导出空词条列表", async () => {
  const fixture = image_fixture(["cover"]);
  const page = fixture.book.pages[0]!;
  page.regions = [];
  fixture.clean.pages[0]!.regions = [];
  fixture.clean.pages[0]!.inputSha256 = erase_input_digest(page);
  fixture.records.length = 0;
  const bytes = await fixture.pack();
  expect((await read_image_package(bytes, "cover.image")).book.pages).toHaveLength(1);
  expect(JSON.parse(await new ImageFormat().render_text(bytes, [], "cover.image"))).toEqual([]);
});

it.each([
  "version",
  "quad",
  "identity",
  "record",
  "digest",
  "path",
  "region",
  "preserveReason",
  "cleanSha",
  "inputSha",
  "maskMissing",
])("在图片归档入口拒绝 %s 损坏", async (kind) => {
  const f = image_fixture();
  const page = f.book.pages[0]!;
  const cleanPage = f.clean.pages[0]!;
  if (kind === "version") Object.assign(f.book, { version: 2 });
  if (kind === "quad") page.regions[0]!.textAreas[0]![1].x = 2;
  if (kind === "identity") f.book.pages[1]!.pageId = page.pageId;
  if (kind === "record") f.records.reverse().pop();
  if (kind === "digest") page.sha256 = "0".repeat(64);
  if (kind === "path") page.original = "../escape.png";
  if (kind === "region") page.regions.push(structuredClone(page.regions[0]!));
  if (kind === "preserveReason") {
    page.regions[0]!.disposition = "preserve";
    delete page.regions[0]!.erase;
  }
  if (kind === "cleanSha") cleanPage.cleanSha256 = "0".repeat(64);
  if (kind === "inputSha") cleanPage.inputSha256 = "0".repeat(64);
  if (kind === "maskMissing") delete cleanPage.regions[0]!.mask;
  await expect(read_image_package(await f.pack(), "bad.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it("eraseInputDigest 与译文/排序/方向/保留原因解耦，与消字规范绑定", () => {
  const { book } = image_fixture(["p1"]);
  const page = book.pages[0]!;
  const digest = erase_input_digest(page);
  page.regions[0]!.direction = "horizontal-tb";
  expect(erase_input_digest(page)).toBe(digest);
  page.regions[0]!.disposition = "preserve";
  page.regions[0]!.preserveReason = "unreadable";
  delete page.regions[0]!.erase;
  expect(erase_input_digest(page)).not.toBe(digest);
});

it("compute_clean_status 与 validate_image_book 区分待定方向与修复失败原因", () => {
  const { book, records } = image_fixture(["p1"]);
  expect(compute_clean_status(book)).toBe("complete");
  book.pages[0]!.regions[0]!.direction = null;
  expect(() => validate_image_book(book, records, { confirmed: false })).not.toThrow();
  expect(() => validate_image_book(book, records, { confirmed: true })).toThrow();
  book.pages[0]!.regions[0]!.disposition = "preserve";
  book.pages[0]!.regions[0]!.preserveReason = "repair_failed";
  delete book.pages[0]!.regions[0]!.erase;
  records.length = 0;
  expect(compute_clean_status(book)).toBe("partial");
  expect(() => validate_image_book(book, records)).not.toThrow();
  expect(image_record_identities(book, records)).toEqual(new Map());
});

it("read_image_package 在读取边界严格校验掩码外像素一致性", async () => {
  const white = rgb_png([[255, 255, 255]], 1, 1);
  const black = rgb_png([[0, 0, 0]], 1, 1);
  const f = image_fixture(["cover"]);
  f.book.pages[0]!.sha256 = image_sha256(white);
  f.book.pages[0]!.regions = [];
  f.clean.pages[0]!.cleanSha256 = image_sha256(black);
  f.clean.pages[0]!.regions = [];
  f.clean.pages[0]!.inputSha256 = erase_input_digest(f.book.pages[0]!);
  f.records.length = 0;

  const badZip = await write_zip(
    new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(f.book)],
      ["items.json", JSON.stringify(f.records)],
      ["clean.json", JSON.stringify(f.clean)],
      [f.book.pages[0]!.original, white],
      [f.clean.pages[0]!.clean, black],
    ]),
  );
  await expect(read_image_package(badZip, "tampered-pixel.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
    cause: { message: "Pixels changed outside masks" },
  });

  // 2x1 图：左像素在掩码内允许改动，右像素在掩码外必须与原图一致。
  const orig2 = rgb_png(
    [
      [255, 255, 255],
      [10, 20, 30],
    ],
    2,
    1,
  );
  const cleanOk2 = rgb_png(
    [
      [0, 0, 0],
      [10, 20, 30],
    ],
    2,
    1,
  );
  const mask2 = rgb_png(
    [
      [255, 255, 255],
      [0, 0, 0],
    ],
    2,
    1,
  );
  const f2 = image_fixture(["p1"]);
  f2.book.pages[0]!.width = 2;
  f2.book.pages[0]!.sha256 = image_sha256(orig2);
  f2.clean.pages[0]!.cleanSha256 = image_sha256(cleanOk2);
  f2.clean.pages[0]!.inputSha256 = erase_input_digest(f2.book.pages[0]!);
  f2.clean.pages[0]!.regions[0]!.maskSha256 = image_sha256(mask2);

  const okZip = await write_zip(
    new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(f2.book)],
      ["items.json", JSON.stringify(f2.records)],
      ["clean.json", JSON.stringify(f2.clean)],
      [f2.book.pages[0]!.original, orig2],
      [f2.clean.pages[0]!.clean, cleanOk2],
      [f2.clean.pages[0]!.regions[0]!.mask!, mask2],
    ]),
  );
  expect((await read_image_package(okZip, "masked-ok.image")).book.pages).toHaveLength(1);

  // JPEG 封面与带 EXIF 方向（6: 顺时针 90°）的原图也必须在读取边界校验掩码外像素一致性。
  const whiteJpg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==",
    "base64",
  );
  const fJpgBad = image_fixture(["cover"]);
  fJpgBad.book.pages[0]!.original = "originals/cover.jpg";
  fJpgBad.book.pages[0]!.sha256 = image_sha256(whiteJpg);
  fJpgBad.book.pages[0]!.regions = [];
  fJpgBad.clean.pages[0]!.cleanSha256 = image_sha256(black);
  fJpgBad.clean.pages[0]!.regions = [];
  fJpgBad.clean.pages[0]!.inputSha256 = erase_input_digest(fJpgBad.book.pages[0]!);
  fJpgBad.records.length = 0;
  const badJpgZip = await write_zip(
    new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(fJpgBad.book)],
      ["items.json", JSON.stringify(fJpgBad.records)],
      ["clean.json", JSON.stringify(fJpgBad.clean)],
      [fJpgBad.book.pages[0]!.original, whiteJpg],
      [fJpgBad.clean.pages[0]!.clean, black],
    ]),
  );
  await expect(read_image_package(badJpgZip, "tampered-jpg.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
    cause: { message: "Pixels changed outside masks" },
  });

  // 即使整页掩码外通道仅差 1 LSB，JPEG 读取边界也必须严格拒绝。
  const nearWhiteClean = rgb_png([[254, 255, 255]], 1, 1);
  fJpgBad.clean.pages[0]!.cleanSha256 = image_sha256(nearWhiteClean);
  const oneLsbZip = await write_zip(
    new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(fJpgBad.book)],
      ["items.json", JSON.stringify(fJpgBad.records)],
      ["clean.json", JSON.stringify(fJpgBad.clean)],
      [fJpgBad.book.pages[0]!.original, whiteJpg],
      [fJpgBad.clean.pages[0]!.clean, nearWhiteClean],
    ]),
  );
  await expect(read_image_package(oneLsbZip, "1lsb-tampered-jpg.image")).rejects.toMatchObject({
    code: "file.invalid_structure",
    cause: { message: "Pixels changed outside masks" },
  });

  const exif6Jpg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQIBAQEBAQIBAQECAgICAgICAgIDAwQDAwMDAwICAwQDAwQEBAQEAgMFBQQEBQQEBAT/2wBDAQEBAQEBAQIBAQIEAwIDBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAT/wAARCAACAAEDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+wv8A4dbf8Eyf+kdH7CX/AIiL8P8A/wCVNb/WsT/z8l97Mfq+H/59x+5H/9k=",
    "base64",
  );
  const fExif = image_fixture(["p1"]);
  fExif.book.pages[0]!.width = 2;
  fExif.book.pages[0]!.orientation = 6;
  fExif.book.pages[0]!.original = "originals/p1.jpg";
  fExif.book.pages[0]!.sha256 = image_sha256(exif6Jpg);
  fExif.clean.pages[0]!.cleanSha256 = image_sha256(cleanOk2);
  fExif.clean.pages[0]!.inputSha256 = erase_input_digest(fExif.book.pages[0]!);
  fExif.clean.pages[0]!.regions[0]!.maskSha256 = image_sha256(mask2);
  const okExifZip = await write_zip(
    new Map<string, string | Uint8Array>([
      ["image.json", JSON.stringify(fExif.book)],
      ["items.json", JSON.stringify(fExif.records)],
      ["clean.json", JSON.stringify(fExif.clean)],
      [fExif.book.pages[0]!.original, exif6Jpg],
      [fExif.clean.pages[0]!.clean, cleanOk2],
      [fExif.clean.pages[0]!.regions[0]!.mask!, mask2],
    ]),
  );
  expect((await read_image_package(okExifZip, "exif6-ok.image")).book.pages).toHaveLength(1);
});
