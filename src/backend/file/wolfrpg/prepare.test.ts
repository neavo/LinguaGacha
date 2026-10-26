import { GameDirectoryOperations } from "../shared/game/game-directory-operations";
import { prepare_game_source } from "../shared/game/engines";
import { expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeFs } from "../../../native/native-fs";
import { wolf_common, wolf_command, wolf_files } from "../../../test/wolf-fixture";
import { wolf_archive_fixture } from "../../../test/wolf-archive-fixture";
import { FileFormatService } from "../file-format-service";
import { wolf_vectors, wolf_vector } from "../../../test/wolf-vectors";
import { discover_wolf_source, type WolfSource } from "./source";
import { stage_wolf_source } from "./prepare";
import { read_wolf_common } from "./common-events";
import { read_wolf_database } from "./database";
/** 为各准备场景补齐引擎来源身份，统一经过正式目录事务。 */
function prepare_source(game: WolfSource, fs: NativeFs): Promise<void> {
  return prepare_game_source({ kind: "game", file_type: "WOLFRPG", game }, fs);
}

/** 从固定密文中选择准备场景，避免测试用生产算法生成输入。 */
function encrypted_fixture(name: string): Buffer {
  return wolf_vector(wolf_vectors.wolfx.find((vector) => vector.name === name)!.input);
}

it("根归档与分包按确定顺序覆盖，同名旧载荷不参与展开", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-overrides-"));
  const native = new NativeFs();
  const root_files = new Map([...wolf_files()].map(([name, bytes]) => [name.slice(5), bytes]));
  root_files.set("BasicData/extra.txt", Buffer.from("old"));
  native.write_file_sync(path.join(temp.path, "Data.wolf"), await wolf_archive_fixture(root_files));
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData.wolf"),
    await wolf_archive_fixture(new Map([["extra.txt", Buffer.from("winner")]])),
  );
  const game = (await discover_wolf_source(temp.path, native))!;
  await prepare_source(game, native);
  expect(native.read_text_file(path.join(temp.path, "Data/BasicData/extra.txt"))).toBe("winner");
  expect(native.exists(path.join(temp.path, "Data.wolf"))).toBe(false);
  expect(native.exists(path.join(temp.path, "Data/BasicData.wolf"))).toBe(false);
});

it.each(["case", "directory", "nested", "structure"])(
  "WolfX %s 冲突或结构错误在目录提交前失败",
  async (mode) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolfx-invalid-"));
    const native = new NativeFs();
    for (const [file, bytes] of wolf_files())
      native.write_file_sync(path.join(temp.path, file), bytes);
    const name = mode === "structure" ? "Data/MapData/Bad.mps" : "Data/Picture/file.bin";
    native.write_file_sync(path.join(temp.path, name + ".wolfx"), encrypted_fixture("default"));
    if (mode === "case")
      native.write_file_sync(path.join(temp.path, "Data/Picture/FILE.bin"), "old");
    if (mode === "directory") native.make_dir(path.join(temp.path, name));
    if (mode === "nested")
      native.write_file_sync(
        path.join(temp.path, name + ".wolfx.wolfx"),
        encrypted_fixture("default"),
      );
    await expect(
      prepare_source((await discover_wolf_source(temp.path, native))!, native),
    ).rejects.toThrow();
    expect(
      fs.readFileSync(path.join(temp.path, name + ".wolfx")).equals(encrypted_fixture("default")),
    ).toBe(true);
    expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
  },
);

