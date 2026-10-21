import type { TextTaskItemRecord } from "../../../shared/text/text-processing";

/**
 * 翻译 context 是 pipeline 的最小工作单元，包含目标条目、前后文与重试元信息。
 */
export interface TranslationContext {
  work_unit_id: string;
  items: TextTaskItemRecord[];
  precedings: TextTaskItemRecord[];
  followings: TextTaskItemRecord[];
  retry_count: number; // 当前粒度的已重试轮次：多条单元记录对半切次数，单条单元记录单条重试次数。
}
