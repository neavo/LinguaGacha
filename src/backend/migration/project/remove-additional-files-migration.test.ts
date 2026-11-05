import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../../database/database-operations";
import { build_project_open_writes } from "../project-migrations";
import { write_zip, read_zip_fixture } from "../../../test/zip-fixture";
import { create_item } from "../../../domain/item";
import { FileFormatService } from "../../file/file-format-service";
import { GameDirectoryOperations } from "../../file/shared/game/game-directory-operations";

it("打开事务只删除登记成员，保留字节与译文，异常资产不阻止打开且再次打开幂等", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-remove-additional-"));
  const project = path.join(temp.path, "old.lg");
  const database = new ProjectDatabase("1.0.0");
  const native = Buffer.from('{"text":"原文"}');
  const mixed = await write_zip(
    new Map<string, string | Uint8Array>([
      ["data/System.json", "{}"],
      ["data/Text.json", native],
      ["custom/a.json", "removed"],
      ["custom/b.bin", new Uint8Array([255, 128, 0])],
      ["game_files.reference.txt", "list"],
    ]),
  );
  const empty = await write_zip(
    new Map([
      ["note.txt", "removed"],
      ["game_files.reference.txt", "list"],
    ]),
  );
  const corrupt = Buffer.from("unreadable");
  try {
    await database.create_project(project, (writer) => {
      writer.add_asset(project, "game.rpgmaker", mixed, "RPGMAKER_MV_MZ", null, 2);
      writer.add_asset(project, "empty.rpgmaker", empty, "RPGMAKER_MV_MZ", null, 5);
      writer.add_asset(project, "bad.rpgmaker", corrupt, "RPGMAKER_MV_MZ", null, 8);
      writer.set_meta(project, "additional_files", {
        "game.rpgmaker": ["custom/a.json", "already-missing.txt"],
        "empty.rpgmaker": ["note.txt"],
        "bad.rpgmaker": ["note.txt"],
        "missing.rpgmaker": ["note.txt"],
      });
      writer.set_items(project, [
        create_item({
          id: 1,
          src: "原文",
          dst: "译文",
          status: "PROCESSED",
          file_path: "game.rpgmaker",
          file_type: "RPGMAKER_MV_MZ",
        }),
      ]);
    });
    const before = await database.get_all_items(project);
    const writes = await build_project_open_writes({ project_path: project, database });
    expect(await database.read_asset_content(project, "game.rpgmaker")).toEqual(Buffer.from(mixed));
    await database.transaction(project, (writer) => {
      for (const write of writes) write(writer);
    });
    expect(await database.get_all_items(project)).toEqual(before);
    expect(await database.get_all_meta(project)).not.toHaveProperty("additional_files");
    expect(await database.get_all_asset_records(project)).toEqual([
      { path: "game.rpgmaker", file_type: "RPGMAKER_MV_MZ", sort_order: 2 },
      { path: "bad.rpgmaker", file_type: "RPGMAKER_MV_MZ", sort_order: 8 },
    ]);
    expect(await database.read_asset_content(project, "bad.rpgmaker")).toEqual(corrupt);
    const saved = (await database.read_asset_content(project, "game.rpgmaker"))!;
    const members = await read_zip_fixture(saved);
    expect([...members.keys()]).not.toContain("custom/a.json");
    expect(members.get("data/Text.json")).toEqual(new Uint8Array(native));
    expect(members.get("custom/b.bin")).toEqual(new Uint8Array([255, 128, 0]));
    const format = new FileFormatService(
      new GameDirectoryOperations(),
      { target_language: "ZH" },
      async () => null,
    );
    const parsed = await format.parse_asset("game.rpgmaker", saved, "RPGMAKER_MV_MZ");
    if (parsed.kind !== "items") throw new Error("Expected items");
    await format.write_items(
      parsed.items.map((item) => ({ ...item, status: "PROCESSED", dst: "译文" })),
      {
        paths: { translated_path: temp.path, bilingual_path: temp.path },
        source_files: [{ path: "game.rpgmaker", file_type: "RPGMAKER_MV_MZ" }],
        asset_reader: () => saved,
      },
    );
    expect(fs.readFileSync(path.join(temp.path, "game/data/Text.json"), "utf8")).toContain("译文");
    await database.close_project(project);
    expect(await build_project_open_writes({ project_path: project, database })).toEqual([]);
  } finally {
    await database.close();
  }
});
