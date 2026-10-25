import { GameDirectoryOperations } from "../file/shared/game/game-directory-operations";
import { create_pdf_execution } from "../file/pdf/test-support";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPathService } from "./app-path-service";
import { AppSettingService } from "./app-setting-service";
import { AppSettingsCommandService } from "./app-settings-command-service";
import { ProjectDatabase, ProjectDatabaseAccess } from "../database/database-operations";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectWriteStore } from "../project/project-write-store";
import { get_section_revision } from "../project/project-data-reader";
import { ProjectContentService } from "../project/project-content-service";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import type { JsonRecord } from "../../domain/json";

const cleanup: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) close();
});

/** 配置和 .lg 使用真实存储，故障只注入提交与发布边界。 */
async function create_service() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-settings-command-"));
  const database = new ProjectDatabase("1.0.0");
  cleanup.push(async () => {
    await database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const settings = new AppSettingService(
    new AppPathService({ appRoot: root, builtinRoot: path.join(root, "builtin") }),
  );
  settings.save_setting({ mtool_optimizer_enable: true, skip_duplicate_source_text_enable: true });
  const session = new ProjectSessionState();
  const project_path = path.join(root, "test.lg");
  await database.create_project(project_path, "test");
  // 项目语言属于工程事实，应用开关同步时必须原样保留。
  await database.transaction(project_path, (writer) =>
    writer.upsert_meta_entries(project_path, {
      source_language: "EN",
      target_language: "DE",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    }),
  );
  session.mark_loaded(project_path);
  const gate = new RuntimeOperationGate();
  const publish = vi.fn();
  settings.set_stream_publisher({ publish });
  const on_commit = vi.fn();
  const writes = new ProjectWriteStore(database, on_commit, null);
  const content = new ProjectContentService(
    new GameDirectoryOperations(),
    database,
    gate,
    session,
    writes,
    create_pdf_execution(),
  );
  return {
    service: new AppSettingsCommandService(settings, gate, session, content),
    settings,
    session,
    gate,
    database,
    project_path,
    on_commit,
    publish,
  };
}

describe("AppSettingsCommandService", () => {
  it("运行中可保存应用设置，工程设置在持久化前被拒绝", async () => {
    const f = await create_service();
    const lease = f.gate.begin_runtime("agent");
    await expect(
      f.service.update({ request_timeout: 600, agent_approval_mode: "auto" }),
    ).resolves.toMatchObject({
      settings: { agent_approval_mode: "auto" },
      accepted: true,
      changes: [],
    });
    await expect(f.service.update({ mtool_optimizer_enable: false })).rejects.toMatchObject({
      code: "runtime.busy",
    });
    expect(f.settings.read_setting()).toMatchObject({
      request_timeout: 600,
      agent_approval_mode: "auto",
      mtool_optimizer_enable: true,
    });
    expect(await f.database.get_all_meta(f.project_path)).toMatchObject({
      mtool_optimizer_enable: true,
    });
    expect(f.on_commit).not.toHaveBeenCalled();
    f.gate.finish_runtime(lease);
  });

  it("拒绝非法审批模式并保留已保存的模式", async () => {
    const f = await create_service();
    await f.service.update({ agent_approval_mode: "auto" });
    f.publish.mockClear();
    await expect(f.service.update({ agent_approval_mode: "unknown" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    expect(f.settings.read_setting()["agent_approval_mode"]).toBe("auto");
    expect(f.publish).not.toHaveBeenCalled();
  });

  it("没有工程时预过滤开关只保存为应用设置", async () => {
    const f = await create_service();
    f.session.clear();
    const lease = f.gate.begin_runtime("model_test");
    await f.service.update({ mtool_optimizer_enable: false });
    expect(f.settings.read_setting()).toMatchObject({ mtool_optimizer_enable: false });
    expect(f.on_commit).not.toHaveBeenCalled();
    f.gate.finish_runtime(lease);
  });

  it("应用设置忽略旧语言字段，不写入工程", async () => {
    const f = await create_service();
    await f.service.update({ source_language: "KO", target_language: "EN" });
    expect(f.settings.read_setting()).not.toHaveProperty("source_language");
    expect(await f.database.get_all_meta(f.project_path)).toMatchObject({
      source_language: "EN",
      target_language: "DE",
    });
    expect(f.on_commit).not.toHaveBeenCalled();
  });

  it("同步预过滤开关时持有完整写租约，成功后才广播设置", async () => {
    const f = await create_service();
    const publication = Promise.withResolvers<void>();
    f.on_commit.mockReturnValue(publication.promise);
    const update = f.service.update({ mtool_optimizer_enable: false });
    await vi.waitFor(() => expect(f.on_commit).toHaveBeenCalledOnce());
    expect(() => f.gate.begin_runtime("agent")).toThrow(
      expect.objectContaining({ code: "runtime.busy" }),
    );
    expect(f.publish).not.toHaveBeenCalled();
    // 等待工程发布期间，纯应用配置仍可保存。
    await f.service.update({ request_timeout: 600 });
    publication.resolve();
    await expect(update).resolves.toMatchObject({
      settings: { mtool_optimizer_enable: false, request_timeout: 600 },
      accepted: true,
      changes: [],
    });
    expect(await f.database.get_all_meta(f.project_path)).toMatchObject({
      mtool_optimizer_enable: false,
    });
    const lease = f.gate.begin_runtime("agent");
    f.gate.finish_runtime(lease);
  });

  it("预过滤保存采用当前工程语言，更新开关和条目 revision 并保留项目语言", async () => {
    const f = await create_service();
    const before = (await f.database.get_all_meta(f.project_path)) as JsonRecord;
    await f.service.update({ skip_duplicate_source_text_enable: false });
    const after = (await f.database.get_all_meta(f.project_path)) as JsonRecord;
    expect(after).toMatchObject({
      source_language: "EN",
      target_language: "DE",
      skip_duplicate_source_text_enable: false,
      prefilter_config: { source_language: "EN", skip_duplicate_source_text_enable: false },
    });
    expect(get_section_revision(after, "items")).toBe(get_section_revision(before, "items") + 1);
    expect(f.settings.read_setting()).toMatchObject({ skip_duplicate_source_text_enable: false });
  });

  it("数据库提交失败补偿配置，释放租约且不发布成功事件", async () => {
    const f = await create_service();
    const failure = new Error("disk failure");
    vi.spyOn(ProjectDatabaseAccess.prototype, "upsert_meta_entries").mockImplementationOnce(() => {
      throw failure;
    });
    await expect(f.service.update({ mtool_optimizer_enable: false })).rejects.toMatchObject({
      code: "runtime.internal_invariant",
      cause: failure,
    });
    expect(f.settings.read_setting()).toMatchObject({ mtool_optimizer_enable: true });
    expect(await f.database.get_all_meta(f.project_path)).toMatchObject({
      mtool_optimizer_enable: true,
    });
    expect(f.publish).not.toHaveBeenCalled();
    await f.service.update({ mtool_optimizer_enable: false });
  });

  it.each(["project", "settings"] as const)(
    "%s 发布失败时保留已提交配置，报告已提交错误",
    async (failure) => {
      const f = await create_service();
      if (failure === "project") f.on_commit.mockRejectedValueOnce(new Error("event failure"));
      else
        f.publish.mockImplementationOnce(() => {
          throw new Error("settings event failure");
        });
      await expect(f.service.update({ mtool_optimizer_enable: false })).rejects.toMatchObject({
        code: "data.committed_sync_failed",
      });
      expect(f.settings.read_setting()).toMatchObject({ mtool_optimizer_enable: false });
      expect(await f.database.get_all_meta(f.project_path)).toMatchObject({
        mtool_optimizer_enable: false,
      });
      expect(f.publish).toHaveBeenCalledWith(
        "settings.changed",
        expect.objectContaining({
          settings: expect.objectContaining({ mtool_optimizer_enable: false }),
        }),
      );
    },
  );
});
