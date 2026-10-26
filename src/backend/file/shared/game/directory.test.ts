import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { write_game_directory, type GameDirectoryChanges } from "./directory";
import { GameDirectoryOperations } from "./game-directory-operations";

it.each(["writing", "garbage"])("阶段切换到 %s 失败保留明确结果", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-phase-"));
  const native = new NativeFs(),
    rename = native.rename.bind(native);
  native.write_file_sync(path.join(temp.path, "original"), "old");
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (path.basename(path.dirname(to)) === phase) throw new Error("phase failure");
    rename(from, to);
  });
  await expect(
    write_game_directory(temp.path, native, async (staging) => {
      native.write_file_sync(path.join(staging, "original"), "new");
      return { writes: ["original"] };
    }),
  ).rejects.toThrow(phase === "garbage" ? "Final state unconfirmed" : "phase failure");
  expect(native.read_text_file(path.join(temp.path, "original"))).toBe(
    phase === "garbage" ? "new" : "old",
  );
  if (phase === "garbage") {
    const stage = vi.fn(async () => ({ writes: [] }));
    await expect(write_game_directory(temp.path, native, stage)).rejects.toThrow(
      "Unfinished game operation",
    );
    expect(stage).not.toHaveBeenCalled();
  }
});

/** 混合覆盖、新增和移除，直接观察目录事务的恢复结果。 */
function fixture(root: string) {
  fs.mkdirSync(path.join(root, "existing-directory"));
  fs.writeFileSync(path.join(root, "existing-directory/keep.txt"), "keep");
  fs.writeFileSync(path.join(root, "existing.txt"), "original");
  fs.writeFileSync(path.join(root, "archive.bin"), "archive");
  return async (staging: string) => {
    fs.writeFileSync(path.join(staging, "existing.txt"), "replacement");
    fs.mkdirSync(path.join(staging, "new"));
    fs.writeFileSync(path.join(staging, "new/added.txt"), "added");
    return {
      writes: ["existing.txt", "new/added.txt"],
      directories: ["empty/nested", "existing-directory/empty"],
      removes: ["archive.bin"],
    };
  };
}

it.each(["save", "save-cancel", "directory", "directory-cancel", "commit", "remove", "cancel"])(
  "%s 失败恢复覆盖、新增及移除目标",
  async (phase) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-rollback-"));
    const stage = fixture(temp.path),
      native = new NativeFs(),
      controller = new AbortController();
    if (phase === "directory" || phase === "directory-cancel") {
      const create = native.make_dir_exclusive.bind(native);
      vi.spyOn(native, "make_dir_exclusive").mockImplementation(async (directory) => {
        if (phase === "directory" && directory === path.join(temp.path, "empty/nested"))
          throw new Error("directory failure");
        await create(directory);
        if (phase === "directory-cancel" && directory === path.join(temp.path, "empty"))
          controller.abort(new Error("directory-cancel failure"));
      });
    }
    if (phase === "save" || phase === "save-cancel" || phase === "remove") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        if (to.includes(path.sep + "rollback" + path.sep)) {
          if (phase === "save" || (phase === "remove" && from.endsWith("archive.bin")))
            throw new Error(phase + " failure");
          rename(from, to);
          if (phase === "save-cancel") controller.abort(new Error("save-cancel failure"));
        } else rename(from, to);
      });
    }
    if (phase === "commit" || phase === "cancel") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        rename(from, to);
        if (from.includes(path.sep + "stage" + path.sep) && to.endsWith("added.txt")) {
          if (phase === "cancel") controller.abort(new Error("cancel failure"));
          else throw new Error("commit failure");
        }
      });
    }
    await expect(write_game_directory(temp.path, native, stage, controller.signal)).rejects.toThrow(
      phase + " failure",
    );
    expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("original");
    expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
    expect(fs.existsSync(path.join(temp.path, "new"))).toBe(false);
    expect(fs.existsSync(path.join(temp.path, "empty"))).toBe(false);
    expect(fs.readdirSync(path.join(temp.path, "existing-directory"))).toEqual(["keep.txt"]);
    expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
  },
);

it("显式空目录和文件父目录统一创建，已有目录复用且不依赖暂存空目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-directories-"));
  const native = new NativeFs(),
    stage = fixture(temp.path);
  const copy = vi.spyOn(native, "copy_file");
  await write_game_directory(temp.path, native, async (staging) => {
    const plan = await stage(staging);
    return { ...plan, directories: [...plan.directories, "empty/nested"] }; // 同一目录声明可以合并。
  });
  expect(fs.statSync(path.join(temp.path, "empty/nested")).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(temp.path, "existing-directory/empty")).isDirectory()).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "existing-directory/keep.txt"), "utf8")).toBe("keep");
  expect(fs.readFileSync(path.join(temp.path, "new/added.txt"), "utf8")).toBe("added");
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("replacement");
  expect(fs.existsSync(path.join(temp.path, "archive.bin"))).toBe(false);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
  expect(copy).not.toHaveBeenCalled(); // 大载体通过同卷移动保留回滚材料。
});

