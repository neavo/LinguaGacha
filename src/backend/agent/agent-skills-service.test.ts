import { RuntimeOperationGate } from "../runtime-operation-gate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { normalize_agent_skill_settings } from "../../domain/agent-skill-settings";
import { AgentSkillsService } from "./agent-skills-service";
import { load_agent_skills } from "./agent-skills";
import { default_native_fs } from "../../native/native-fs";

/** 隔离技能目录和配置文件，使用真实加载与持久化入口。 */
function fixture() {
  const root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-skills-management-"));
  const paths = new AppPathService({
    appRoot: root.path,
    builtinRoot: path.join(root.path, "builtin"),
    env: {},
    platform: "win32",
  });
  fs.mkdirSync(path.dirname(paths.get_config_path()), { recursive: true });
  const publish = vi.fn();
  const settings = new AppSettingService(paths, { publish });
  const log = { warning: vi.fn() };
  const gate = new RuntimeOperationGate();
  const service = new AgentSkillsService(paths, settings, log, gate);
  return {
    [Symbol.dispose]: () => root[Symbol.dispose](),
    paths,
    gate,
    settings,
    service,
    publish,
    log,
    /** 生成测试自有技能包和可选隐藏元数据。 */
    write(source: "builtin" | "user", folder: string, name: string, hidden = false) {
      const base =
        source === "builtin"
          ? paths.get_agent_builtin_skill_dir()
          : paths.get_agent_user_skill_dir();
      const directory = path.join(base, folder);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} description\n---\nBody`,
      );
      if (hidden) fs.writeFileSync(path.join(directory, "ui.json"), '{"visible":false}');
    },
    load: () =>
      load_agent_skills(
        paths,
        log,
        normalize_agent_skill_settings(settings.read_setting().agent_skills),
      ),
  };
}

describe("技能管理", () => {
  it("异步删除持有运行互斥和查询队列，提交偏好时保留等待期间的其它设置", async () => {
    using f = fixture();
    f.write("user", "folder", "sample");
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actual_remove = default_native_fs.remove_async.bind(default_native_fs);
    using remove = vi
      .spyOn(default_native_fs, "remove_async")
      .mockImplementationOnce(async (...args) => {
        started();
        await held;
        await actual_remove(...args);
      });
    const deleting = f.service.delete({ source: "user", name: "sample" });
    await entered;
    expect(() => f.gate.begin_runtime("agent")).toThrow(
      expect.objectContaining({ code: "runtime.busy" }),
    );
    let read_finished = false;
    const reading = f.service.snapshot().then((value) => {
      read_finished = true;
      return value;
    });
    await Promise.resolve();
    expect(read_finished).toBe(false);
    f.settings.save_setting({ ...f.settings.read_setting(), request_timeout: 42 });
    release();
    await deleting;
    expect((await reading).skills).toEqual([]);
    expect(f.settings.read_setting().request_timeout).toBe(42);
    const lease = f.gate.begin_runtime("agent");
    f.gate.finish_runtime(lease);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("递归删除部分完成后失败，集合立即反映主文件已消失的事实", async () => {
    using f = fixture();
    f.write("user", "folder", "sample");
    await f.service.refresh();
    using remove = vi
      .spyOn(default_native_fs, "remove_async")
      .mockImplementationOnce(async (root) => {
        fs.unlinkSync(path.join(root, "SKILL.md"));
        throw Object.assign(new Error("blocked child"), { code: "EPERM" });
      });
    await expect(f.service.delete({ source: "user", name: "sample" })).rejects.toMatchObject({
      code: "file.io_failed",
    });
    expect(f.service.get_current()).toEqual([]);
    expect(fs.existsSync(path.join(f.paths.get_agent_user_skill_dir(), "folder"))).toBe(true);
    const lease = f.gate.begin_runtime("agent");
    f.gate.finish_runtime(lease);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("磁盘删除成功但偏好保存失败，保留原始错误并刷新集合，不回写旧配置", async () => {
    using f = fixture();
    f.write("user", "folder", "sample");
    await f.service.refresh();
    using save = vi.spyOn(f.settings, "save_setting").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(f.service.delete({ source: "user", name: "sample" })).rejects.toMatchObject({
      code: "file.io_failed",
      cause: expect.objectContaining({ message: "disk full" }),
    });
    expect(fs.existsSync(path.join(f.paths.get_agent_user_skill_dir(), "folder"))).toBe(false);
    expect(f.service.get_current()).toEqual([]);
    expect(save).toHaveBeenCalledOnce();
  });

  it("删除整个用户包并清理偏好，同名内置技能恢复可用", async () => {
    using f = fixture();
    f.write("builtin", "builtin-folder", "sample");
    f.write("user", "user-folder", "sample");
    f.write("user", "other-folder", "other");
    const root = path.join(f.paths.get_agent_user_skill_dir(), "user-folder");
    fs.mkdirSync(path.join(root, "references"));
    fs.writeFileSync(path.join(root, "references", "note.md"), "Reference");
    await f.service.reorder({ names: ["sample", "other"] });
    await f.service.set_enabled({ source: "user", name: "sample", enabled: false });
    const result = await f.service.delete({ source: "user", name: "sample" });
    expect(fs.existsSync(root)).toBe(false);
    expect(result.skills.map(({ source, name }) => [source, name])).toEqual([
      ["builtin", "sample"],
      ["user", "other"],
    ]);
    expect(f.settings.read_setting().agent_skills).toEqual({
      disabled: { builtin: [], user: [] },
      user_order: ["other"],
    });
    expect(f.service.get_current().find((skill) => skill.name === "sample")?.filePath).toContain(
      "builtin-folder",
    );
    await expect(f.service.delete({ source: "builtin", name: "sample" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
  });

  it("删除失败保留技能偏好并刷新可重试的当前集合", async () => {
    using f = fixture();
    f.write("user", "folder", "sample");
    await f.service.reorder({ names: ["sample"] });
    const previous = f.settings.read_setting().agent_skills;
    using remove = vi.spyOn(default_native_fs, "remove_async").mockImplementationOnce(async () => {
      throw new Error("Locked file");
    });
    await expect(f.service.delete({ source: "user", name: "sample" })).rejects.toMatchObject({
      code: "file.io_failed",
    });
    expect(f.settings.read_setting().agent_skills).toEqual(previous);
    expect(f.service.get_current().map((skill) => skill.name)).toEqual(["sample"]);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("运行期间拒绝全部技能修改，读取保持可用", async () => {
    using f = fixture();
    f.write("user", "different-folder", "sample");
    const skill = { source: "user", name: "sample" };
    const file = await f.service.read_file({ ...skill, path: "SKILL.md" });
    const lease = f.gate.begin_runtime("agent");
    for (const command of [
      () => f.service.set_enabled({ ...skill, enabled: false }),
      () => f.service.reorder({ names: ["sample"] }),
      () => f.service.delete(skill),
      () =>
        f.service.save_file({
          ...skill,
          path: file.path,
          revision: file.revision,
          document: { ...file.document!, body: "changed" },
        }),
      () => f.service.change_file({ ...skill, operation: "create_file", path: "note.md" }),
    ])
      await expect(command()).rejects.toMatchObject({ code: "runtime.busy" });
    expect((await f.service.read_file({ ...skill, path: "SKILL.md" })).text).toBe(file.text);
    f.gate.finish_runtime(lease);
    await f.service.save_file({
      ...skill,
      path: file.path,
      revision: file.revision,
      document: { ...file.document!, body: "changed" },
    });
    expect((await f.service.read_file({ ...skill, path: "SKILL.md" })).document?.body).toBe(
      "changed",
    );
  });

  it("改名仅按元数据检测冲突，目标同名目录不妨碍保存", async () => {
    using f = fixture();
    f.write("user", "folder", "original");
    f.write("user", "target", "different");
    const file = await f.service.read_file({ source: "user", name: "original", path: "SKILL.md" });
    const saved = await f.service.save_file({
      ...file.skill,
      path: file.path,
      revision: file.revision,
      document: { ...file.document!, name: "target" },
    });
    expect(f.load().find((skill) => skill.name === "target")?.filePath).toBe(
      path.join(f.paths.get_agent_user_skill_dir(), "folder", "SKILL.md").replaceAll("\\", "/"),
    );
    await expect(
      f.service.save_file({
        ...saved.skill,
        path: saved.path,
        revision: saved.revision,
        document: { ...saved.document!, name: "different" },
      }),
    ).rejects.toMatchObject({ code: "file.already_exists" });
  });
  it("启用、排序与同名来源回退原子更新当前集合", async () => {
    using f = fixture();
    f.write("builtin", "shared", "shared");
    f.write("user", "shared", "shared");
    f.write("user", "another", "another");
    await f.service.refresh();
    const original = f.service.get_current();
    const user_path = path
      .join(f.paths.get_agent_user_skill_dir(), "shared", "SKILL.md")
      .replaceAll("\\", "/");
    const builtin_path = path
      .join(f.paths.get_agent_builtin_skill_dir(), "shared", "SKILL.md")
      .replaceAll("\\", "/");
    expect(original.find((skill) => skill.name === "shared")?.filePath).toBe(user_path);

    await f.service.set_enabled({ source: "user", name: "shared", enabled: false });
    const after_disable = f.service.get_current();
    expect(after_disable.find((skill) => skill.name === "shared")?.filePath).toBe(builtin_path);
    expect(original.find((skill) => skill.name === "shared")?.filePath).toBe(user_path);

    await f.service.set_enabled({ source: "user", name: "shared", enabled: true });
    await f.service.reorder({ names: ["shared", "another"] });
    expect(f.service.get_current().map((skill) => skill.name)).toEqual(["shared", "another"]);
    expect(after_disable.find((skill) => skill.name === "shared")?.filePath).toBe(builtin_path);
  });

  it("技能根目录经链接定位后，文件管理与技能改名作用于实际目录", async () => {
    using f = fixture();
    f.write("user", "sample", "sample");
    const entry = f.paths.get_agent_user_skill_dir();
    const storage = path.join(f.paths.get_app_root(), "skill-storage");
    fs.renameSync(entry, storage);
    fs.symlinkSync(storage, entry, "junction");
    const skill = { source: "user", name: "sample" };
    expect((await f.service.tree(skill)).entries).toEqual([{ path: "SKILL.md", kind: "file" }]);
    await f.service.change_file({ ...skill, operation: "create_directory", path: "references" });
    await f.service.change_file({ ...skill, operation: "create_file", path: "references/note.md" });
    const note = await f.service.read_file({ ...skill, path: "references/note.md" });
    await f.service.save_file({
      ...skill,
      path: note.path,
      revision: note.revision,
      text: "Saved through link\n",
    });
    await f.service.change_file({
      ...skill,
      operation: "move",
      path: note.path,
      destination: "note.md",
    });
    expect(fs.readFileSync(path.join(storage, "sample/note.md"), "utf8")).toBe(
      "Saved through link\n",
    );
    await f.service.change_file({ ...skill, operation: "delete", path: "references" });
    const main = await f.service.read_file({ ...skill, path: "SKILL.md" });
    await f.service.save_file({
      ...skill,
      path: main.path,
      revision: main.revision,
      document: { ...main.document!, name: "renamed" },
    });
    expect((await f.service.snapshot()).skills).toMatchObject([{ name: "renamed" }]);
    expect(fs.readFileSync(path.join(storage, "sample/note.md"), "utf8")).toBe(
      "Saved through link\n",
    );
    expect(fs.lstatSync(entry).isSymbolicLink()).toBe(true);
  });
  it("内置技能允许读取，拒绝正文保存与文件管理", async () => {
    using f = fixture();
    f.write("builtin", "sample", "sample");
    const skill = { source: "builtin", name: "sample" };
    const file = await f.service.read_file({ ...skill, path: "SKILL.md" });
    await expect(
      f.service.save_file({
        ...skill,
        path: file.path,
        revision: file.revision,
        document: { ...file.document!, body: "changed" },
      }),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
    await expect(
      f.service.change_file({ ...skill, operation: "create_file", path: "new.md" }),
    ).rejects.toMatchObject({ code: "request.validation_failed" });
  });

  it("并发保存拒绝旧版本覆盖", async () => {
    using f = fixture();
    f.write("user", "sample", "sample");
    const skill = { source: "user", name: "sample" };
    const root = path.join(f.paths.get_agent_user_skill_dir(), "sample");
    fs.writeFileSync(path.join(root, "note.md"), "initial");
    const file = await f.service.read_file({ ...skill, path: "note.md" });
    const results = await Promise.allSettled(
      ["first", "second"].map((text) =>
        f.service.save_file({ ...skill, path: file.path, revision: file.revision, text }),
      ),
    );
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "data.revision_conflict" },
    });
    expect(fs.readFileSync(path.join(root, "note.md"), "utf8")).toBe("first");
  });

  it("技能改名保留目录并迁移启用状态和顺序", async () => {
    using f = fixture();
    f.write("user", "before", "before");
    const skill = { source: "user", name: "before" };
    await f.service.set_enabled({ ...skill, enabled: false });
    await f.service.reorder({ names: ["before"] });
    const file = await f.service.read_file({ ...skill, path: "SKILL.md" });
    const saved = await f.service.save_file({
      ...skill,
      path: file.path,
      revision: file.revision,
      document: { name: "after", description: "A: description", body: "\nbody\n" },
    });
    expect(saved.skill.name).toBe("after");
    expect((await f.service.snapshot()).skills).toMatchObject([{ name: "after", enabled: false }]);
    expect(f.settings.read_setting().agent_skills).toEqual({
      disabled: { builtin: [], user: ["after"] },
      user_order: ["after"],
    });
    expect(fs.existsSync(path.join(f.paths.get_agent_user_skill_dir(), "before"))).toBe(true);
    await f.service.set_enabled({ source: "user", name: "after", enabled: true });
    expect(f.load().map((item) => item.name)).toEqual(["after"]);
  });

  it("改名配置写入失败恢复原正文和偏好", async () => {
    using f = fixture();
    f.write("user", "before", "before");
    const skill = { source: "user", name: "before" };
    const file = await f.service.read_file({ ...skill, path: "SKILL.md" });
    vi.spyOn(f.settings, "save_setting").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(
      f.service.save_file({
        ...skill,
        path: file.path,
        revision: file.revision,
        document: { name: "after", description: "description", body: "changed" },
      }),
    ).rejects.toMatchObject({ code: "file.io_failed" });
    expect((await f.service.read_file({ ...skill, path: "SKILL.md" })).text).toBe(file.text);
    expect(fs.existsSync(path.join(f.paths.get_agent_user_skill_dir(), "after"))).toBe(false);
  });

  it("按来源独立保存开关，同名用户技能优先，关闭后回退到内置技能", async () => {
    using f = fixture();
    f.write("builtin", "shared", "shared");
    f.write("user", "shared", "shared");
    const snapshot = await f.service.snapshot();
    expect(snapshot.skills.map(({ name, source, enabled }) => ({ name, source, enabled }))).toEqual(
      [
        { name: "shared", source: "builtin", enabled: true },
        { name: "shared", source: "user", enabled: true },
      ],
    );
    const user_path = path
      .join(f.paths.get_agent_user_skill_dir(), "shared", "SKILL.md")
      .replaceAll("\\", "/");
    const builtin_path = path
      .join(f.paths.get_agent_builtin_skill_dir(), "shared", "SKILL.md")
      .replaceAll("\\", "/");
    expect(f.load().map((item) => item.filePath)).toEqual([user_path]);
    await f.service.set_enabled({ source: "user", name: "shared", enabled: false });
    expect(f.load().map((item) => item.filePath)).toEqual([builtin_path]);
    expect((await f.service.snapshot()).skills.map((item) => item.enabled)).toEqual([true, false]);
    await f.service.set_enabled({ source: "builtin", name: "shared", enabled: false });
    expect(f.load()).toEqual([]);
    await f.service.set_enabled({ source: "user", name: "shared", enabled: true });
    expect(f.load().map((item) => item.filePath)).toEqual([user_path]);
    expect(new AppSettingService(f.paths).read_setting().agent_skills).toEqual({
      disabled: { builtin: ["shared"], user: [] },
      user_order: [],
    });
    await expect(f.service.set_enabled({ name: "shared", enabled: false })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
  });

  it("同一来源只显示首个有效同名包，排序不改变包选择", async () => {
    using f = fixture();
    f.write("user", "two/duplicate", "duplicate");
    f.write("user", "one/duplicate", "duplicate");
    f.write("user", "other", "other");
    expect((await f.service.snapshot()).skills.map((item) => item.name)).toEqual([
      "duplicate",
      "other",
    ]);
    await f.service.reorder({ names: ["other", "duplicate"] });
    const loaded = f.load();
    expect(loaded.map((item) => item.name)).toEqual(["other", "duplicate"]);
    expect(loaded[1]?.filePath).toContain("/one/duplicate/SKILL.md");
    expect(f.log.warning).toHaveBeenCalled();
  });

  it("保存开关与排序，隐藏技能继续加载，新技能追加到末尾", async () => {
    using f = fixture();
    f.write("builtin", "hidden", "hidden", true);
    f.write("builtin", "built", "built");
    f.write("user", "alpha", "alpha");
    f.write("user", "beta", "beta");
    await f.service.reorder({ names: ["beta", "alpha"] });
    await f.service.set_enabled({ source: "user", name: "beta", enabled: false });
    expect((await f.service.snapshot()).skills.map((skill) => [skill.name, skill.enabled])).toEqual(
      [
        ["built", true],
        ["beta", false],
        ["alpha", true],
      ],
    );
    expect(f.load().map((skill) => skill.name)).toEqual(["built", "hidden", "alpha"]);
    await f.service.set_enabled({ source: "user", name: "beta", enabled: true });
    f.write("user", "aardvark", "aardvark");
    expect(f.load().map((skill) => skill.name)).toEqual([
      "built",
      "hidden",
      "beta",
      "alpha",
      "aardvark",
    ]);
    const reopened = new AppSettingService(f.paths);
    expect(reopened.read_setting().agent_skills).toEqual({
      disabled: { builtin: [], user: [] },
      user_order: ["beta", "alpha"],
    });
    expect(f.publish).toHaveBeenCalledWith(
      "settings.changed",
      expect.objectContaining({ keys: ["agent_skills"] }),
    );
    await expect(
      f.service.set_enabled({ source: "builtin", name: "hidden", enabled: false }),
    ).rejects.toMatchObject({
      code: "request.validation_failed",
    });
  });

  it("拒绝非法重排，保存失败保持已提交配置", async () => {
    using f = fixture();
    f.write("user", "alpha", "alpha");
    f.write("user", "beta", "beta");
    await expect(f.service.reorder({ names: ["alpha", "alpha"] })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    await expect(f.service.reorder({ names: ["alpha"] })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    vi.spyOn(f.settings, "save_setting").mockImplementation(() => {
      throw new Error("write failed");
    });
    await expect(
      f.service.set_enabled({ source: "user", name: "alpha", enabled: false }),
    ).rejects.toMatchObject({ code: "file.io_failed", cause: new Error("write failed") });
    expect((await f.service.snapshot()).skills.every((skill) => skill.enabled)).toBe(true);
    expect(f.publish).not.toHaveBeenCalled();
  });
});
