import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  PROOFREADING_OUTCOME_GROUPS,
  PROOFREADING_STATUS_ORDER,
  PROOFREADING_TRANSLATED_OUTCOME_CODES,
} from "@shared/proofreading/proofreading-types";

/** 校对状态只在 renderer 映射为可见标签，shared 保持纯业务状态码。 */
export const PROOFREADING_STATUS_LABEL_KEY_BY_CODE = {
  NONE: "task_progress.translation_pending",
  PROCESSED: "task_progress.translation_completed",
  EXCLUDED: "proofreading_page.status.excluded",
  RULE_SKIPPED: "proofreading_page.status.rule_skipped",
  LANGUAGE_SKIPPED: "proofreading_page.status.non_target_source_language",
  DUPLICATED: "proofreading_page.status.duplicated",
  ERROR: "task_progress.translation_failed",
} as const satisfies Record<(typeof PROOFREADING_STATUS_ORDER)[number], LocaleKey>;

/** 校对页与跨页面警告摘要复用同一组标签。 */
export const PROOFREADING_WARNING_LABEL_KEY_BY_CODE = {
  KANA: "proofreading_page.warning.kana",
  HANGEUL: "proofreading_page.warning.hangeul",
  TEXT_PRESERVE: "proofreading_page.warning.text_preserve",
  SIMILARITY: "proofreading_page.warning.similarity",
  GLOSSARY: "proofreading_page.warning.glossary",
  RETRY_THRESHOLD: "proofreading_page.warning.retry_threshold",
  LINE_COUNT_MISMATCH: "proofreading_page.warning.line_count_mismatch",
  NO_WARNING: "proofreading_page.filter.no_warning",
} as const satisfies Record<(typeof PROOFREADING_TRANSLATED_OUTCOME_CODES)[number], LocaleKey>;

/** 结果分组标签与 shared 分组词表保持穷尽对应。 */
export const PROOFREADING_OUTCOME_GROUP_LABEL_KEY_BY_CODE = {
  translated: "proofreading_page.filter.translated_group",
  unfinished: "proofreading_page.filter.unfinished_group",
  not_required: "proofreading_page.filter.not_required_group",
} as const satisfies Record<(typeof PROOFREADING_OUTCOME_GROUPS)[number]["code"], LocaleKey>;