it.each<GameDirectoryChanges>([
  { writes: ["added.txt", "added.txt"] },
  { writes: [], removes: ["occupied", "occupied"] },
  { writes: ["occupied"], removes: ["occupied"] },
  { writes: ["added.txt"], directories: ["occupied"] },
  { writes: ["added.txt"], directories: ["occupied/nested"] },
  { writes: ["occupied/nested.txt"] },
  { writes: ["new"], directories: ["new"] },
  { writes: ["new"], directories: ["new/nested"] },
  { writes: ["added.txt"], removes: ["occupied"], directories: ["occupied/nested"] },
  { writes: ["existing-directory"] },
  { writes: ["added.txt"], directories: ["Existing-directory/new"] },
  { writes: ["added.txt"], directories: ["new", "New/nested"] },
  { writes: ["added.txt"], directories: ["../outside"] },
  { writes: ["added.txt"], directories: ["new/"] },
  { writes: ["added.txt"], directories: ["backup_lg/new"] },
])("重复目标或文件与目录冲突在正式目录变更前失败：%j", async (plan) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-directory-conflict-"));
  const native = new NativeFs();
  fs.mkdirSync(path.join(temp.path, "existing-directory"));
  fs.writeFileSync(path.join(temp.path, "existing-directory/keep.txt"), "keep");
  fs.writeFileSync(path.join(temp.path, "occupied"), "original");
  const rename = vi.spyOn(native, "rename");
  await expect(
    write_game_directory(temp.path, native, async (staging) => {
      for (const name of plan.writes) await native.write_file(path.join(staging, name), "new");
      return plan;
    }),
  ).rejects.toThrow();
  expect(
    rename.mock.calls.every(
      ([from, to]) =>
        from.includes(path.sep + ".tmp" + path.sep) && to.includes(path.sep + ".tmp" + path.sep),
    ),
  ).toBe(true);
  expect(fs.readdirSync(temp.path).sort()).toEqual(["existing-directory", "occupied"]);
  expect(fs.readFileSync(path.join(temp.path, "occupied"), "utf8")).toBe("original");
  expect(fs.readdirSync(path.join(temp.path, "existing-directory"))).toEqual(["keep.txt"]);
});

it("目录要求拒绝链接祖先，不在链接目标中创建目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-directory-link-"));
  const root = path.join(temp.path, "game"),
    outside = path.join(temp.path, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, "link"), "junction");
  await expect(
    write_game_directory(root, new NativeFs(), async () => ({
      writes: [],
      directories: ["link/empty"],
    })),
  ).rejects.toThrow("Unsafe game filesystem path");
  expect(fs.readdirSync(outside)).toEqual([]);
  expect(fs.lstatSync(path.join(root, "link")).isSymbolicLink()).toBe(true);
});

it("空目录回滚失败保留恢复材料，原文件和已有目录已经恢复", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-directory-recovery-"));
  const native = new NativeFs(),
    stage = fixture(temp.path);
  const rename = native.rename.bind(native);
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (from === path.join(temp.path, "archive.bin")) throw new Error("remove failure");
    rename(from, to);
  });
  const remove = native.remove_empty_dir.bind(native);
  vi.spyOn(native, "remove_empty_dir").mockImplementation((directory) => {
    if (directory === path.join(temp.path, "empty/nested"))
      throw new Error("directory restore failure");
    remove(directory);
  });
  await expect(write_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Recovery or cleanup failed:.*directory restore failure/u,
  );
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.readdirSync(path.join(temp.path, "existing-directory"))).toEqual(["keep.txt"]);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(true);
  expect(fs.statSync(path.join(temp.path, "empty/nested")).isDirectory()).toBe(true);
});

