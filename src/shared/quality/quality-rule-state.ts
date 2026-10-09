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

// 校对算法接收的输入形状；条目由其执行边界解析，项目缓存使用 `QualityRuleBlock` 的明确类型。
export type QualitySlice = {
  entries: Array<Record<string, unknown>>;
  enabled: boolean;
  mode: string;
  revision: number;
};

// 公开规则类型固定为四个切片，消费侧不按物理存储落点取值。
export type QualitySnapshot = {
  glossary: QualitySlice;
  pre_replacement: QualitySlice;
  post_replacement: QualitySlice;
  text_preserve: QualitySlice;
};
