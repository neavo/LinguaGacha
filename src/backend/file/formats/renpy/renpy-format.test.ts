import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { Item } from "../../../../domain/item";
import { RenPyFormat } from "./renpy-format";

it("原始资产缺失时拒绝导出 Ren’Py 脚本", async () => {
  using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-renpy-format-"));
  await expect(
    new RenPyFormat().write_to_path(
      [Item.from_json({ file_type: "RENPY", file_path: "script.rpy", src: "原文", dst: "译文" })],
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => null,
    ),
  ).rejects.toMatchObject({ code: "file.not_found", public_details: { file: "script.rpy" } });
  expect(fs.readdirSync(temp_dir.path)).toEqual([]);
});