it("三轮事件依赖从可用文件收集候选，覆盖旧明文并移除原目录及归档内 WolfX", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-chain-"));
  const native = new NativeFs(),
    files = wolf_files();
  files.set(
    "Data/BasicData/CommonEvent.dat",
    wolf_common(0x91, [
      wolf_command(122, ["seed"], [3000000]),
      wolf_command(121, [], [2000001, 123456789]),
    ]),
  );
  for (const [name, bytes] of files) native.write_file_sync(path.join(temp.path, name), bytes);
  native.write_file_sync(
    path.join(temp.path, "Data/MapData/A.mps.wolfx"),
    encrypted_fixture("chain-a"),
  );
  native.write_file_sync(path.join(temp.path, "Data/MapData/A.mps"), "stale plaintext");
  native.write_file_sync(
    path.join(temp.path, "Data/MapData/B.mps.wolfx"),
    encrypted_fixture("chain-b"),
  );
  native.write_file_sync(
    path.join(temp.path, "Data/Picture.pak"),
    await wolf_archive_fixture(new Map([["C.png.wolfx", encrypted_fixture("chain-c")]])),
  );
  const game = (await discover_wolf_source(temp.path, native))!;
  await prepare_source(game, native);
  expect(fs.readFileSync(path.join(temp.path, "Data/Picture/C.png"), "utf8")).toBe("final output");
  for (const name of [
    "Data/MapData/A.mps.wolfx",
    "Data/MapData/B.mps.wolfx",
    "Data/Picture.pak",
    "Data/Picture/C.png.wolfx",
  ])
    expect(fs.existsSync(path.join(temp.path, name))).toBe(false);
  const staging = path.join(temp.path, "stage");
  fs.mkdirSync(staging);
  expect(
    await stage_wolf_source(
      { game: (await discover_wolf_source(temp.path, native))!, staging },
      native,
    ),
  ).toMatchObject({ changes: { writes: [], removes: [] } });
});

it("六类核心及 project 成对还原一次，重复准备不再写入", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-core-pairs-"));
  const native = new NativeFs(),
    project = wolf_vectors.projects.find((vector) => vector.seed === 0)!;
  // 三个数据库主名共用独立字节向量，分别验证路径配对。
  const cores = wolf_vectors.cores
    .filter((vector) => vector.branch === "pro57")
    .flatMap((vector) =>
      vector.name === "DataBase.dat"
        ? ["DataBase.dat", "CDataBase.dat", "SysDatabase.dat"].map((name) => ({ ...vector, name }))
        : [vector],
    );
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  for (const vector of cores)
    native.write_file_sync(
      path.join(temp.path, "Data/BasicData", vector.name),
      wolf_vector(vector.input),
    );
  for (const name of ["DataBase", "CDataBase", "SysDatabase"])
    native.write_file_sync(
      path.join(temp.path, "Data/BasicData", name + ".project"),
      wolf_vector(project.input),
    );
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  for (const vector of cores)
    expect(
      fs
        .readFileSync(path.join(temp.path, "Data/BasicData", vector.name))
        .equals(wolf_vector(vector.output)),
    ).toBe(true);
  for (const name of ["DataBase", "CDataBase", "SysDatabase"])
    expect(
      fs
        .readFileSync(path.join(temp.path, "Data/BasicData", name + ".project"))
        .equals(wolf_vector(project.output)),
    ).toBe(true);
  const write = vi.spyOn(native, "write_file");
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  expect(write).not.toHaveBeenCalled();
});

it("后出现的事件候选使已解文件产生歧义，整次准备保留原件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-late-key-"));
  const native = new NativeFs();
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData/CommonEvent.dat"),
    wolf_common(0x91, [wolf_command(122, [wolf_vectors.ambiguity[0]!], [3000001])]),
  );
  native.write_file_sync(
    path.join(temp.path, "Data/Picture/ambiguous.bin.wolfx"),
    encrypted_fixture("ambiguous"),
  );
  native.write_file_sync(
    path.join(temp.path, "Data/MapData/Late.mps.wolfx"),
    encrypted_fixture("late-map"),
  );
  await expect(
    prepare_source((await discover_wolf_source(temp.path, native))!, native),
  ).rejects.toThrow("final candidate validation: Ambiguous WOLFX plaintext");
  expect(fs.existsSync(path.join(temp.path, "Data/MapData/Late.mps"))).toBe(false);
  expect(
    fs
      .readFileSync(path.join(temp.path, "Data/Picture/ambiguous.bin.wolfx"))
      .equals(encrypted_fixture("ambiguous")),
  ).toBe(true);
});

