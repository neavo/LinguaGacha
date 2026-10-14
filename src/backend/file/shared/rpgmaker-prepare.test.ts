import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { prepare_game_directory } from "./rpgmaker-prepare";

/** 混合覆盖、新增和移除，直接观察目录事务的恢复结果。 */
function fixture(root: string) {
  fs.writeFileSync(path.join(root, "existing.txt"), "original");
  fs.writeFileSync(path.join(root, "archive.bin"), "archive");
  return async (staging: string) => {
    fs.writeFileSync(path.join(staging, "existing.txt"), "replacement");
    fs.mkdirSync(path.join(staging, "new"));
    fs.writeFileSync(path.join(staging, "new/added.txt"), "added");
    return {
      writes: ["existing.txt", "new/added.txt"],
      removes: ["archive.bin"],
      originals: ["archive.bin"],
    };
  };
}

it.each(["backup", "backup-cancel", "commit", "remove", "original-publish", "cancel"])(
  "%s 失败恢复覆盖、新增及移除目标",
  async (phase) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-rollback-"));
    const stage = fixture(temp.path),
      native = new NativeFs(),
      controller = new AbortController();
    if (phase === "backup")
      vi.spyOn(native, "copy_file").mockImplementationOnce(() => {
        throw new Error("backup failure");
      });
    if (phase === "backup-cancel") {
      const copy = native.copy_file.bind(native);
      vi.spyOn(native, "copy_file").mockImplementation((from, to) => {
        copy(from, to);
        controller.abort(new Error("backup-cancel failure"));
      });
    }
    if (phase === "commit" || phase === "cancel") {
      const copy = native.copy_file_atomic.bind(native);
      vi.spyOn(native, "copy_file_atomic").mockImplementation((from, to) => {
        copy(from, to);
        if (from.includes(".linguagacha-game-") && to.endsWith("added.txt")) {
          if (phase === "cancel") controller.abort(new Error("cancel failure"));
          else throw new Error("commit failure");
        }
      });
    }
    if (phase === "original-publish") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        if (to === path.join(temp.path, ".lg-original"))
          throw new Error("original-publish failure");
        rename(from, to);
      });
    }
    if (phase === "remove")
      vi.spyOn(native, "unlink").mockImplementationOnce(() => {
        throw new Error("remove failure");
      });
    await expect(
      prepare_game_directory(temp.path, native, stage, controller.signal),
    ).rejects.toThrow(phase + " failure");
    expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("original");
    expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
    expect(fs.existsSync(path.join(temp.path, "new"))).toBe(false);
    expect(fs.readdirSync(temp.path).some((name) => name.startsWith(".linguagacha-game-"))).toBe(
      false,
    );
  },
);

it("恢复失败保留备份与暂存材料并报告位置", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-recovery-"));
  const stage = fixture(temp.path),
    native = new NativeFs(),
    copy = native.copy_file_atomic.bind(native);
  vi.spyOn(native, "copy_file_atomic").mockImplementation((from, to) => {
    if (to.endsWith("added.txt")) throw new Error("commit failed");
    if (from.includes(".linguagacha-rollback-")) throw new Error("restore failed");
    copy(from, to);
  });
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Rollback:.*rollback-[\s\S]*Recovery or cleanup failed:.*restore failed[\s\S]*Staging:/u,
  );
  const rollback = fs
    .readdirSync(temp.path)
    .find((name) => name.startsWith(".linguagacha-rollback-"))!;
  expect(fs.readFileSync(path.join(temp.path, rollback, "existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.readdirSync(temp.path).some((name) => name.startsWith(".linguagacha-game-"))).toBe(
    true,
  );
});

it.each(["remove", "replace", "commit-failure"])(
  "原封装 %s 仅复制一次，唯一副本支持留存或回滚",
  async (mode) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-original-copy-"));
    const stage = fixture(temp.path),
      native = new NativeFs();
    const copy = vi.spyOn(native, "copy_file");
    if (mode === "commit-failure") {
      const replace = native.copy_file_atomic.bind(native);
      vi.spyOn(native, "copy_file_atomic").mockImplementation((from, to) => {
        if (from.includes(".linguagacha-game-") && to.endsWith("existing.txt"))
          throw new Error("commit failure");
        replace(from, to);
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
      expect(fs.readFileSync(path.join(temp.path, ".lg-original/archive.bin"), "utf8")).toBe(
        "archive",
      );
      expect(
        fs
          .readdirSync(temp.path)
          .filter((name) => name.startsWith(".linguagacha-") || name.startsWith(".lg-original-")),
      ).toEqual([]);
    }
    expect(
      copy.mock.calls.filter(([from]) => from === path.join(temp.path, "archive.bin")),
    ).toHaveLength(1);
    expect(
      copy.mock.calls.filter(([from]) => from === path.join(temp.path, "existing.txt")),
    ).toHaveLength(1);
  },
);

it("提交后清理失败报告残留位置，保留已完成转换和原始封装", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-cleanup-"));
  const stage = fixture(temp.path),
    native = new NativeFs();
  vi.spyOn(native, "remove_async").mockRejectedValueOnce(new Error("cleanup failure"));
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Game preparation committed. Cleanup failed:.*\.linguagacha-game-/u,
  );
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("replacement");
  expect(fs.existsSync(path.join(temp.path, "archive.bin"))).toBe(false);
  expect(fs.readFileSync(path.join(temp.path, ".lg-original/archive.bin"), "utf8")).toBe("archive");
});

it.each([".linguagacha-backup", ".lg-original"])("新封装转换拒绝已有 %s", async (directory) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-prepare-conflict-"));
  const stage = fixture(temp.path),
    native = new NativeFs();
  fs.mkdirSync(path.join(temp.path, directory));
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    "Game conversion conflicts",
  );
  expect(fs.readFileSync(path.join(temp.path, "existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.readdirSync(path.join(temp.path, directory))).toEqual([]);
});

it.each(["case", "directory", "reserved", "original", "original-staging", "parent-case"])(
  "提交前拒绝路径冲突 %s 并保留原文件",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-paths-"));
    fs.mkdirSync(path.join(temp.path, "Data"));
    fs.writeFileSync(path.join(temp.path, "Data/keep.txt"), "original");
    const names =
      kind === "case"
        ? ["Data/KEEP.txt"]
        : kind === "directory"
          ? ["Data"]
          : kind === "reserved"
            ? ["backup/a.txt"]
            : kind === "original"
              ? [".lg-original/a.txt"]
              : kind === "original-staging"
                ? [".lg-original-temp/a.txt"]
                : ["New/a.txt", "new/b.txt"];
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
  },
);

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
