import JSZip from "jszip";
import { expect, it } from "vitest";
import { write_zip } from "./zip";

it("EPUB 容器保证 mimetype 首项、STORE 与无扩展字段，保留二进制资源", async () => {
  const image = new Uint8Array([0, 128, 255]);
  const bytes = await write_zip(
    new Map<string, string | Uint8Array>([
      ["OPS/图片.bin", image],
      ["mimetype", "application/epub+zip"],
      ["OPS/正文.xhtml", "<p>你好</p>"],
    ]),
  );
  expect(bytes.readUInt16LE(8)).toBe(0);
  expect(bytes.readUInt16LE(28)).toBe(0);
  expect(bytes.subarray(30, 38).toString()).toBe("mimetype");
  const archive = await JSZip.loadAsync(bytes);
  expect((await archive.file("OPS/图片.bin")?.async("uint8array")) ?? null).toEqual(image);
  expect((await archive.file("OPS/正文.xhtml")?.async("string")) ?? null).toBe("<p>你好</p>");
  expect((await archive.file("missing")?.async("uint8array")) ?? null).toBeNull();
});
