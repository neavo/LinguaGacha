import type {
  QualityRuleEntryByKind,
  QualityRuleKind,
  TextPreserveMode,
} from "../../domain/quality";

/** 完整项目切片经过读取边界校验，缓存与公开查询沿途保留字段类型。 */
export type QualityRuleSlice<K extends QualityRuleKind = QualityRuleKind> = {
  enabled: boolean;
  mode: TextPreserveMode;
  entries: QualityRuleEntryByKind[K][];
  revision: number;
};
export type QualityRuleBlock = { [K in QualityRuleKind]: QualityRuleSlice<K> };
