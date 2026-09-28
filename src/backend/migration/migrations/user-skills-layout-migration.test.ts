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
    const failure = Object.assign(new Error("rename failed"), { code: "ENOENT" }); // 搬迁阶段的缺失仍需记录警告。
    vi.spyOn(default_native_fs, "rename").mockImplementationOnce(() => {
      throw failure;
    });

    await fixture.run();
    expect(fixture.warning).toHaveBeenCalledWith(expect.any(String), {
      source: "migration",
      error: failure,
    });
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

  it.each(["missing", "broken-link"])("旧入口为 %s 时静默保留现场", async (kind) => {
    using fixture = create_fixture();
    if (kind === "broken-link")
      create_link(fixture.source, path.join(fixture.root, "missing"), "absolute");
    await fixture.run();
    expect(fixture.warning).not.toHaveBeenCalled();
    if (kind === "broken-link") expect(fs.lstatSync(fixture.source).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(fixture.destination)).toBe(false);
  });

  it.each(["directory", "file", "broken-link"])("当前入口为 %s 时静默保留双方", async (kind) => {
    using fixture = create_fixture();
    write_file(path.join(fixture.source, "old.txt"), "old");
    if (kind === "directory") write_file(path.join(fixture.destination, "new.txt"), "new");
    else if (kind === "file") write_file(fixture.destination, "new");
    else
      default_native_fs.create_directory_link(
        path.join(fixture.root, "missing"),
        fixture.destination,
      );

    await fixture.run();
    expect(fixture.warning).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(fixture.source, "old.txt"), "utf8")).toBe("old");
    if (kind === "directory")
      expect(fs.readFileSync(path.join(fixture.destination, "new.txt"), "utf8")).toBe("new");
    else if (kind === "file") expect(fs.readFileSync(fixture.destination, "utf8")).toBe("new");
    else expect(fs.lstatSync(fixture.destination).isSymbolicLink()).toBe(true);
  });

  it.each(["absolute", "relative"] as const)("%s 目录链接迁移后指向原技能目录", async (kind) => {
    using fixture = create_fixture();
    const target = path.join(fixture.root, "external");
    write_file(path.join(target, "SKILL.md"), "skill");
    create_link(fixture.source, target, kind);

    await fixture.run();
    expect(fs.existsSync(fixture.source)).toBe(false);
    expect(fs.lstatSync(fixture.destination).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(fixture.destination)).toBe(fs.realpathSync(target));
  });

  it("相对链接新入口创建后清理失败，记录警告并在下次启动保留双方", async () => {
    using fixture = create_fixture();
    const target = path.join(fixture.root, "external");
    write_file(path.join(target, "SKILL.md"), "skill");
    create_link(fixture.source, target, "relative");
    const failure = new Error("unlink failed");
    vi.spyOn(default_native_fs, "unlink").mockImplementationOnce(() => {
      throw failure;
    });

    await fixture.run();
    expect(fixture.warning).toHaveBeenCalledWith(expect.any(String), {
      source: "migration",
      error: failure,
    });
    expect(fs.realpathSync(fixture.source)).toBe(fs.realpathSync(target));
    expect(fs.realpathSync(fixture.destination)).toBe(fs.realpathSync(target));

    fixture.warning.mockClear();
    await fixture.run();
    expect(fixture.warning).not.toHaveBeenCalled();
    expect(fs.realpathSync(fixture.source)).toBe(fs.realpathSync(target));
    expect(fs.lstatSync(fixture.destination).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(fixture.destination, "SKILL.md"), "utf8")).toBe("skill");
  });

  it("新链接依赖旧链接时保留双方，新入口继续可用", async () => {
    using fixture = create_fixture();
    const target = path.join(fixture.root, "external");
    write_file(path.join(target, "SKILL.md"), "skill");
    create_link(fixture.source, target, "absolute");
    create_link(fixture.destination, fixture.source, "relative");
    await fixture.run();
    expect(fixture.warning).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(fixture.destination, "SKILL.md"), "utf8")).toBe("skill");
  });

  it("旧入口为文件时记录警告并保留入口", async () => {
    using fixture = create_fixture();
    write_file(fixture.source, "old");
    await fixture.run();
    expect(fixture.warning).toHaveBeenCalledWith(expect.any(String), {
      source: "migration",
      error: expect.objectContaining({ code: "file.invalid_structure" }),
    });
    expect(fs.readFileSync(fixture.source, "utf8")).toBe("old");
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
  const warning = vi.fn<LogManager["warning"]>();
  return {
    root: temporary.path,
    source,
    destination,
    warning,
    /** 按启动钩子的实际返回值执行迁移。 */
    run() {
      return user_skills_layout_migration.run_startup?.({
        paths,
        log_manager: { warning } as unknown as LogManager,
      });
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
