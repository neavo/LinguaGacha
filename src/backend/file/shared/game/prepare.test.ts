import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { prepare_game_directory, type GamePreparation } from "./prepare";

it.each([
  "success",
  "same-backup",
  "conflict",
  "write-failure",
  "cancel",
  "same-backup-write-failure",
  "same-backup-cancel",
])("载体备份移动与回滚：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-carrier-backup-"));
  const native = new NativeFs(),
    controller = new AbortController();
  const original = path.join(temp.path, "game.exe"),
    backup = path.join(temp.path, "backup_lg/game.exe");
  native.write_file_sync(original, "original carrier");
  if (kind.startsWith("same-backup") || kind === "conflict")
    native.write_file_sync(backup, kind === "conflict" ? "other version" : "original carrier");
  const rename = native.rename.bind(native),
    copy = vi.spyOn(native, "copy_file");
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (kind.endsWith("write-failure") && from.includes(path.join(".tmp", "stage")))
      throw new Error("injected write failure");
    rename(from, to);
    if (kind === "cancel" && to === backup)
      controller.abort(new Error("cancel after carrier move"));
    if (kind === "same-backup-cancel" && to.includes(path.join(".tmp", "rollback")))
      controller.abort(new Error("cancel after carrier move"));
  });
  const task = prepare_game_directory(
    temp.path,
    native,
    async (staging) => {
      native.write_file_sync(path.join(staging, "game.exe"), "engine prefix");
      native.write_file_sync(path.join(staging, "project.binary"), "project");
      return { writes: ["game.exe", "project.binary"], backups: ["game.exe"] };
    },
    controller.signal,
  );
  if (kind === "conflict" || kind.endsWith("write-failure") || kind.endsWith("cancel")) {
    await expect(task).rejects.toThrow(
      kind === "conflict"
        ? "Conflicting game carrier backup"
        : kind.endsWith("cancel")
          ? "cancel after carrier move"
          : "injected write failure",
    );
    expect(fs.readFileSync(original, "utf8")).toBe("original carrier");
    expect(fs.existsSync(path.join(temp.path, "project.binary"))).toBe(false);
    expect(fs.existsSync(backup)).toBe(kind === "conflict" || kind.startsWith("same-backup"));
  } else {
    await task;
    expect(fs.readFileSync(original, "utf8")).toBe("engine prefix");
    expect(fs.readFileSync(backup, "utf8")).toBe("original carrier");
  }
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
  expect(copy).not.toHaveBeenCalled();
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

it.each(["backup", "backup-cancel", "directory", "directory-cancel", "commit", "remove", "cancel"])(
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
    if (phase === "backup" || phase === "backup-cancel" || phase === "remove") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        if (to.includes(path.join(".tmp", "rollback"))) {
          if (phase === "backup" || (phase === "remove" && from.endsWith("archive.bin")))
            throw new Error(phase + " failure");
          rename(from, to);
          if (phase === "backup-cancel") controller.abort(new Error("backup-cancel failure"));
        } else rename(from, to);
      });
    }
    if (phase === "commit" || phase === "cancel") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        rename(from, to);
        if (from.includes(path.join(".tmp", "stage")) && to.endsWith("added.txt")) {
          if (phase === "cancel") controller.abort(new Error("cancel failure"));
          else throw new Error("commit failure");
        }
      });
    }
    await expect(
      prepare_game_directory(temp.path, native, stage, controller.signal),
    ).rejects.toThrow(phase + " failure");
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
  await prepare_game_directory(temp.path, native, async (staging) => {
    const plan = await stage(staging);
    return { ...plan, directories: [...plan.directories, "empty/nested"] }; // 同一目录声明可以合并。
  });
  expect(fs.statSync(path.join(temp.path, "empty/nested")).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(temp.path, "existing-directory/empty")).isDirectory()).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "existing-directory/keep.txt"), "utf8")).toBe("keep");
  expect(fs.readFileSync(path.join(temp.path, "new/added.txt"), "utf8")).toBe("added");
  expect(fs.existsSync(path.join(temp.path, "archive.bin"))).toBe(false);
});

it.each<GamePreparation>([
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
])("文件与目录冲突在备份和正式目录变更前失败：%j", async (plan) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-directory-conflict-"));
  const native = new NativeFs();
  fs.mkdirSync(path.join(temp.path, "existing-directory"));
  fs.writeFileSync(path.join(temp.path, "existing-directory/keep.txt"), "keep");
  fs.writeFileSync(path.join(temp.path, "occupied"), "original");
  const rename = vi.spyOn(native, "rename");
  await expect(
    prepare_game_directory(temp.path, native, async (staging) => {
      for (const name of plan.writes) await native.write_file(path.join(staging, name), "new");
      return plan;
    }),
  ).rejects.toThrow();
  expect(rename).not.toHaveBeenCalled();
  expect(fs.readdirSync(temp.path).sort()).toEqual(["existing-directory", "occupied"]);
  expect(fs.readFileSync(path.join(temp.path, "occupied"), "utf8")).toBe("original");
  expect(fs.readdirSync(path.join(temp.path, "existing-directory"))).toEqual(["keep.txt"]);
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
});

