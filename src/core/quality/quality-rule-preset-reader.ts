import path from "node:path";

import { AppPathService } from "../app/app-path-service";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import { JsonTool } from "../../shared/utils/json-tool";

export class QualityRulePresetReader {
  private readonly paths: AppPathService;
  private readonly native_fs: NativeFs;

  public constructor(paths: AppPathService, native_fs: NativeFs = default_native_fs) {
    this.paths = paths;
    this.native_fs = native_fs;
  }

  public read_builtin_text_preserve_rule_sources(text_type: string): string[] {
    const file_name = `${text_type.toLowerCase()}.json`;
    const preset_path = path.join(
      this.paths.get_quality_rule_builtin_preset_dir("text_preserve"),
      file_name,
    );
    if (!this.native_fs.exists(preset_path)) {
      return [];
    }
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }
    return data.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return [];
      }
      const src = String((entry as Record<string, unknown>)["src"] ?? "").trim();
      return src === "" ? [] : [src];
    });
  }
}
