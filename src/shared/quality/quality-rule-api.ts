import type {
  QualityRuleGlossaryEntry,
  QualityRuleTextPreserveEntry,
  QualityRuleTextReplacementEntry,
} from "../../domain/quality";
import type { JsonRecord } from "../../domain/json";
import type { ProjectDataSectionRevisions } from "../project-event";

/** 规则身份同时决定读写载荷的条目类型。 */
export type QualityRuleEntryByType = {
  glossary: QualityRuleGlossaryEntry;
  pre_replacement: QualityRuleTextReplacementEntry;
  post_replacement: QualityRuleTextReplacementEntry;
  text_preserve: QualityRuleTextPreserveEntry;
};
export type QualityRuleType = keyof QualityRuleEntryByType;
export type QualityRuleQuerySlice<K extends QualityRuleType = QualityRuleType> = {
  enabled?: boolean;
  mode?: import("../../domain/quality").TextPreserveMode;
  entries?: QualityRuleEntryByType[K][];
};
export type QualityRuleQueryResponse<K extends QualityRuleType = QualityRuleType> = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  qualityRule: QualityRuleQuerySlice<K>;
};
export type QualityRulePresetItem = {
  name: string;
  file_name: string;
  virtual_id: string;
  type: "builtin" | "user";
  path?: string;
};
export type QualityRulePresets = {
  builtin_presets: QualityRulePresetItem[];
  user_presets: QualityRulePresetItem[];
};
export type QualityRulePresetChange = QualityRulePresets & { settings: JsonRecord };

export type QualityRuleUpdateRequest<K extends QualityRuleType = QualityRuleType> = {
  rule_type: K;
  expected_section_revisions: { quality: number };
  entries?: QualityRuleEntryByType[K][];
  meta?: { enabled?: boolean; mode?: import("../../domain/quality").TextPreserveMode };
};
