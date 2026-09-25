import { create_pdf_execution } from "../file/formats/pdf/test-support";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppPathService } from "./app-path-service";
import { AppSettingService } from "./app-setting-service";
import { AppSettingsCommandService } from "./app-settings-command-service";
import { ProjectDatabase } from "../database/database-operations";
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
function create_service() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-settings-command-"));
  const database = new ProjectDatabase();
  cleanup.push(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const settings = new AppSettingService(
    new AppPathService({ appRoot: root, builtinRoot: path.join(root, "builtin") }),
  );
  settings.save_setting({ source_language: "JA", target_language: "ZH" });
  const session = new ProjectSessionState();
  const project_path = path.join(root, "test.lg");
  database.create_project(project_path, "test");
  database.set_meta(project_path, "source_language", "JA");
  database.set_meta(project_path, "target_language", "ZH");
  session.mark_loaded(project_path);
  const gate = new RuntimeOperationGate();
  const publish = vi.fn();
  settings.set_stream_publisher({ publish });
  const on_commit = vi.fn();
  const writes = new ProjectWriteStore(database, on_commit, null);
  const content = new ProjectContentService(
    database,
    gate,
    session,
    writes,
    create_pdf_execution(),
    settings,
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
    const f = create_service();
    const lease = f.gate.begin_runtime("agent");
    await expect(
      f.service.update({ request_timeout: 600, agent_approval_mode: "auto" }),
    ).resolves.toMatchObject({
      settings: { agent_approval_mode: "auto" },
      accepted: true,
      changes: [],
    });
    await expect(f.service.update({ source_language: "EN" })).rejects.toMatchObject({
      code: "runtime.busy",
    });
    expect(f.settings.read_setting()).toMatchObject({
      request_timeout: 600,
      agent_approval_mode: "auto",
      source_language: "JA",
    });
    expect(f.database.get_all_meta(f.project_path)).toMatchObject({ source_language: "JA" });
    expect(f.on_commit).not.toHaveBeenCalled();
    f.gate.finish_runtime(lease);
  });

  it("拒绝非法审批模式并保留已保存的模式", async () => {
    const f = create_service();
    await f.service.update({ agent_approval_mode: "auto" });
    f.publish.mockClear();
    await expect(f.service.update({ agent_approval_mode: "unknown" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    expect(f.settings.read_setting()["agent_approval_mode"]).toBe("auto");
    expect(f.publish).not.toHaveBeenCalled();
  });

  it("没有工程时语言只保存为应用设置", async () => {
    const f = create_service();
    f.session.clear();
    const lease = f.gate.begin_runtime("model_test");
    await f.service.update({ source_language: "EN" });
    expect(f.settings.read_setting()).toMatchObject({ source_language: "EN" });
    expect(f.on_commit).not.toHaveBeenCalled();
    f.gate.finish_runtime(lease);
  });

  it("同步目标语言时持有完整写租约，成功后才广播设置", async () => {
    const f = create_service();
    let release!: () => void;
    f.on_commit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const update = f.service.update({ target_language: "EN" });
    expect(() => f.gate.begin_runtime("agent")).toThrow("runtime.busy");
    expect(f.publish).not.toHaveBeenCalled();
    // 等待工程发布期间，纯应用配置仍可保存。
    await f.service.update({ request_timeout: 600 });
    release();
    await expect(update).resolves.toMatchObject({
      settings: { target_language: "EN", request_timeout: 600 },
      accepted: true,
      changes: [],
    });
    expect(f.database.get_all_meta(f.project_path)).toMatchObject({ target_language: "EN" });
    const lease = f.gate.begin_runtime("agent");
    f.gate.finish_runtime(lease);
  });

  it("预过滤保存由后端读取当前工程，更新语言和条目 revision", async () => {
    const f = create_service();
    const before = f.database.get_all_meta(f.project_path) as JsonRecord;
    await f.service.update({ source_language: "EN" });
    const after = f.database.get_all_meta(f.project_path) as JsonRecord;
    expect(after).toMatchObject({ source_language: "EN" });
    expect(get_section_revision(after, "items")).toBe(get_section_revision(before, "items") + 1);
    expect(f.settings.read_setting()).toMatchObject({ source_language: "EN" });
  });

  it("数据库提交失败补偿配置，释放租约且不发布成功事件", async () => {
    const f = create_service();
    const failure = new Error("disk failure");
    vi.spyOn(f.database, "upsert_meta_entries").mockImplementationOnce(() => {
      throw failure;
    });
    await expect(f.service.update({ target_language: "EN" })).rejects.toMatchObject({
      code: "runtime.internal_invariant",
      cause: failure,
    });
    expect(f.settings.read_setting()).toMatchObject({ target_language: "ZH" });
    expect(f.database.get_all_meta(f.project_path)).toMatchObject({ target_language: "ZH" });
    expect(f.publish).not.toHaveBeenCalled();
    await f.service.update({ target_language: "EN" });
  });

  it.each(["project", "settings"] as const)(
    "%s 发布失败时保留已提交配置，报告已提交错误",
    async (failure) => {
      const f = create_service();
      if (failure === "project") f.on_commit.mockRejectedValueOnce(new Error("event failure"));
      else
        f.publish.mockImplementationOnce(() => {
          throw new Error("settings event failure");
        });
      await expect(f.service.update({ target_language: "EN" })).rejects.toMatchObject({
        code: "data.committed_sync_failed",
      });
      expect(f.settings.read_setting()).toMatchObject({ target_language: "EN" });
      expect(f.database.get_all_meta(f.project_path)).toMatchObject({ target_language: "EN" });
      expect(f.publish).toHaveBeenCalledWith(
        "settings.changed",
        expect.objectContaining({ settings: expect.objectContaining({ target_language: "EN" }) }),
      );
    },
  );
});
