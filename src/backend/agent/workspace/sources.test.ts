import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { write_agent_workspace_sources } from "./sources";
import JSZip from "jszip";
import { encode } from "../../file/rpgmaker-rgss/marshal";
import { ruby_array } from "../../../test/rgss-fixture";
import { wolf_files } from "../../../test/wolf-fixture";
import { create_godot_fixture } from "../../../test/godot-fixture";
import { compiled_fixture } from "../../../test/renpy-fixture";

it("附加原稿按游戏路径原样展开，旧清单同名文件保留原件身份", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-additional-sources-"));
  const native = new NativeFs();
  const originals = new Map([
    ["main.gdc.json", Buffer.from("real game data")],
    ["game_files.txt", Buffer.from("real file")],
    ["data/broken.json", Buffer.from("GDSCbroken")], // 文件头形似编译脚本，进入解析时会写出错误投影。
  ]);
  const zip = new JSZip();
  for (const [name, bytes] of [...create_godot_fixture(), ...originals]) zip.file(name, bytes);
  const sourceRoot = path.join(temp.path, "sources");
  await write_agent_workspace_sources({
    nativeFs: native,
    sourceRoot,
    files: [{ file_path: "game.godot", file_type: "GODOT" }],
    additionalFiles: { "game.godot": [...originals.keys()] },
    readAsset: () => zip.generateAsync({ type: "nodebuffer" }),
  });
  for (const [name, bytes] of originals) {
    const source = native.read_file(path.join(sourceRoot, "game.godot", name));
    expect(source).toEqual(bytes);
    expect(native.exists(path.join(sourceRoot, "game.godot", name + ".error.reference.json"))).toBe(
      false,
    );
  }
});

it("普通原稿按资产相对路径保留原始字节", async () => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-"));
  const bytes = Buffer.from([0, 128, 255, 254, 65, 0]);
  const files = ["TXT", "PDF", "XLSX", "WOLFXLSX"].map((file_type) => ({
    file_path: `资料/文件.${file_type.toLowerCase()}`,
    file_type,
  }));
  await write_agent_workspace_sources({
    nativeFs: new NativeFs(),
    sourceRoot: path.join(root.path, "sources"),
    files,
    readAsset: () => bytes,
  });
  for (const file of files)
    expect(fs.readFileSync(path.join(root.path, "sources", file.file_path)).equals(bytes)).toBe(
      true,
    );
});

it.each([
  ["RPGMAKER_MV_MZ", "game.zip.rpgmaker"],
  ["EPUB", "小说/书.epub"],
])("%s 按资产相对路径展开并保留所有成员字节", async (file_type, file_path) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-rm-"));
  const zip = new JSZip();
  const members = new Map([
    ["data/Broken.json", Buffer.from("{")],
    ["data/Empty.json", Buffer.from("[]")],
    ["js/plugins/Test.js", Buffer.from([0, 128, 255, 254, 65, 0])],
    ["game_files.txt", Buffer.from("data/Broken.json\nimg/pictures/Actor1.png")], // 游戏容器的文件清单单独写出。
  ]);
  for (const [name, bytes] of members) zip.file(name, bytes);
  const content = await zip.generateAsync({ type: "nodebuffer" });
  await write_agent_workspace_sources({
    nativeFs: new NativeFs(),
    sourceRoot: path.join(root.path, "sources"),
    files: [{ file_path, file_type }],
    readAsset: () => content,
  });
  for (const [name, bytes] of members)
    expect(
      fs
        .readFileSync(
          path.join(
            root.path,
            "sources",
            file_path,
            name === "game_files.txt" && file_type !== "EPUB" ? "game_files.reference.txt" : name,
          ),
        )
        .equals(bytes),
    ).toBe(true);
});

it.each(["Data/System.rvdata2.reference.json", "game_files.reference.txt/real.json"])(
  "附加原稿 %s 与可读视图或清单冲突时失败",
  async (additional) => {
    using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-rgss-"));
    const zip = new JSZip()
      .file("Game.ini", "[Game]\n")
      .file("Data/System.rvdata2", encode(ruby_array([])))
      .file("Data/Scripts.rvdata2", encode(ruby_array([])))
      .file("game_files.txt", "Game.ini\n", { createFolders: false })
      .file(additional, "original", { createFolders: false });
    await expect(
      write_agent_workspace_sources({
        nativeFs: new NativeFs(),
        sourceRoot: root.path,
        files: [{ file_path: "game.zip", file_type: "RPGMAKER_RGSS" }],
        additionalFiles: { "game.zip": [additional] },
        readAsset: () => zip.generateAsync({ type: "nodebuffer" }),
      }),
    ).resolves.toMatchObject([
      { retry: false, issues: [expect.objectContaining({ stage: "reference" })] },
    ]);
    expect(fs.readFileSync(path.join(root.path, "game.zip", additional), "utf8")).toBe("original");
  },
);

