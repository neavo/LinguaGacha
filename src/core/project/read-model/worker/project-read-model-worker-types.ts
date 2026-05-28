import type { LogError } from "../../../../shared/error";
import type { QualityStatisticsRuleMode } from "../../../../shared/quality/quality-statistics";
import type {
  TsConversionConvertedItem,
  TsConversionDirection,
  TsConversionRuntimeItem,
} from "../../../../shared/ts-conversion/ts-conversion";
import type {
  NameFieldFilterState,
  NameFieldRow,
  NameFieldSortState,
} from "../../../../shared/name-field-extraction/name-field-extraction";

export type ProjectReadModelQualityStatisticsInput = {
  rule_key: QualityStatisticsRuleMode;
  entries: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
};

export type ProjectReadModelTsConversionInput = {
  items: TsConversionRuntimeItem[];
  direction: TsConversionDirection;
  convert_name: boolean;
  preserve_text: boolean;
  text_preserve_mode: string;
  custom_rules: string[];
  preset_rules_by_text_type: Record<string, string[]>;
};

export type ProjectReadModelNameFieldExtractionInput = {
  items: Array<Record<string, unknown>>;
  glossary_entries: Array<Record<string, unknown>>;
  filter: NameFieldFilterState;
  sort: NameFieldSortState;
};

export type ProjectReadModelNameFieldExtractionResult = {
  rows: NameFieldRow[];
  counts: {
    total: number;
    translated: number;
    untranslated: number;
    error: number;
  };
  invalid_regex_message: string | null;
};

export type ProjectReadModelComputeQualityStatisticsMessage = {
  id: string;
  type: "compute_quality_statistics";
  input: ProjectReadModelQualityStatisticsInput;
};

export type ProjectReadModelExtractNameFieldsMessage = {
  id: string;
  type: "extract_name_fields";
  input: ProjectReadModelNameFieldExtractionInput;
};

export type ProjectReadModelConvertTsItemsMessage = {
  id: string;
  type: "convert_ts_items";
  input: ProjectReadModelTsConversionInput;
};

export type ProjectReadModelCancelMessage = {
  id: string;
  type: "cancel";
};

export type ProjectReadModelWorkerIncomingMessage =
  | ProjectReadModelComputeQualityStatisticsMessage
  | ProjectReadModelExtractNameFieldsMessage
  | ProjectReadModelConvertTsItemsMessage
  | ProjectReadModelCancelMessage;

export type ProjectReadModelWorkerResultByType = {
  compute_quality_statistics: Record<string, unknown>;
  extract_name_fields: ProjectReadModelNameFieldExtractionResult;
  convert_ts_items: TsConversionConvertedItem[];
};

export type ProjectReadModelWorkerTaskType = keyof ProjectReadModelWorkerResultByType;

export type ProjectReadModelWorkerOutgoingMessage =
  | {
      id: string;
      ok: true;
      data: ProjectReadModelWorkerResultByType[ProjectReadModelWorkerTaskType];
    }
  | {
      id: string;
      ok: false;
      error: LogError;
    };
