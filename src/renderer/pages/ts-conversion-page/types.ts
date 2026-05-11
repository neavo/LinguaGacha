export type TsConversionDirection = "s2t" | "t2s";

export type TsConversionNameDst = string | string[] | null;

export type TsConversionRuntimeItem = {
  item_id: number;
  dst: string;
  name_dst: TsConversionNameDst;
  text_type: string;
};

export type TsConversionConvertedItem = {
  item_id: number;
  dst: string;
  name_dst: TsConversionNameDst;
};

// 质量规则预设读取保持通用 entries 形状，页面自行收窄 text_preserve 的 src 字段。
export type TsConversionRulePresetPayload = {
  entries?: unknown[];
};

export type TsConversionExportPayload = {
  accepted?: boolean;
  output_path?: string;
};
