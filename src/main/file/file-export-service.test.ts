import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import type { SettingService } from "../service/setting-service";
import { ProjectSessionState } from "../project/project-session-state";
import { FileExportService } from "./file-export-service";

let temp_dir = ""; // 每个用例独占导出目录，避免文件写回断言互相污染

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-file-export-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/**
 * 导出测试使用固定设置，便于断言目标路径和日志语言
 */
function create_setting_service(output_folder_open_on_finish = false): SettingService {
  return {
    load_setting: () => ({
      source_language: "JA",
      target_language: "ZH",
      app_language: "ZH",
      output_folder_open_on_finish,
      deduplication_in_bilingual: true,
      write_translated_name_fields_to_file: true,
    }),
  } as unknown as SettingService;
}

interface CollectedLogEntry {
  level: "info" | "error";
  message: string;
  payload: Parameters<LogManager["info"]>[1];
}

interface LogCollector extends Pick<LogManager, "info" | "error"> {
  entries: CollectedLogEntry[];
}

/**
 * 日志替身只记录公开日志事件，避免测试耦合到 vi mock 调用结构
 */
function create_log_collector(): LogCollector {
  const entries: CollectedLogEntry[] = [];
  return {
    entries,
    info: (message, payload = {}) => {
      entries.push({ level: "info", message, payload });
    },
    error: (message, payload = {}) => {
      entries.push({ level: "error", message, payload });
    },
  };
}

function create_output_folder_opener() {
  return vi.fn(async (_output_path: string) => {});
}

describe("FileExportService", () => {
  it("普通导出补齐同文件重复译文并写出 格式文件", async () => {
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
    const log_collector = create_log_collector();
    const output_folder_opener = create_output_folder_opener();
    const service = new FileExportService(
      database,
      create_setting_service(),
      session_state,
      output_folder_opener,
      log_collector,
    );

    await expect(service.export_translation()).resolves.toEqual({
      accepted: true,
      output_path: path.join(temp_dir, "demo_译文"),
    });
    expect(fs.readFileSync(path.join(temp_dir, "demo_译文", "script.zh.txt"), "utf-8")).toBe(
      "译文\n译文",
    );
    expect(log_collector.entries.map(({ level, message }) => [level, message])).toEqual([
      ["info", "生成译文中 …"],
      ["info", ""],
      ["info", `译文已保存至 ${path.join(temp_dir, "demo_译文")} …`],
      ["info", ""],
    ]);
    expect(output_folder_opener).not.toHaveBeenCalled();
  });

  it("启用设置后导出成功会打开译文输出目录", async () => {
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
      ],
      read_asset_content: () => null,
    } as unknown as ProjectDatabase;
    const output_folder_opener = create_output_folder_opener();
    const service = new FileExportService(
      database,
      create_setting_service(true),
      session_state,
      output_folder_opener,
      create_log_collector(),
    );

    await expect(service.export_translation()).resolves.toEqual({
      accepted: true,
      output_path: path.join(temp_dir, "demo_译文"),
    });

    expect(output_folder_opener).toHaveBeenCalledTimes(1);
    expect(output_folder_opener).toHaveBeenCalledWith(path.join(temp_dir, "demo_译文"));
  });

  it("打开输出目录失败不改变导出成功结果并记录诊断日志", async () => {
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
      ],
      read_asset_content: () => null,
    } as unknown as ProjectDatabase;
    const log_collector = create_log_collector();
    const output_folder_opener = vi.fn(async (_output_path: string) => {
      throw new Error("open failed");
    });
    const service = new FileExportService(
      database,
      create_setting_service(true),
      session_state,
      output_folder_opener,
      log_collector,
    );

    await expect(service.export_translation()).resolves.toEqual({
      accepted: true,
      output_path: path.join(temp_dir, "demo_译文"),
    });

    expect(log_collector.entries.map(({ level, message }) => [level, message])).toContainEqual([
      "error",
      "打开输出文件夹失败 …",
    ]);
    expect(log_collector.entries.at(-1)?.payload).toEqual(
      expect.objectContaining({ source: "file-export", error_message: "open failed" }),
    );
  });

  it("写文件失败时按旧导出口径记录文件写入和导出失败日志", async () => {
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
      ],
      read_asset_content: () => null,
    } as unknown as ProjectDatabase;
    const log_collector = create_log_collector();
    vi.spyOn(fs, "mkdirSync").mockImplementation((() => {
      throw new Error("boom");
    }) as typeof fs.mkdirSync);
    const service = new FileExportService(
      database,
      create_setting_service(),
      session_state,
      create_output_folder_opener(),
      log_collector,
    );

    await expect(service.export_translation()).rejects.toThrow("boom");

    const error_entries = log_collector.entries.filter((entry) => entry.level === "error");
    expect(error_entries.map(({ message }) => message)).toEqual([
      "文件写入失败 …",
      "译文生成失败 …",
    ]);
    expect(error_entries[0]?.payload).toEqual(
      expect.objectContaining({ source: "file-export", error_message: "boom" }),
    );
  });

  it("转换导出拒绝未知后缀，避免写入非约定目录", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(path.join(temp_dir, "demo.lg"));
    const service = new FileExportService(
      { execute: () => [], read_asset_content: () => null } as unknown as ProjectDatabase,
      create_setting_service(),
      session_state,
      create_output_folder_opener(),
    );

    await expect(
      service.export_converted_translation({ suffix: "_BAD", items: [{ id: 1, dst: "译文" }] }),
    ).rejects.toThrow("导出后缀无效。");
  });
});
