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

export type TsConversionPresetRulesPayload = {
  rules?: Record<string, string[]>;
};

export type TsConversionExportPayload = {
  accepted?: boolean;
  output_path?: string;
};
