import type { ApiJsonValue } from "../../api/api-types";
import { TextTool } from "../../../shared/utils/text-tool";
import { TextFakenameInjector } from "../../../shared/text/text-fakename-injector";

/**
 * 术语分析译后 pipeline，负责模型术语输出归一和伪名恢复
 */
export class AnalysisPostPipeline {
  private readonly fake_name_injector: TextFakenameInjector;

  /**
   * fake_name_injector 必须来自同一次译前流程，才能恢复本批请求的伪名
   */
  public constructor(fake_name_injector: TextFakenameInjector) {
    this.fake_name_injector = fake_name_injector;
  }

  /**
   * 模型术语输出归一成固定 `src/dst/info/case_sensitive` 结构
   */
  public normalize_glossary_entries(
    glossary_entries: Array<Record<string, string>>,
  ): Array<Record<string, ApiJsonValue>> {
    const normalized: Array<Record<string, ApiJsonValue>> = [];
    for (const raw of glossary_entries) {
      let src = String(raw.src ?? "").trim();
      let dst = String(raw.dst ?? "").trim();
      const restored = this.fake_name_injector.restore_glossary_entry(src, dst);
      if (restored === null) {
        continue;
      }
      [src, dst] = restored;
      const info = String(raw.info ?? "").trim();
      if (TextFakenameInjector.is_control_code_self_mapping(src, dst)) {
        normalized.push(this.build_glossary_entry(src, dst, info));
        continue;
      }
      for (const [src_part, dst_part] of this.split_glossary_entry_pairs(src, dst)) {
        const normalized_src = src_part.trim();
        const normalized_dst = dst_part.trim();
        if (normalized_src === "" || normalized_dst === "") {
          continue;
        }
        if (normalized_src === normalized_dst) {
          continue;
        }
        normalized.push(this.build_glossary_entry(normalized_src, normalized_dst, info));
      }
    }
    return normalized;
  }

  /**
   * 复合术语按标点和空格拆分，源译分段数量不同时保留原整项
   */
  private split_glossary_entry_pairs(src: string, dst: string): Array<[string, string]> {
    const src_parts = TextTool.split_by_punctuation(src, true);
    const dst_parts = TextTool.split_by_punctuation(dst, true);
    if (src_parts.length !== dst_parts.length) {
      return [[src, dst]];
    }
    return src_parts.map((src_part, index) => [src_part, dst_parts[index] ?? ""]);
  }

  /**
   * 候选术语结构统一在这里生成
   */
  private build_glossary_entry(
    src: string,
    dst: string,
    info: string,
  ): Record<string, ApiJsonValue> {
    return { src, dst, info, case_sensitive: false };
  }
}
