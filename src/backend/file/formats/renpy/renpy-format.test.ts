import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RenPyFormat } from "./renpy-format";

describe("RenPyFormat", () => {
  it("门面完成 strings 条目解析与写回", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-renpy-format-"));
    const format = new RenPyFormat();
    const text = 'translate schinese strings:\n\n    old "START"\n    new ""\n';
    const [item] = format.parse_text("script.rpy", text);

    expect(item).toEqual(
      expect.objectContaining({
        src: "START",
        dst: "",
        row: 3,
        file_type: "RENPY",
        status: "NONE",
      }),
    );
    if (item === undefined) {
      throw new Error("测试样本应生成 RenPy 条目。");
    }
    item.dst = "开始";

    await format.write_to_path(
      [item],
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => Buffer.from(text),
    );

    expect(fs.readFileSync(path.join(temp_dir.path, "script.rpy"), "utf-8")).toContain(
      'new "开始"',
    );
  });
});
