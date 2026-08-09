import { describe, expect, it, vi } from "vitest";

import type { Item } from "../../domain/item";
import type { CacheReadPort } from "../cache/cache-types";
import { ProjectSessionState } from "../project/project-session-state";
import type { TranslationFileExportService } from "./translation-file-export-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { TsConversionExportService } from "./ts-conversion-export-service";

describe("TsConversionExportService", () => {
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
    const service = new TsConversionExportService({
      sessionState: create_loaded_session_state(),
      cache: {
        items: {
          readItems: () => source_items,
        },
        quality: {
          readBlock: () => ({
            text_preserve: {
              mode: "smart",
              entries: [{ entry_id: "hp", src: "HP", info: "" }],
            },
          }),
        },
      } as unknown as CacheReadPort,
      workerClient: { run: worker_run } as unknown as ComputeWorkerClient,
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
          text_preserve_entries: [{ entry_id: "hp", src: "HP", info: "" }],
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
  const session_state = new ProjectSessionState();
  session_state.mark_loaded("E:/Project/demo.lg");
  return session_state;
}
