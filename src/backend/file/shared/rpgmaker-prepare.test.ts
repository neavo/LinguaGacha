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
    return { writes: ["existing.txt", "new/added.txt"], removes: ["archive.bin"] };
  };
}

it.each(["backup", "backup-cancel", "commit", "remove", "cleanup", "cancel"])(
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
    if (phase === "remove")
      vi.spyOn(native, "unlink").mockImplementationOnce(() => {
        throw new Error("remove failure");
      });
    if (phase === "cleanup")
      vi.spyOn(native, "remove_async").mockRejectedValueOnce(new Error("cleanup failure"));
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
    if (from.includes("backup")) throw new Error("restore failed");
    copy(from, to);
  });
  await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow(
    /Backup:.*backup[\s\S]*Recovery or cleanup failed:.*restore failed[\s\S]*Staging:/u,
  );
  expect(fs.readFileSync(path.join(temp.path, "backup/existing.txt"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, "archive.bin"), "utf8")).toBe("archive");
  expect(fs.readdirSync(temp.path).some((name) => name.startsWith(".linguagacha-game-"))).toBe(
    true,
  );
});

it.each(["case", "directory", "reserved", "parent-case"])(
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
