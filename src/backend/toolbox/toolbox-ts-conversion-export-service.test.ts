import { describe, expect, it, vi } from "vitest";

import type { Item } from "../../domain/item";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProjectSessionState } from "../project/project-session";
import type { QualityRulePresetReader } from "../quality/quality-rule-preset-reader";
import type { TranslationFileExportService } from "../translation/translation-file-export-service";
import type { BackendWorkerClient } from "../worker/worker-client";
import { ToolboxTsConversionExportService } from "./toolbox-ts-conversion-export-service";

describe("ToolboxTsConversionExportService", () => {
  it("按当前缓存 item 与文本保护规则生成繁简转换导出", async () => {
    const source_items = [
      {
        item_id: 1,
        src: "鼠标",
        dst: "鼠标",
        name_src: "道具",
        name_dst: "鼠标",
        row_number: 1,
        file_path: "script.txt",
        file_type: "TXT",
        text_type: "KAG",
        status: "PROCESSED",
        retry_count: 0,
        skip_internal_filter: false,
      },
    ];
    const worker_run = vi.fn(async () => [{ item_id: 1, dst: "滑鼠", name_dst: "滑鼠" }]);
    const export_items_with_suffix = vi.fn(async (_items: Item[], _suffix: "_S2T" | "_T2S") => ({
      accepted: true,
      output_path: "E:/Project/demo_译文_S2T",
    }));
    const service = new ToolboxTsConversionExportService({
      sessionState: create_loaded_session_state(),
      cache: {
        items: {
          readItems: () => source_items,
        },
        quality: {
          readBlock: () => ({
            text_preserve: {
              mode: "smart",
              entries: [{ src: "HP" }],
            },
          }),
        },
      } as unknown as CacheReadPort,
      workerClient: { run: worker_run } as unknown as BackendWorkerClient,
      presetReader: {
        read_builtin_text_preserve_rule_sources: vi.fn(() => ["<keep>"]),
      } as unknown as QualityRulePresetReader,
      fileExportService: {
        export_items_with_suffix,
      } as unknown as TranslationFileExportService,
    });

    const result = await service.export_files({ direction: "s2t" });

    expect(worker_run).toHaveBeenCalledWith(
      {
        type: "ts_conversion",
        input: {
          items: [{ item_id: 1, dst: "鼠标", name_dst: "鼠标", text_type: "KAG" }],
          direction: "s2t",
          convert_name: true,
          preserve_text: true,
          text_preserve_mode: "smart",
          custom_rules: ["HP"],
          preset_rules_by_text_type: { KAG: ["<keep>"] },
        },
      },
      expect.any(AbortSignal),
    );
    const first_export_call = export_items_with_suffix.mock.calls[0];
    if (first_export_call === undefined) {
      throw new Error("测试需要导出服务被调用。");
    }
    const [export_items, suffix] = first_export_call;
    expect(suffix).toBe("_S2T");
    expect(export_items.map((item) => item.to_json())).toMatchObject([
      { dst: "滑鼠", name_dst: "滑鼠" },
    ]);
    expect(result).toEqual({ accepted: true, output_path: "E:/Project/demo_译文_S2T" });
  });
});

function create_loaded_session_state(): ProjectSessionState {
  return {
    snapshot: () => ({ loaded: true, projectPath: "E:/Project/demo.lg" }),
  } as unknown as ProjectSessionState;
}
