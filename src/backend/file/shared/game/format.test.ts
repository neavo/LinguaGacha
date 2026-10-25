import { GameDirectoryOperations } from "./game-directory-operations";
import { read_zip_fixture, zip_text, write_zip } from "../../../../test/zip-fixture";
import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { create_rpgmaker_mv_mz_adapter } from "../../rpgmaker-mv-mz/rpgmaker-format";
import { GameFormat, read_game_container, GAME_METADATA_MEMBER } from "./format";

it("附加原稿统一分流，旧清单兼容且常规导出保留已有补丁", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-additional-export-"));
  const bytes = await write_zip(
    new Map([
      ["data/System.json", "{}"],
      ["custom/broken.json", "{"],
      ["game_files.txt", "real game data"],
      ["game_files.reference.txt", "data/System.json\ncustom/broken.json\ngame_files.txt"],
    ]),
  );
  const additional_files = ["custom/broken.json", "game_files.txt"];
  const container = await read_game_container(bytes, "game.rpgmaker", false, additional_files);
  expect([...container.input.keys()]).toEqual(["data/System.json"]);
  expect(await container.additional.get("game_files.txt")!.async("string")).toBe("real game data");
  const native = new NativeFs();
  const format = new GameFormat(
    new GameDirectoryOperations(),
    create_rpgmaker_mv_mz_adapter(),
    native,
  );
  expect(await format.read_from_stream(bytes, "game.rpgmaker", additional_files)).toEqual({
    items: [],
    warnings: [],
  });
  native.write_file_sync(path.join(temp.path, "game/custom/broken.json"), "installed patch");
  await format.write_to_path([], {
    paths: { translated_path: temp.path, bilingual_path: temp.path },
    source_files: [{ path: "game.rpgmaker", file_type: "RPGMAKER_MV_MZ" }],
    additional_files: { "game.rpgmaker": additional_files },
    asset_reader: () => Buffer.from(bytes),
  });
  expect(native.read_text_file(path.join(temp.path, "game/custom/broken.json"))).toBe(
    "installed patch",
  );
  const old = await read_game_container(
    await write_zip(
      new Map([
        ["data/System.json", "{}"],
        ["game_files.txt", "legacy list"],
      ]),
    ),
    "old.zip",
  );
  expect(await old.game_files!.async("string")).toBe("legacy list");
  expect([...old.members.keys()]).toEqual(["data/System.json"]);
});

it("输出占用持续到取消清理完成，取消后保留原目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-export-stop-"));
  const operations = new GameDirectoryOperations();
  const native = new NativeFs();
  const root = path.join(temp.path, "game");
  native.write_file_sync(path.join(root, "data/System.json"), "original");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const write = native.write_file.bind(native);
  vi.spyOn(native, "write_file").mockImplementationOnce(async (file, bytes) => {
    entered.resolve();
    await release.promise;
    await write(file, bytes);
  });
  const format = new GameFormat(operations, create_rpgmaker_mv_mz_adapter(), native);
  const bytes = await write_zip(new Map([["data/System.json", "{}"]]));
  const job = format.write_to_path([], {
    paths: { translated_path: temp.path, bilingual_path: temp.path },
    source_files: [{ path: "game.rpgmaker", file_type: "RPGMAKER_MV_MZ" }],
    asset_reader: () => Buffer.from(bytes),
  });
  const result = expect(job).rejects.toMatchObject({ code: "runtime.disposed" });
  try {
    await entered.promise;
    await expect(operations.run([root], async () => undefined)).rejects.toMatchObject({
      code: "file.busy",
    });
    const stopped = vi.fn();
    const stopping = operations.stop().then(stopped);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    release.resolve();
    await result;
    await stopping;
    expect(fs.readFileSync(path.join(root, "data/System.json"), "utf8")).toBe("original");
    expect(fs.existsSync(path.join(root, ".tmp"))).toBe(false);
  } finally {
    release.resolve();
    await Promise.allSettled([job]);
  }
});

