import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { ConfigService } from "../service/config-service";
import type { CoreBridgeClient } from "../core/core-bridge-client";
import { ProjectSessionState } from "../project/project-session-state";
import { FileExportService } from "./file-export-service";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-export-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

function create_config_service(): ConfigService {
  return {
    load_config: () => ({
      source_language: "JA",
      target_language: "ZH",
      app_language: "ZH",
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    }),
  } as unknown as ConfigService;
}

function create_core_bridge(calls: Array<Record<string, unknown>> = []): CoreBridgeClient {
  return {
    export_epub_items: async (
      project_path: string,
      translated_path: string,
      bilingual_path: string,
      items: Record<string, unknown>[],
    ) => {
      calls.push({ project_path, translated_path, bilingual_path, items });
    },
  } as unknown as CoreBridgeClient;
}

describe("FileExportService", () => {
  it("普通导出补齐同文件重复译文并写出 TS 格式文件", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = {
      execute: () => [
        {
          id: 1,
          src: "原文",
          dst: "译文",
          status: "PROCESSED",
          file_type: "TXT",
          file_path: "script.txt",
          row: 0,
        },
        {
          id: 2,
          src: "原文",
          dst: "",
          status: "DUPLICATED",
          file_type: "TXT",
          file_path: "script.txt",
          row: 1,
        },
      ],
      read_asset_content: () => null,
    } as unknown as ProjectDatabase;
    const service = new FileExportService(
      database,
      create_config_service(),
      session_state,
      create_core_bridge(),
    );

    await expect(service.export_translation()).resolves.toEqual({
      accepted: true,
      output_path: path.join(temp_dir, "demo_译文"),
    });
    expect(fs.readFileSync(path.join(temp_dir, "demo_译文", "script.zh.txt"), "utf-8")).toBe(
      "译文\n译文",
    );
  });

  it("转换导出拒绝未知后缀，避免写入非约定目录", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(path.join(temp_dir, "demo.lg"));
    const service = new FileExportService(
      { execute: () => [], read_asset_content: () => null } as unknown as ProjectDatabase,
      create_config_service(),
      session_state,
      create_core_bridge(),
    );

    await expect(
      service.export_converted_translation({ suffix: "_BAD", items: [{ id: 1, dst: "译文" }] }),
    ).rejects.toThrow("导出后缀无效。");
  });

  it("导出 EPUB 时复用 TS 已确定的输出目录调用 Python 保留 writer", async () => {
    const project_path = path.join(temp_dir, "demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    const database = {
      execute: () => [
        {
          id: 1,
          src: "章节",
          dst: "译文",
          status: "PROCESSED",
          file_type: "EPUB",
          file_path: "book.epub",
          row: 1,
          extra_field: { epub: { parts: [{ path: "chapter.xhtml" }] } },
        },
      ],
      read_asset_content: () => null,
    } as unknown as ProjectDatabase;
    const calls: Array<Record<string, unknown>> = [];
    const service = new FileExportService(
      database,
      create_config_service(),
      session_state,
      create_core_bridge(calls),
    );

    await expect(service.export_translation()).resolves.toEqual({
      accepted: true,
      output_path: path.join(temp_dir, "demo_译文"),
    });

    expect(calls).toEqual([
      {
        project_path,
        translated_path: path.join(temp_dir, "demo_译文"),
        bilingual_path: path.join(temp_dir, "demo_译文_双语对照"),
        items: [
          expect.objectContaining({
            src: "章节",
            dst: "译文",
            file_type: "EPUB",
            file_path: "book.epub",
          }),
        ],
      },
    ]);
  });
});
