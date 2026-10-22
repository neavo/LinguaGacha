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
import { wolf_crypt_vectors } from "../../../test/wolf-crypt-vectors";
import { wolf_vector } from "../../../test/wolf-crypt-fixture";
import { discover_wolf_source, type WolfSource } from "./source";
import { stage_wolf_source } from "./prepare";

/** 为各准备场景补齐引擎来源身份，统一经过正式目录事务。 */
function prepare_source(game: WolfSource, fs: NativeFs): Promise<void> {
  return prepare_game_source({ kind: "game", file_type: "WOLFRPG", game }, fs);
}

function encrypted_fixture(name: string): Buffer {
  return wolf_vector(wolf_crypt_vectors.wolfx.find((vector) => vector.name === name)!.input);
}

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
  ).toMatchObject({ writes: [], removes: [] });
});

it("六类核心及延迟解包的 project 成对还原一次，加密 Game.dat 可作为散装入口", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-core-pairs-"));
  const native = new NativeFs();
  for (const [name, bytes] of wolf_files())
    if (!name.endsWith("Game.dat")) native.write_file_sync(path.join(temp.path, name), bytes);
  for (const vector of wolf_crypt_vectors.cores)
    if (vector.name !== "Game.dat")
      native.write_file_sync(
        path.join(temp.path, "Data/BasicData", vector.name),
        wolf_vector(vector.input),
      );
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData/Game.dat.wolfx"),
    encrypted_fixture("protected-game"),
  );
  for (const name of ["DataBase", "CDataBase"])
    native.write_file_sync(
      path.join(temp.path, "Data/BasicData", name + ".project"),
      wolf_vector(wolf_crypt_vectors.project.input),
    );
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData/SysDatabase.project.wolfx"),
    encrypted_fixture("protected-project"),
  );
  await prepare_source((await discover_wolf_source(temp.path, native))!, native);
  for (const vector of wolf_crypt_vectors.cores)
    expect(
      fs
        .readFileSync(path.join(temp.path, "Data/BasicData", vector.name))
        .equals(wolf_vector(vector.output)),
    ).toBe(true);
  for (const name of ["DataBase", "CDataBase", "SysDatabase"])
    expect(
      fs
        .readFileSync(path.join(temp.path, "Data/BasicData", name + ".project"))
        .equals(wolf_vector(wolf_crypt_vectors.project.output)),
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
    wolf_common(0x91, [wolf_command(122, [wolf_crypt_vectors.ambiguity[0]!], [3000001])]),
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

it("被密文遮蔽的旧明文不能提供自解密候选，无进展时报告路径与阶段", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-shadow-"));
  const native = new NativeFs();
  for (const [name, bytes] of wolf_files())
    native.write_file_sync(path.join(temp.path, name), bytes);
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData/CommonEvent.dat.wolfx"),
    encrypted_fixture("chain-b"),
  );
  native.write_file_sync(
    path.join(temp.path, "Data/BasicData/CommonEvent.dat"),
    wolf_common(0x91, [wolf_command(1000, ["/", "chain-key"], [7])]),
  );
  await expect(
    prepare_source((await discover_wolf_source(temp.path, native))!, native),
  ).rejects.toThrow("CommonEvent.dat.wolfx: WolfX");
});

it.each(["same", "conflict", "missing", "output"])(
  "%s 配套密钥按原字节去重并保留",
  async (mode) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-keys-"));
    const native = new NativeFs(),
      vector = wolf_crypt_vectors.keys.find((key) => key.type === "A1")!;
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
        if (file.includes(path.join(".tmp", "stage")) && file.endsWith(suffix))
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
    await expect(service.prepare_source(entries[0]!)).rejects.toThrow(
      failure === "unsupported"
        ? "crypt=999"
        : failure === "core"
          ? "Missing WOLF companion"
          : "staged read failure",
    );
    expect(fs.readFileSync(path.join(root, "Data.wolf")).equals(packed)).toBe(true);
    expect(fs.readFileSync(path.join(root, "Data/BasicData/CommonEvent.dat"), "utf8")).toBe(
      "original loose",
    );
    expect(fs.existsSync(path.join(root, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(root, "Data/BasicData/Game.dat"))).toBe(false);
  },
);
