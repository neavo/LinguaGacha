import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { normalize_agent_skill_settings } from "../../domain/agent-skill-settings";
import { AgentSkillsService } from "./agent-skills-service";
import { load_agent_skills } from "./agent-skills";

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
  const log = { warning: vi.fn(), error: vi.fn() };
  const service = new AgentSkillsService(paths, settings, log);
  return {
    [Symbol.dispose]: () => root[Symbol.dispose](),
    paths,
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
    expect((await f.load()).map((item) => item.filePath)).toEqual([user_path]);
    await f.service.set_enabled({ source: "user", name: "shared", enabled: false });
    expect((await f.load()).map((item) => item.filePath)).toEqual([builtin_path]);
    expect((await f.service.snapshot()).skills.map((item) => item.enabled)).toEqual([true, false]);
    await f.service.set_enabled({ source: "builtin", name: "shared", enabled: false });
    expect(await f.load()).toEqual([]);
    await f.service.set_enabled({ source: "user", name: "shared", enabled: true });
    expect((await f.load()).map((item) => item.filePath)).toEqual([user_path]);
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
    const loaded = await f.load();
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
    expect((await f.load()).map((skill) => skill.name)).toEqual(["built", "hidden", "alpha"]);
    await f.service.set_enabled({ source: "user", name: "beta", enabled: true });
    f.write("user", "aardvark", "aardvark");
    expect((await f.load()).map((skill) => skill.name)).toEqual([
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
    ).rejects.toThrow("write failed");
    expect((await f.service.snapshot()).skills.every((skill) => skill.enabled)).toBe(true);
    expect(f.publish).not.toHaveBeenCalled();
  });
});