it.each(["Game.dat", "CommonEvent.dat", "SysDatabase.project"])(
  "%s.wolfx 坏布局明确拒绝并保留原件",
  async (name) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-core-wolfx-"));
    const native = new NativeFs();
    for (const [file, bytes] of wolf_files())
      native.write_file_sync(path.join(temp.path, file), bytes);
    const target = path.join(temp.path, "Data/BasicData", name + ".wolfx");
    native.write_file_sync(target, encrypted_fixture("default"));
    if (name === "Game.dat") fs.unlinkSync(path.join(temp.path, "Data/BasicData/Game.dat"));
    const game = await discover_wolf_source(temp.path, native);
    expect(game).not.toBeNull();
    await expect(prepare_source(game!, native)).rejects.toThrow(
      name + ".wolfx: WolfX: unsupported core layout",
    );
    expect(fs.readFileSync(target).equals(encrypted_fixture("default"))).toBe(true);
  },
);

it.each(["same", "conflict", "missing", "output"])(
  "%s 配套密钥按原字节去重并保留",
  async (mode) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-keys-"));
    const native = new NativeFs(),
      vector = wolf_vectors.keys.find((key) => key.type === "A1")!;
    const members = new Map([...wolf_files()].map(([name, bytes]) => [name.slice(5), bytes]));
    if (mode === "output") members.set("List.pak", Buffer.from("must not overwrite key"));
    native.write_file_sync(
      path.join(temp.path, "Data.assets"),
      await wolf_archive_fixture(members, 1010, { companion: Buffer.from(vector.key, "hex") }),
    );
    if (mode !== "missing") {
      native.write_file_sync(path.join(temp.path, "Game.wolf"), wolf_vector(vector.input));
      const bytes = wolf_vector(vector.input);
      if (mode === "conflict") bytes[30]! ^= 1;
      native.write_file_sync(path.join(temp.path, "Data/List.pak"), bytes);
    }
    const prepare = prepare_source((await discover_wolf_source(temp.path, native))!, native);
    if (mode === "same") {
      await prepare;
      expect(
        fs.readFileSync(path.join(temp.path, "Game.wolf")).equals(wolf_vector(vector.input)),
      ).toBe(true);
      expect(
        fs.readFileSync(path.join(temp.path, "Data/List.pak")).equals(wolf_vector(vector.input)),
      ).toBe(true);
      expect(fs.existsSync(path.join(temp.path, "Data.assets"))).toBe(false);
    } else
      await expect(prepare).rejects.toThrow(
        mode === "missing"
          ? "Missing WOLF companion key"
          : mode === "output"
            ? "WOLF output conflicts with companion key"
            : "Conflicting WOLF companion key",
      );
  },
);

it.each(["root", "split"])("%s 归档移除后保留空目录及嵌套空目录", async (mode) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-directories-"));
  const native = new NativeFs(),
    files = wolf_files();
  for (const [name, bytes] of files) native.write_file_sync(path.join(temp.path, name), bytes);
  const archives =
    mode === "root" ? ["Data.wolf"] : ["Data/EnemyGraphic.wolf", "Data/BasicData.wolf"];
  if (mode === "root") {
    const members = new Map([...files].map(([name, bytes]) => [name.slice(5), bytes]));
    members.set("EnemyGraphic/", Buffer.alloc(0));
    members.set("BasicData/Nested/Empty/", Buffer.alloc(0));
    native.write_file_sync(path.join(temp.path, archives[0]!), await wolf_archive_fixture(members));
  } else {
    native.write_file_sync(
      path.join(temp.path, archives[0]!),
      await wolf_archive_fixture(new Map()),
    );
    // 两个归档都没有文件，验证目录创建不依赖任何文件提交。
    const members = new Map([["Nested/Empty/", Buffer.alloc(0)]]);
    native.write_file_sync(path.join(temp.path, archives[1]!), await wolf_archive_fixture(members));
  }
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  await service.prepare_source((await service.collect_source_file_entries([temp.path]))[0]!);
  expect(fs.statSync(path.join(temp.path, "Data/EnemyGraphic")).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(temp.path, "Data/BasicData/Nested/Empty")).isDirectory()).toBe(true);
  for (const archive of archives) expect(fs.existsSync(path.join(temp.path, archive))).toBe(false);
});

