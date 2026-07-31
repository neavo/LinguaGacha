import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import { ProjectDatabase } from "../database/database-operations";
import type {
  ProjectChangePublisher,
  ProjectWriteChangeRequest,
} from "../project/project-write-event-adapter";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import { ProjectWriteStore } from "../project/project-write-store";
import type { ProjectChangeEvent } from "../../shared/project-event";
import { QualityPromptService } from "./quality-prompt-service";

describe("QualityPromptService", () => {
  const cleanup_paths: string[] = [];
  const cleanup_databases: ProjectDatabase[] = [];

  afterEach(() => {
    while (cleanup_databases.length > 0) {
      cleanup_databases.pop()?.close();
    }
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { recursive: true, force: true });
    }
  });

  it("读取翻译模板时填充输出格式占位符", () => {
    const { service, app_root } = create_service();
    const template_dir = path.join(app_root, "resource", "translation_prompt", "template", "zh");
    fs.mkdirSync(template_dir, { recursive: true });
    fs.writeFileSync(path.join(template_dir, "base.txt"), "默认提示词", "utf-8");
    fs.writeFileSync(path.join(template_dir, "prefix.txt"), "固定前缀", "utf-8");
    fs.writeFileSync(
      path.join(template_dir, "suffix.txt"),
      "输出 JSONLINE\n{translation_output_format}",
      "utf-8",
    );

    const result = service.get_template({ task_type: "translation" });
    const template = result["template"] as Record<string, string>;

    expect(template["suffix_text"]).toBe(
      '输出 JSONLINE\n```jsonline\n{"<序号>":"<译文文本>"}\n```',
    );
  });

  it("读取当前任务类型提示词切片与 revision", () => {
    const { service, session_state } = create_service();
    session_state.mark_loaded("E:/Project/demo.lg");

    expect(service.read({ task_type: "translation" })).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { prompts: 2 },
      prompt: { text: "翻译提示词", enabled: true, revision: 2 },
    });
  });

  it("读取提示词预设时拒绝目录逃逸和绝对路径", () => {
    const { service } = create_service();

    for (const virtual_id of [
      "builtin:../demo.txt",
      "builtin:folder/demo.txt",
      "builtin:folder\\demo.txt",
      "builtin:/demo.txt",
      "builtin:C:\\demo.txt",
    ]) {
      expect(() =>
        service.read_preset({
          task_type: "translation",
          virtual_id,
        }),
      ).toThrow("request.validation_failed");
    }
  });

  it("保存提示词时把 typed revision 请求交给 ProjectWriteStore", async () => {
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    const { service, session_state, published } = create_service(database);
    const project_path = path.join(create_temp_dir(), "prompt.lg");
    database.create_project(project_path, "prompt");
    session_state.mark_loaded(project_path);

    await service.save({
      task_type: "translation",
      text: "新的提示词",
      enabled: true,
      expected_section_revisions: { prompts: 0 },
    });

    expect(database.get_rule_text(project_path, "translation_prompt")).toBe("新的提示词");
    expect(published).toHaveBeenCalledWith({
      projectPath: project_path,
      source: "quality_prompt_save",
      updatedSections: ["prompts"],
    });
  });

  it("任务 busy 时拒绝提示词项目写但不阻塞预设文件 IO", async () => {
    const { service } = create_service(null, "task");

    await expect(
      service.save({
        task_type: "translation",
        text: "新的提示词",
        enabled: true,
        expected_section_revisions: { prompts: 0 },
      }),
    ).rejects.toThrow("runtime.busy");
    expect(() =>
      service.save_preset({
        task_type: "translation",
        name: "busy-allowed",
        text: "预设提示词",
      }),
    ).not.toThrow();
  });

  function create_service(
    database: ProjectDatabase | null = null,
    runtime_owner: "task" | "agent" | null = null,
  ): {
    service: QualityPromptService;
    app_root: string;
    session_state: ProjectSessionState;
    published: ReturnType<typeof vi.fn>;
  } {
    const app_root = create_temp_dir();
    const paths = new AppPathService({ appRoot: app_root, env: {}, platform: process.platform });
    const app_setting_service = new AppSettingService(paths);
    const project_database = database ?? (null as unknown as ProjectDatabase);
    const session_state = new ProjectSessionState();
    const published = vi.fn(
      (payload: ProjectWriteChangeRequest): ProjectChangeEvent => ({
        type: "project.changed",
        eventId: "test",
        source: payload.source,
        projectPath: payload.projectPath,
        projectRevision: 1,
        sectionRevisions: { prompts: 1 },
        updatedSections: payload.updatedSections,
      }),
    );
    const publisher = published as ProjectChangePublisher;
    const service = new QualityPromptService(
      paths,
      app_setting_service,
      project_database,
      session_state,
      new ProjectWriteStore(project_database, vi.fn(), publisher),
      create_runtime_gate(runtime_owner),
      {
        readSectionRevisions: () => ({ prompts: 2 }),
        prompts: {
          readBlock: () => ({
            translation: { text: "翻译提示词", enabled: true, revision: 2 },
          }),
        },
      } as unknown as CacheReadPort,
    );
    return { service, app_root, session_state, published };
  }

  function create_temp_dir(): string {
    const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-prompt-"));
    cleanup_paths.push(temp_dir);
    return temp_dir;
  }

  function create_runtime_gate(owner: "task" | "agent" | null): RuntimeOperationGate {
    const gate = new RuntimeOperationGate();
    if (owner !== null) gate.begin_runtime(owner);
    return gate;
  }
});
