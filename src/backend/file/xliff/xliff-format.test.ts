import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { XLIFFFormat } from "./xliff-format";

const XLIFF = `<?xml version="1.0" encoding="UTF-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="ja" trgLang="zh">
  <file id="f1" original="script.json">
    <unit id="u-2"><notes><note category="keep">context</note></notes><segment><source>Second</source><target>第二</target></segment></unit>
    <unit id="u-1"><segment><source>Hello &amp; bye</source><target>Hello</target></segment></unit>
  </file>
</xliff>
`;

describe("XLIFFFormat", () => {
  it("reads XLIFF 2.0 units with stable ids and preserves line breaks on write", async () => {
    const format = new XLIFFFormat();
    const items = await format.read_from_stream(new TextEncoder().encode(XLIFF), "script.xlf");
    expect(items.map((item) => item.src)).toEqual(["Second", "Hello & bye"]);
    expect(items.map((item) => item.file_type)).toEqual(["XLIFF", "XLIFF"]);
    expect(items.map((item) => (item.extra_field as { unit_id: string }).unit_id)).toEqual([
      "u-2",
      "u-1",
    ]);

    items[0]!.dst = "第二行\n换行";
    items[1]!.dst = "你好 & 再见";
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-xliff-"));
    await format.write_to_path(
      items,
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => Buffer.from(XLIFF),
    );

    const output = fs.readFileSync(path.join(temp_dir.path, "script.xlf"), "utf-8");
    const parsed_output = await format.read_from_stream(new TextEncoder().encode(output), "script.xlf");
    expect(parsed_output.map((item) => item.dst)).toEqual(["第二行\n换行", "你好 & 再见"]);
    expect(output).toContain('category="keep"');
    expect(output).toContain("<source>Hello &amp; bye</source>");
  });

  it("locates each segment by unit id instead of current array order", async () => {
    const format = new XLIFFFormat();
    const items = await format.read_from_stream(new TextEncoder().encode(XLIFF), "script.xliff");
    items.reverse();
    items[0]!.dst = "译文 u-1";
    items[1]!.dst = "译文 u-2";
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-xliff-"));
    await format.write_to_path(
      items,
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => Buffer.from(XLIFF),
    );
    const output = fs.readFileSync(path.join(temp_dir.path, "script.xliff"), "utf-8");
    const parsed_output = await format.read_from_stream(new TextEncoder().encode(output), "script.xliff");
    expect(parsed_output.map((item) => item.dst)).toEqual(["译文 u-2", "译文 u-1"]);
  });

  it("rejects a changed source during write", async () => {
    const format = new XLIFFFormat();
    const [item] = await format.read_from_stream(new TextEncoder().encode(XLIFF), "script.xlf");
    item!.src = "tampered";
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-xliff-"));
    await expect(
      format.write_to_path(
        [item!],
        { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
        () => Buffer.from(XLIFF),
      ),
    ).rejects.toThrow();
  });
});