it("归档中的数据提示前缀在暂存时移除，准备结果为引擎可读取的原文", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-marker-"));
  const native = new NativeFs(),
    files = wolf_files();
  const game = files.get("Data/BasicData/Game.dat")!;
  files.set(
    "Data/BasicData/Game.dat",
    Buffer.concat([
      Buffer.from("Extracting data from encrypted files violates the guidelines.\0"),
      game,
    ]),
  );
  native.write_file_sync(
    path.join(temp.path, "Data.wolf"),
    await wolf_archive_fixture(
      new Map([...files].map(([name, bytes]) => [name.slice(5), bytes])),
      350,
    ),
  );
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  await service.prepare_source((await service.collect_source_file_entries([temp.path]))[0]!);
  expect(fs.readFileSync(path.join(temp.path, "Data/BasicData/Game.dat")).equals(game)).toBe(true);
});

it.each(["unsupported", "core", "map-read", "companion-read"])(
  "准备失败 %s 保留原归档和散装文件并清理工作区",
  async (failure) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-rollback-"));
    const native = new NativeFs(),
      files = wolf_files(),
      root = temp.path;
    if (failure === "companion-read") {
      files.set("Data/BasicData/DataBase.dat", files.get("Data/BasicData/SysDatabase.dat")!);
      files.set(
        "Data/BasicData/DataBase.project",
        files.get("Data/BasicData/SysDatabase.project")!,
      );
    }
    if (failure === "map-read" || failure === "companion-read") {
      const read = native.read_file.bind(native);
      const suffix = failure === "map-read" ? "Map001.mps" : "DataBase.project";
      vi.spyOn(native, "read_file").mockImplementation((file) => {
        if (file.includes(path.sep + "stage" + path.sep) && file.endsWith(suffix))
          throw new Error("staged read failure");
        return read(file);
      });
    }
    if (failure === "core") files.delete("Data/BasicData/SysDatabase.project");
    const packed = await wolf_archive_fixture(
      new Map([...files].map(([name, bytes]) => [name.slice(5), bytes])),
    );
    if (failure === "unsupported") packed.writeUInt32LE((999 << 16) | 2, 44);
    native.write_file_sync(path.join(root, "Data.wolf"), packed);
    native.write_file_sync(path.join(root, "Data/BasicData/CommonEvent.dat"), "original loose");
    const service = new FileFormatService(
      new GameDirectoryOperations(),
      { target_language: "ZH" },
      async () => null,
      native,
    );
    const entries = await service.collect_source_file_entries([root]);
    if (failure === "unsupported")
      await expect(service.prepare_source(entries[0]!)).rejects.toThrow("crypt=999");
    else
      await expect(service.prepare_source(entries[0]!)).resolves.toMatchObject({
        directory_changed: false,
        diagnostics: expect.any(Array),
      });
    expect(fs.readFileSync(path.join(root, "Data.wolf")).equals(packed)).toBe(true);
    expect(fs.readFileSync(path.join(root, "Data/BasicData/CommonEvent.dat"), "utf8")).toBe(
      "original loose",
    );
    expect(fs.existsSync(path.join(root, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(root, "Data/BasicData/Game.dat"))).toBe(false);
  },
);

it("同次准备的数据库分别使用自己的种子，缺失配对时不提交其它已还原文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-seeds-"));
  const native = new NativeFs();
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  const pairs = [
    ["DataBase", 4294967168],
    ["CDataBase", 4294967295],
    ["SysDatabase", 0],
  ] as const;
  for (const [name, seed] of pairs) {
    const core = wolf_vectors.cores.find((v) => v.name === "DataBase.dat" && v.seed === seed)!;
    const project = wolf_vectors.projects.find((v) => v.seed === seed)!;
    native.write_file_sync(
      path.join(temp.path, "Data/BasicData", name + ".dat"),
      wolf_vector(core.input),
    );
    native.write_file_sync(
      path.join(temp.path, "Data/BasicData", name + ".project"),
      wolf_vector(project.input),
    );
  }
  const missing = path.join(temp.path, "Data/BasicData/CDataBase.project"),
    saved = fs.readFileSync(missing);
  fs.unlinkSync(missing);
  await expect(
    prepare_source((await discover_wolf_source(temp.path, native))!, native),
  ).rejects.toThrow("CDataBase.project: project protection: Missing");
  for (const [name, seed] of pairs)
    expect(
      fs
        .readFileSync(path.join(temp.path, "Data/BasicData", name + ".dat"))
        .equals(
          wolf_vector(
            wolf_vectors.cores.find((v) => v.name === "DataBase.dat" && v.seed === seed)!.input,
          ),
        ),
    ).toBe(true);
  fs.writeFileSync(missing, saved);
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  for (const [name, seed] of pairs)
    expect(
      fs
        .readFileSync(path.join(temp.path, "Data/BasicData", name + ".project"))
        .equals(wolf_vector(wolf_vectors.projects.find((v) => v.seed === seed)!.output)),
    ).toBe(true);
});