it("目录要求拒绝链接祖先，不在链接目标中创建目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-directory-link-"));
  const root = path.join(temp.path, "game"),
    outside = path.join(temp.path, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, "link"), "junction");
  await expect(
    prepare_game_directory(root, new NativeFs(), async () => ({
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
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Recovery or cleanup failed:.*directory restore failure/u,
  );
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.readdirSync(path.join(temp.path, "existing-directory"))).toEqual(["keep.txt"]);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(true);
  expect(fs.statSync(path.join(temp.path, "empty/nested")).isDirectory()).toBe(true);
});

it("恢复失败保留备份与暂存材料并报告位置", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-recovery-"));
  const stage = fixture(temp.path),
    native = new NativeFs(),
    rename = native.rename.bind(native);
  vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (to.endsWith("added.txt")) throw new Error("commit failed");
    if (from.includes(path.join(".tmp", "rollback"))) throw new Error("restore failed");
    rename(from, to);
  });
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Rollback:.*rollback[\s\S]*Recovery or cleanup failed:.*restore failed[\s\S]*Staging:/u,
  );
  const rollback = ".tmp/rollback";
  expect(fs.readFileSync(path.join(temp.path, rollback, "existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(true);
});

it.each(["remove", "replace", "commit-failure"])(
  "原封装 %s 通过移动保存，唯一副本支持失败回滚",
  async (mode) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-original-copy-"));
    const stage = fixture(temp.path),
      native = new NativeFs();
    const copy = vi.spyOn(native, "copy_file");
    if (mode === "commit-failure") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        if (from.includes(path.join(".tmp", "stage")) && to.endsWith("existing.txt"))
          throw new Error("commit failure");
        rename(from, to);
      });
    }
    const prepare = prepare_game_directory(temp.path, native, async (staging) => {
      const plan = await stage(staging);
      if (mode === "remove") return plan;
      fs.writeFileSync(path.join(staging, "archive.bin"), "launcher");
      return { ...plan, writes: ["archive.bin", ...plan.writes], removes: [] };
    });
    if (mode === "commit-failure") {
      await expect(prepare).rejects.toThrow("commit failure");
      expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
      expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("original");
    } else {
      await prepare;
      expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
      expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
      if (mode === "remove") expect(fs.existsSync(path.join(temp.path, "archive.bin"))).toBe(false);
      else expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("launcher");
    }
    expect(copy).not.toHaveBeenCalled();
  },
);

it("提交后清理失败报告残留位置，保留已完成转换与回滚材料", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-cleanup-"));
  const stage = fixture(temp.path),
    native = new NativeFs();
  vi.spyOn(native, "remove_async").mockRejectedValueOnce(new Error("cleanup failure"));
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Game preparation committed. Cleanup failed:.*\.tmp/u,
  );
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("replacement");
  expect(fs.existsSync(path.join(temp.path, "archive.bin"))).toBe(false);
  expect(fs.readFileSync(path.join(temp.path, ".tmp/rollback/archive.bin"), "utf8")).toBe(
    "archive",
  );
});

it.each(["case", "directory", "reserved"])("提交前拒绝路径冲突 %s 并保留原文件", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-paths-"));
  fs.mkdirSync(path.join(temp.path, "Data"));
  fs.writeFileSync(path.join(temp.path, "Data/keep.txt"), "original");
  const names = [
    kind === "case" ? "Data/KEEP.txt" : kind === "directory" ? "Data" : "backup_lg/a.txt",
  ];
  await expect(
    prepare_game_directory(temp.path, new NativeFs(), async (staging) => {
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
      prepare_game_directory(temp.path, native, async (staging) => {
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
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow();
  expect(stage).not.toHaveBeenCalled();
  expect(fs.readFileSync(keep, "utf8")).toBe("recovery");
});

it("移除缺失目标仍失败，并恢复此前已覆盖和新增的文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-missing-remove-"));
  const native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "old"), "original");
  await expect(
    prepare_game_directory(temp.path, native, async (staging) => {
      native.write_file_sync(path.join(staging, "old"), "replacement");
      native.write_file_sync(path.join(staging, "new"), "added");
      return { writes: ["old", "new"], removes: ["missing"] };
    }),
  ).rejects.toThrow("ENOENT");
  expect(native.read_file(path.join(temp.path, "old")).toString()).toBe("original");
  expect(fs.readdirSync(temp.path)).toEqual(["old"]);
});