it.each(["GODOT", "EPUB"])("%s 拒绝越界容器成员，外部路径没有写入", async (file_type) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-rm-"));
  const zip = new JSZip().file("../../outside.json", "{}", { createFolders: false });
  const content = await zip.generateAsync({ type: "nodebuffer" });
  await expect(
    write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: path.join(root.path, "sources"),
      files: [{ file_path: "game.zip", file_type }],
      readAsset: () => content,
    }),
  ).resolves.toMatchObject([
    { retry: false, issues: [{ asset_path: "game.zip", stage: "archive" }] },
  ]);
  expect(fs.existsSync(path.join(root.path, "outside.json"))).toBe(false);
});
it.each([
  {
    file_type: "WOLFRPG",
    file_path: "game.wolfrpg",
    members: new Map([...wolf_files(), ["Data/MapData/Broken.mps", Buffer.from("broken")]]),
    broken: "Data/MapData/Broken.mps",
    projection: "Data/BasicData/CommonEvent.dat.reference.json",
    expected: {
      data: { events: [{ commands: [expect.objectContaining({ code: 101, strings: ["原文"] })] }] },
    },
  },
  {
    file_type: "GODOT",
    file_path: "game.godot",
    members: new Map([...create_godot_fixture(), ["broken.scn", Buffer.from("RSRCbroken")]]),
    broken: "broken.scn",
    projection: "main.gdc.reference.json",
    expected: {
      type: "GDSC",
      strings: expect.arrayContaining([expect.objectContaining({ text: "Shared" })]),
    },
  },
  {
    file_type: "RENPY",
    file_path: "game.renpy",
    members: new Map([
      ["game/script.rpyc", compiled_fixture()],
      ["game/broken.rpyc", Buffer.from("broken")],
      [
        "__metadata__.json",
        Buffer.from(
          ' {\r\n\t"schema" : "linguagacha-renpy-1", "engine_version": "8.3.0",\r\n' +
            '\t"python_major": 3, "old_substitutions": false, "common": ["Common question?"]\r\n }\r\n',
        ),
      ],
    ]),
    broken: "game/broken.rpyc",
    projection: "game/script.rpyc.reference.json",
    expected: { internal_file_path: "game/script.rpyc", strings: expect.any(Array) },
  },
])(
  "$file_type 原件与失败成员保留原字节，生成对应可读视图与诊断",
  async ({ file_type, file_path, members, broken, projection, expected }) => {
    using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-wolf-"));
    const zip = new JSZip();
    for (const [name, bytes] of members) zip.file(name, bytes);
    const args = {
      nativeFs: new NativeFs(),
      sourceRoot: root.path,
      files: [{ file_path, file_type }],
      readAsset: () => zip.generateAsync({ type: "nodebuffer" }),
    };
    const report = vi.fn();
    const results = await write_agent_workspace_sources({ ...args, report });
    expect(results).toMatchObject([
      {
        retry: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ asset_path: file_path, member_path: broken }),
        ]),
      },
    ]);
    // 日志与问题记录来自同一诊断，逐条对应。
    expect(report.mock.calls.map(([, diagnostic]) => diagnostic.error.message)).toEqual(
      results[0]!.issues.map((issue) => issue.message),
    );
    for (const [name, bytes] of members)
      expect(fs.readFileSync(path.join(root.path, file_path, name))).toEqual(bytes);
    expect(fs.existsSync(path.join(root.path, file_path, broken + ".error.reference.json"))).toBe(
      false,
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root.path, file_path, projection), "utf8")),
    ).toMatchObject(expected);
  },
);
it("拒绝源文件路径逃逸", async () => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-"));
  await expect(
    write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot: path.join(root.path, "sources"),
      files: [{ file_path: "../outside.txt", file_type: "TXT" }],
      readAsset: () => Buffer.from("x"),
    }),
  ).rejects.toMatchObject({ code: "request.validation_failed" });
  expect(fs.existsSync(path.join(root.path, "outside.txt"))).toBe(false);
});

it.each([
  ["game", "game/readme.txt"],
  ["game/readme.txt", "game"],
])("路径冲突在任何原稿投影前失败 %j", async (...paths) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-sources-conflict-"));
  const sourceRoot = path.join(root.path, "sources");
  await expect(
    write_agent_workspace_sources({
      nativeFs: new NativeFs(),
      sourceRoot,
      files: paths.map((file_path) => ({ file_path, file_type: "TXT" })),
      readAsset: () => Buffer.from("原稿"),
    }),
  ).rejects.toMatchObject({ code: "request.validation_failed" });
  expect(fs.existsSync(sourceRoot)).toBe(false);
});
