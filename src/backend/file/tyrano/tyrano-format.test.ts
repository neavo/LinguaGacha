import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { Item } from "../../../domain/item";
import { NativeFs } from "../../../native/native-fs";
import { write_tyrano_app } from "../../../test/tyrano-fixture";
import { FileFormatService } from "../file-format-service";
import { create_pdf_execution } from "../pdf/test-support";
import { GameDirectoryOperations } from "../shared/game/game-directory-operations";

it("一个游戏一个资产，离线重建条目，常规导出只写翻译原稿且写回失败终止导出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-format-"));
  const native = new NativeFs();
  const root = path.join(temp.path, "Game");
  write_tyrano_app(native, path.join(root, "resources/app"), {
    "data/scenario/first.ks": "台詞[p]\n",
    "data/others/plugin/p/en.json": "{}",
  });
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    create_pdf_execution(),
  );
  const [entry, ...rest] = await service.collect_source_file_entries([temp.path]);
  expect(rest).toEqual([]);
  expect([entry!.rel_path, entry!.file_type]).toEqual(["Game.tyrano", "TYRANO"]);
  const prepared = await service.prepare_source(entry!);
  expect(prepared.additional_files).toEqual(["resources/app/data/others/plugin/p/en.json"]);
  const parsed = await service.parse_asset(
    "Game.tyrano",
    prepared.content,
    "TYRANO",
    prepared.additional_files,
  );
  if (parsed.kind !== "items") throw new Error("Unexpected PDF");
  expect(parsed.items.map((item) => [item.src, item.status])).toEqual([
    ["台詞", "NONE"],
    ["テスト", "NONE"],
  ]);
  const write = (items: Item[]) =>
    service.write_items(items, {
      paths: {
        translated_path: path.join(temp.path, "out"),
        bilingual_path: path.join(temp.path, "out"),
      },
      source_files: [{ path: "Game.tyrano", file_type: "TYRANO" }],
      additional_files: { "Game.tyrano": prepared.additional_files },
      asset_reader: () => Buffer.from(prepared.content),
    });
  await write(
    parsed.items.map((item): Item => ({ ...item, status: "PROCESSED", dst: "译" + item.src })),
  );
  const output = path.join(temp.path, "out/Game/resources/app/data");
  expect(native.read_text_file(path.join(output, "scenario/first.ks"))).toBe("译台詞[p]\n");
  expect(fs.existsSync(path.join(output, "others"))).toBe(false);
  await expect(
    write(parsed.items.map((item): Item => ({ ...item, status: "PROCESSED", dst: 'a"b' }))),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});