it("游戏 拒绝没有原稿文件的容器", async () => {
  const zip = new JSZip().folder("data")!;
  await expect(
    read_game_container(await zip.generateAsync({ type: "uint8array" }), "game.zip"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});
it.each([{ names: ["game_files.reference.txt/child"] }, { names: ["data/a.json", "DATA/b.json"] }])(
  "固化时拒绝保留路径冲突或目录拼写冲突：$names",
  async ({ names }) => {
    const format = new GameFormat(
      new GameDirectoryOperations(),
      create_rpgmaker_mv_mz_adapter(),
      new NativeFs(),
    );
    await expect(
      format.create_container(
        new Map(names.map((name) => [name, Buffer.from("data")])),
        "game.zip",
        "",
      ),
    ).rejects.toThrow();
  },
);
it("旧容器的保留路径同名普通文件仍作为原稿读取", async () => {
  const bytes = await write_zip(
    new Map([
      [GAME_METADATA_MEMBER, "ordinary"],
      ["data/file", "data"],
    ]),
  );
  const legacy = await read_game_container(bytes, "game.zip");
  expect(legacy.members.has(GAME_METADATA_MEMBER)).toBe(true);
  const declared = await read_game_container(bytes, "game.zip", true);
  expect(declared.members.has(GAME_METADATA_MEMBER)).toBe(false);
  expect(await declared.input.get(GAME_METADATA_MEMBER)!.async("string")).toBe("ordinary");
});
it.each(["data/file", "DATA/file", "data/file/extra"])(
  "生成输出冲突 %s 在落盘前失败",
  async (generated) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-export-"));
    const format = new GameFormat(
      new GameDirectoryOperations(),
      {
        file_type: "RPGMAKER_MV_MZ",
        internal_path: () => "data/file",
        async create_members() {
          return {
            async read_file() {
              return { items: [], warnings: [] };
            },
            async render(content) {
              return content;
            },
            async prepare_export(items) {
              expect(items).toEqual([]);
              return new Map([[generated, Buffer.from("generated")]]);
            },
          };
        },
      },
      new NativeFs(),
    );
    const bytes = await write_zip(new Map([["data/file", "original"]]));
    const output = path.join(temp.path, "out");
    await expect(
      format.write_to_path([], {
        paths: { translated_path: output, bilingual_path: output },
        source_files: [{ path: "game.rpgmaker", file_type: "RPGMAKER_MV_MZ" }],
        asset_reader: () => Buffer.from(bytes),
      }),
    ).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false);
  },
);

it("容器只固化调用方提供的数据字节，字体保留在游戏文件清单", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-container-"));
  const native = new NativeFs();
  const format = new GameFormat(
    new GameDirectoryOperations(),
    create_rpgmaker_mv_mz_adapter(),
    native,
  );
  native.write_file_sync(path.join(temp.path, "fonts/main.ttf"), "font");
  const data = new Map([["data/System.json", Buffer.from("original")]]);
  native.write_file_sync(path.join(temp.path, "data/System.json"), "changed on disk");
  const prepared = await format.create_container(
    data,
    "game.zip",
    "data/System.json\nfonts/main.ttf",
  );
  const { members, game_files } = await read_game_container(prepared, "game.zip");
  expect([...members.keys()]).toEqual(["data/System.json"]);
  expect(
    (await members.get("data/System.json")!.async("nodebuffer")).equals(
      data.get("data/System.json")!,
    ),
  ).toBe(true);
  expect(await game_files!.async("string")).toContain("fonts/main.ttf");
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
});

