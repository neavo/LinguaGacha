/** 把设置页数字草稿收窄为边界内的有限值，空白和越界都留在编辑态。 */
export function parse_bounded_setting_number_draft(
  input_value: string,
  min_value: number,
  max_value: number,
): number | null {
  const trimmed_value = input_value.trim();
  const parsed_value = Number(trimmed_value);

  if (
    trimmed_value === "" ||
    !Number.isFinite(parsed_value) ||
    parsed_value < min_value ||
    parsed_value > max_value
  ) {
    return null;
  }

  return parsed_value;
}
