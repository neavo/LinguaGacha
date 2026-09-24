import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { default_native_fs } from "../../../native/native-fs";
import { AppPathService } from "../../app/app-path-service";
import type { LogManager } from "../../log/log-manager";
import { user_skills_layout_migration } from "./user-skills-layout-migration";

afterEach(() => vi.restoreAllMocks());

describe("user_skills_layout_migration", () => {
  it("按数据根迁移完整技能目录，搬移失败后可重试并重复启动", async () => {
    using fixture = create_fixture();
    write_file(path.join(fixture.source, "fixture", "SKILL.md"), "skill");
    write_file(path.join(fixture.source, "fixture", "scripts", "run.mjs"), "script");
    write_file(path.join(fixture.source, ".gitignore"), "ignored/");
    const workspace = path.join(path.dirname(fixture.source), "workspace", "work", "note.txt");
    write_file(workspace, "work");
    const failure = new Error("rename failed");
    vi.spyOn(default_native_fs, "rename").mockImplementationOnce(() => {
      throw failure;
    });

    await expect(fixture.run()).rejects.toMatchObject({ cause: failure });
    expect(fs.readFileSync(path.join(fixture.source, "fixture", "SKILL.md"), "utf8")).toBe("skill");
    expect(fs.existsSync(fixture.destination)).toBe(false);

    await fixture.run();
    await fixture.run();

    expect(fs.existsSync(fixture.source)).toBe(false);
    expect(fs.readFileSync(path.join(fixture.destination, "fixture", "SKILL.md"), "utf8")).toBe(
      "skill",
    );
    expect(
      fs.readFileSync(path.join(fixture.destination, "fixture", "scripts", "run.mjs"), "utf8"),
    ).toBe("script");
    expect(fs.readFileSync(path.join(fixture.destination, ".gitignore"), "utf8")).toBe("ignored/");
    expect(fs.readFileSync(workspace, "utf8")).toBe("work");
  });

  it("没有旧入口时由运行期按需创建新目录", async () => {
    using fixture = create_fixture();
    await fixture.run();
    expect(fs.existsSync(fixture.destination)).toBe(false);
  });

  it.each(["directory", "file", "broken-link"])("目标为 %s 时保留双方并报告冲突", async (kind) => {
    using fixture = create_fixture();
    write_file(path.join(fixture.source, "old.txt"), "old");
    if (kind === "directory") write_file(path.join(fixture.destination, "new.txt"), "new");
    else if (kind === "file") write_file(fixture.destination, "new");
    else
      default_native_fs.create_directory_link(
        path.join(fixture.root, "missing"),
        fixture.destination,
      );

    await expect(fixture.run()).rejects.toMatchObject({
      code: "file.io_failed",
      cause: { code: "file.already_exists" },
    });
    expect(fs.readFileSync(path.join(fixture.source, "old.txt"), "utf8")).toBe("old");
    if (kind === "directory")
      expect(fs.readFileSync(path.join(fixture.destination, "new.txt"), "utf8")).toBe("new");
    else if (kind === "file") expect(fs.readFileSync(fixture.destination, "utf8")).toBe("new");
    else expect(fs.lstatSync(fixture.destination).isSymbolicLink()).toBe(true);
  });

  it("绝对目录链接迁移后指向原技能目录", async () => {
    using fixture = create_fixture();
    const target = path.join(fixture.root, "external");
    write_file(path.join(target, "SKILL.md"), "skill");
    create_link(fixture.source, target, "absolute");

    await fixture.run();
    expect(fs.existsSync(fixture.source)).toBe(false);
    expect(fs.lstatSync(fixture.destination).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(fixture.destination)).toBe(fs.realpathSync(target));
  });

  it("相对链接新入口创建后清理失败，下次启动完成迁移", async () => {
    using fixture = create_fixture();
    const target = path.join(fixture.root, "external");
    write_file(path.join(target, "SKILL.md"), "skill");
    create_link(fixture.source, target, "relative");
    const failure = new Error("unlink failed");
    vi.spyOn(default_native_fs, "unlink").mockImplementationOnce(() => {
      throw failure;
    });

    await expect(fixture.run()).rejects.toMatchObject({ cause: failure });
    expect(fs.realpathSync(fixture.source)).toBe(fs.realpathSync(target));
    expect(fs.realpathSync(fixture.destination)).toBe(fs.realpathSync(target));

    await fixture.run();
    expect(fs.existsSync(fixture.source)).toBe(false);
    expect(fs.lstatSync(fixture.destination).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(fixture.destination, "SKILL.md"), "utf8")).toBe("skill");
  });

  it("新链接依赖旧链接时按冲突保留，避免清理后破坏新入口", async () => {
    using fixture = create_fixture();
    const target = path.join(fixture.root, "external");
    write_file(path.join(target, "SKILL.md"), "skill");
    create_link(fixture.source, target, "absolute");
    create_link(fixture.destination, fixture.source, "relative");
    await expect(fixture.run()).rejects.toMatchObject({ cause: { code: "file.already_exists" } });
    expect(fs.readFileSync(path.join(fixture.destination, "SKILL.md"), "utf8")).toBe("skill");
  });

  it.each(["file", "broken-link"])("旧入口为 %s 时报告失败并保留入口", async (kind) => {
    using fixture = create_fixture();
    if (kind === "file") write_file(fixture.source, "old");
    else create_link(fixture.source, path.join(fixture.root, "missing"), "absolute");
    await expect(fixture.run()).rejects.toMatchObject({
      cause: { code: kind === "file" ? "file.invalid_structure" : "ENOENT" },
    });
    if (kind === "file") expect(fs.readFileSync(fixture.source, "utf8")).toBe("old");
    else expect(fs.lstatSync(fixture.source).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(fixture.destination)).toBe(false);
  });
});

/** 使用独立数据根和临时目录验证迁移落点，退出用例时统一清理。 */
function create_fixture() {
  const temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-skills-migration-"));
  const paths = new AppPathService({
    appRoot: path.join(temporary.path, "app"),
    builtinRoot: path.join(temporary.path, "builtin"),
  });
  // 数据根独立于安装根，避免迁移只在便携布局下成立。
  vi.spyOn(paths, "get_data_root").mockReturnValue(path.join(temporary.path, "data"));
  const source = paths.get_user_data_path("agent", "skill");
  const destination = paths.get_agent_user_skill_dir();
  return {
    root: temporary.path,
    source,
    destination,
    /** 把同步迁移结果统一交给异步断言。 */
    async run() {
      await user_skills_layout_migration.run_startup?.({ paths, log_manager: {} as LogManager });
    },
    [Symbol.dispose]: temporary[Symbol.dispose],
  };
}

/** 写入测试自有文件并补齐父目录。 */
function write_file(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Unix 使用真实相对链接，Windows 通过 junction 验证文件操作。 */
function create_link(entry: string, target: string, kind: "absolute" | "relative"): void {
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  if (kind === "relative" && process.platform !== "win32") {
    fs.symlinkSync(path.relative(path.dirname(entry), target), entry, "dir");
  } else {
    default_native_fs.create_directory_link(target, entry);
    if (kind === "relative") {
      // Windows 测试通过目标文本模拟相对链接，目录读写与清理使用真实 junction。
      const read_link = default_native_fs.read_link.bind(default_native_fs);
      vi.spyOn(default_native_fs, "read_link").mockImplementation((link) =>
        link === entry ? path.relative(path.dirname(entry), target) : read_link(link),
      );
    }
  }
}