it("游戏 解析通过共享容器入口拒绝越界成员", async () => {
  const format = new GameFormat(
    new GameDirectoryOperations(),
    create_rpgmaker_mv_mz_adapter(),
    new NativeFs(),
  );
  const bytes = await write_zip(new Map([["../outside.json", "{}"]]));
  await expect(format.read_from_stream(bytes, "game.zip")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it("解析失败保留原始字节，零条目导出仍包含该文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-errors-"));
  fs.mkdirSync(path.join(temp.path, "data"));
  fs.mkdirSync(path.join(temp.path, "js"));
  fs.writeFileSync(path.join(temp.path, "data/System.json"), "{}");
  fs.writeFileSync(path.join(temp.path, "data/Broken.json"), "{");
  fs.mkdirSync(path.join(temp.path, "img/pictures"), { recursive: true });
  fs.writeFileSync(path.join(temp.path, "img/pictures/Actor1.png"), "");
  const native = new NativeFs();
  const service = new GameFormat(
    new GameDirectoryOperations(),
    create_rpgmaker_mv_mz_adapter(),
    native,
  );
  const files = new Map(
    ["data/Broken.json", "data/System.json"].map((name) => [
      name,
      native.read_file(path.join(temp.path, name)),
    ]),
  );
  const prepared = await service.create_container(
    files,
    "game.zip",
    "data/Broken.json\ndata/System.json\nimg/pictures/Actor1.png",
  );
  const parsed = await service.read_from_stream(prepared, "game.zip");
  expect(parsed.items).toEqual([]);
  expect(parsed.warnings).toMatchObject([
    { code: "internal_file_parse_failed", internal_file_path: "data/Broken.json" },
  ]);
  expect(Buffer.from(prepared).readUInt16LE(8)).toBe(0); // ZIP STORE 是原稿存储协议。
  const archive = await read_zip_fixture(prepared);
  expect([...archive.keys()]).toEqual([
    "data/Broken.json",
    "data/System.json",
    "game_files.reference.txt",
  ]);
  expect(zip_text(archive, "game_files.reference.txt")).toBe(
    "data/Broken.json\ndata/System.json\nimg/pictures/Actor1.png",
  );
  expect(zip_text(archive, "data/Broken.json")).toBe("{");
  const output = path.join(temp.path, "out");
  await service.write_to_path([], {
    paths: { translated_path: output, bilingual_path: output },
    source_files: [{ path: "game.zip", file_type: "RPGMAKER_MV_MZ" }],
    asset_reader: () => Buffer.from(prepared),
  });
  expect(fs.readFileSync(path.join(output, "game/data/Broken.json"), "utf8")).toBe("{");
  expect(fs.readFileSync(path.join(output, "game/data/System.json"), "utf8")).toBe("{}");
  expect(fs.existsSync(path.join(output, "game/game_files.reference.txt"))).toBe(false);
});

it("按游戏资产提交，后续资产暂存失败保留此前成功输出与已有文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-asset-commit-"));
  const native = new NativeFs();
  const format = new GameFormat(
    new GameDirectoryOperations(),
    {
      file_type: "RPGMAKER_MV_MZ",
      internal_path: () => "data/file",
      async create_members() {
        return {
          async read_file() {
            return { items: [], warnings: [] };
          },
          async render(content) {
            if (Buffer.from(content).toString() === "fail") throw new Error("second asset failed");
            return content;
          },
        };
      },
    },
    native,
  );
  const assets = new Map([
    ["first.rpgmaker", await write_zip(new Map([["data/file", "first output"]]))],
    ["second.rpgmaker", await write_zip(new Map([["data/file", "fail"]]))],
  ]);
  native.write_file_sync(path.join(temp.path, "second/keep.txt"), "keep");
  await expect(
    format.write_to_path([], {
      paths: { translated_path: temp.path, bilingual_path: temp.path },
      source_files: [...assets.keys()].map((path) => ({ path, file_type: "RPGMAKER_MV_MZ" })),
      asset_reader: (file) => Buffer.from(assets.get(file)!),
    }),
  ).rejects.toThrow("second asset failed");
  expect(native.read_text_file(path.join(temp.path, "first/data/file"))).toBe("first output");
  expect(fs.readdirSync(path.join(temp.path, "second"))).toEqual(["keep.txt"]);
});

it("关闭发生在资产提交后时，保留已提交文件且不读取后续资产", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-export-next-"));
  const operations = new GameDirectoryOperations();
  const native = new NativeFs();
  const remove = native.remove_async.bind(native);
  let stopping: Promise<void> | undefined;
  vi.spyOn(native, "remove_async").mockImplementationOnce(async (file, options) => {
    await remove(file, options);
    stopping = operations.stop(); // 已提交资产的清理结束，下一资产尚未取得占用。
  });
  const format = new GameFormat(operations, create_rpgmaker_mv_mz_adapter(), native);
  const bytes = await write_zip(new Map([["data/System.json", "{}"]]));
  const reads: string[] = [];
  await expect(
    format.write_to_path([], {
      paths: { translated_path: temp.path, bilingual_path: temp.path },
      source_files: ["first.rpgmaker", "second.rpgmaker"].map((path) => ({
        path,
        file_type: "RPGMAKER_MV_MZ",
      })),
      asset_reader: (file) => {
        reads.push(file);
        return Buffer.from(bytes);
      },
    }),
  ).rejects.toMatchObject({ code: "runtime.disposed" });
  await stopping;
  expect(reads).toEqual(["first.rpgmaker"]);
  expect(native.read_text_file(path.join(temp.path, "first/data/System.json"))).toBe("{}");
  expect(fs.readdirSync(temp.path)).toEqual(["first"]);
});
