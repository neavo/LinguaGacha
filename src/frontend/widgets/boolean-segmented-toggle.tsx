import { useI18n } from "@frontend/app/locale/locale-provider";
import { SegmentedToggle } from "@frontend/shadcn/segmented-toggle";

type BooleanSegmentedToggleProps = {
  aria_label: string;
  value: boolean;
  disabled?: boolean;
  className?: string;
  stretch?: boolean;
  on_value_change: (next_value: boolean) => void;
};

/** 为布尔设置提供统一的启用/禁用文案，并把字符串选项转换回布尔值。 */
export function BooleanSegmentedToggle(props: BooleanSegmentedToggleProps): JSX.Element {
  const { t } = useI18n();

  return (
    <SegmentedToggle
      aria_label={props.aria_label}
      value={props.value ? "enabled" : "disabled"}
      options={[
        { value: "disabled", label: t("app.toggle.option.disabled") },
        { value: "enabled", label: t("app.toggle.option.enabled") },
      ]}
      disabled={props.disabled}
      className={props.className}
      stretch={props.stretch}
      on_value_change={(next_value) => props.on_value_change(next_value === "enabled")}
    />
  );
}
