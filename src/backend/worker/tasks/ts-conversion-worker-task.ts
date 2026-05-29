import {
  build_ts_conversion_converted_items,
  type TsConversionConvertedItem,
  type TsConversionDirection,
  type TsConversionItem,
} from "../../../shared/toolbox/ts-conversion";

export type TsConversionWorkerTaskInput = {
  items: TsConversionItem[];
  direction: TsConversionDirection;
  convert_name: boolean;
  preserve_text: boolean;
  text_preserve_mode: string;
  custom_rules: string[];
  preset_rules_by_text_type: Record<string, string[]>;
};

export function run_ts_conversion_worker_task(
  input: TsConversionWorkerTaskInput,
): TsConversionConvertedItem[] {
  return build_ts_conversion_converted_items(input);
}