it("恢复失败保留回滚与暂存材料并报告位置", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-recovery-"));
  const stage = fixture(temp.path),
    native = new NativeFs(),
    rename = native.rename.bind(native);
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (to.endsWith("added.txt")) throw new Error("commit failed");
    if (from.includes(path.sep + "rollback" + path.sep)) throw new Error("restore failed");
    rename(from, to);
  });
  await expect(write_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Rollback:.*rollback[\s\S]*Recovery or cleanup failed:.*restore failed[\s\S]*Staging:/u,
  );
  const rollback = path.join(
    ".tmp",
    "writing",
    fs.readdirSync(path.join(temp.path, ".tmp/writing"))[0]!,
    "rollback",
  );
  expect(fs.readFileSync(path.join(temp.path, rollback, "existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(true);
});

it("提交后清理失败保留终态材料，下次操作可以回收并继续", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-cleanup-"));
  const stage = fixture(temp.path),
    native = new NativeFs();
  const log = { warning: vi.fn() };
  const operations = new GameDirectoryOperations(native, log);
  vi.spyOn(native, "remove_async").mockRejectedValueOnce(new Error("cleanup failure"));
  await write_game_directory(temp.path, native, stage, undefined, operations.report_cleanup);
  expect(log.warning).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
    source: "game_directory",
    context: { directory: expect.stringContaining(path.join(".tmp", "garbage")) },
    error: expect.objectContaining({ message: "cleanup failure" }),
    targets: { window: false },
  });
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("replacement");
  expect(fs.existsSync(path.join(temp.path, "archive.bin"))).toBe(false);
  const execution = fs.readdirSync(path.join(temp.path, ".tmp/garbage"))[0]!;
  expect(
    fs.readFileSync(
      path.join(temp.path, ".tmp/garbage", execution, "rollback/archive.bin"),
      "utf8",
    ),
  ).toBe("archive");
  await write_game_directory(temp.path, native, async (staging) => {
    native.write_file_sync(path.join(staging, "next.txt"), "next");
    return { writes: ["next.txt"] };
  });
  expect(native.read_text_file(path.join(temp.path, "next.txt"))).toBe("next");
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it.each(["case", "directory", "reserved"])("提交前拒绝路径冲突 %s 并保留原文件", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-paths-"));
  fs.mkdirSync(path.join(temp.path, "Data"));
  fs.writeFileSync(path.join(temp.path, "Data/keep.txt"), "original");
  const names = [
    kind === "case" ? "Data/KEEP.txt" : kind === "directory" ? "Data" : "backup_lg/a.txt",
  ];
  await expect(
    write_game_directory(temp.path, new NativeFs(), async (staging) => {
      for (const name of names) {
        const target = path.join(staging, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "new");
      }
      return { writes: names };
    }),
  ).rejects.toThrow();
  expect(fs.readFileSync(path.join(temp.path, "Data/keep.txt"), "utf8")).toBe("original");
  expect(fs.readdirSync(temp.path)).toEqual(["Data"]);
});

it.each([{ names: ["Keep.txt", "keep.txt"] }, { names: ["keep.txt", "Keep.txt"] }])(
  "磁盘同名多种拼写不能被索引覆盖：%j",
  async ({ names }) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-case-index-"));
    const native = new NativeFs();
    fs.writeFileSync(path.join(temp.path, "keep.txt"), "original");
    const read = native.read_dirents.bind(native);
    vi.spyOn(native, "read_dirents").mockImplementation((directory) => {
      const entries = read(directory);
      if (directory !== temp.path) return entries;
      const original = entries.find((entry) => entry.name === "keep.txt")!;
      // Windows 通常不允许同目录多种拼写，仅替换目录枚举以覆盖跨平台冲突。
      return names.map((name) =>
        Object.assign(Object.create(Object.getPrototypeOf(original)), original, { name }),
      );
    });
    await expect(
      write_game_directory(temp.path, native, async (staging) => {
        fs.writeFileSync(path.join(staging, "keep.txt"), "translated");
        return { writes: ["keep.txt"] };
      }),
    ).rejects.toThrow("Game path differs only by case");
    expect(fs.readFileSync(path.join(temp.path, "keep.txt"), "utf8")).toBe("original");
  },
);

it("已有根目录工作区不被准备流程接管或清理", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-exclusive-"));
  const native = new NativeFs(),
    keep = path.join(temp.path, ".tmp/keep");
  native.write_file_sync(keep, "recovery");
  const stage = vi.fn(async () => ({ writes: [] }));
  await expect(write_game_directory(temp.path, native, stage)).rejects.toThrow();
  expect(stage).not.toHaveBeenCalled();
  expect(fs.readFileSync(keep, "utf8")).toBe("recovery");
});

it("移除缺失目标仍失败，并恢复此前已覆盖和新增的文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-missing-remove-"));
  const native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "old"), "original");
  await expect(
    write_game_directory(temp.path, native, async (staging) => {
      native.write_file_sync(path.join(staging, "old"), "replacement");
      native.write_file_sync(path.join(staging, "new"), "added");
      return { writes: ["old", "new"], removes: ["missing"] };
    }),
  ).rejects.toThrow("ENOENT");
  expect(native.read_file(path.join(temp.path, "old")).toString()).toBe("original");
  expect(fs.readdirSync(temp.path)).toEqual(["old"]);
});

it.each(["stage", "commit", "cancel"])("新输出目录在 %s 失败后清理本轮目录", async (failure) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-new-output-"));
  const native = new NativeFs(),
    controller = new AbortController();
  const root = path.join(temp.path, "output/game");
  const rename = native.rename.bind(native);
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (failure === "commit" && to.endsWith("second")) throw new Error("injected commit");
    rename(from, to);
    if (failure === "cancel") controller.abort(new Error("injected cancel"));
  });
  await expect(
    write_game_directory(
      root,
      native,
      async (staging) => {
        native.write_file_sync(path.join(staging, "first"), "one");
        native.write_file_sync(path.join(staging, "second"), "two");
        if (failure === "stage") throw new Error("injected stage");
        return { writes: ["first", "second"] };
      },
      controller.signal,
    ),
  ).rejects.toThrow("injected");
  expect(fs.readdirSync(temp.path)).toEqual([]);
});