it("准备清理已知说明，重复准备保持字节不变", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-description-"));
  const native = new NativeFs(),
    vectors = wolf_vectors.descriptions;
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  const common = path.join(temp.path, "Data/BasicData/CommonEvent.dat"),
    project = path.join(temp.path, "Data/BasicData/SysDatabase.project"),
    data = path.join(temp.path, "Data/BasicData/SysDatabase.dat");
  native.write_file_sync(common, wolf_vector(vectors.common));
  native.write_file_sync(project, wolf_vector(vectors.project));
  native.write_file_sync(data, wolf_vector(vectors.data));
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  expect(read_wolf_common(fs.readFileSync(common)).details.events[0]!.description).toBe(
    "保護説明\n",
  );
  expect(
    read_wolf_database(fs.readFileSync(project), fs.readFileSync(data)).project.descriptions![0]!
      .text,
  ).toBe("保護説明\n");
  const write = vi.spyOn(native, "write_file");
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  expect(write).not.toHaveBeenCalled();
});

it.each(["shadowed", "incomplete"])("%s 地图不能提供静态密钥候选", async (mode) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-candidate-"));
  const native = new NativeFs();
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  const map = wolf_vector(wolf_vectors.wolfx.find((v) => v.name === "chain-a")!.output);
  const target = path.join(temp.path, "Data/MapData/Key.mps");
  native.write_file_sync(target, mode === "incomplete" ? map.subarray(0, -1) : map);
  if (mode === "shadowed") native.write_file_sync(target + ".wolfx", encrypted_fixture("chain-b"));
  native.write_file_sync(
    path.join(temp.path, "Data/Picture/Locked.bin.wolfx"),
    encrypted_fixture("chain-b"),
  );
  await expect(
    prepare_source((await discover_wolf_source(temp.path, native))!, native),
  ).rejects.toThrow("Locked.bin.wolfx: WolfX: insufficient local key material");
  expect(fs.existsSync(path.join(temp.path, "Data/Picture/Locked.bin"))).toBe(false);
  expect(fs.readFileSync(target).equals(mode === "incomplete" ? map.subarray(0, -1) : map)).toBe(
    true,
  );
});

it("根目录三种字体只使用默认键，可用事件密钥也不能替代", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-font-"));
  const native = new NativeFs(),
    vector = wolf_vectors.wolfx.find((v) => v.name === "default")!,
    keyed = wolf_vectors.wolfx.find((v) => v.name === "ascii")!;
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData/CommonEvent.dat"),
    wolf_common(0x91, [wolf_command(1000, ["/", keyed.key], [7])]),
  );
  const fonts = ["ttf", "ttc", "otf"].map((extension) => path.join(temp.path, "font." + extension));
  for (const target of fonts) native.write_file_sync(target + ".wolfx", wolf_vector(vector.input));
  native.write_file_sync(fonts[0]! + ".wolfx", wolf_vector(keyed.input));
  await expect(
    prepare_source((await discover_wolf_source(temp.path, native))!, native),
  ).rejects.toThrow("font.ttf.wolfx: WolfX: insufficient local key material");
  expect(fonts.some((target) => fs.existsSync(target))).toBe(false);
  native.write_file_sync(fonts[0]! + ".wolfx", wolf_vector(vector.input));
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  for (const target of fonts) {
    expect(fs.readFileSync(target).equals(wolf_vector(vector.output))).toBe(true);
    expect(fs.existsSync(target + ".wolfx")).toBe(false);
  }
});

it("未修改的独立数据库结构错误保留原字节", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-independent-"));
  const native = new NativeFs();
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  const name = path.join(temp.path, "Data/BasicData/DataBase.dat"),
    bytes = Buffer.of(0);
  native.write_file_sync(name, bytes);
  native.write_file_sync(path.join(temp.path, "Data/BasicData/DataBase.project"), Buffer.of(0));
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  expect(fs.readFileSync(name).equals(bytes)).toBe(true);
});
