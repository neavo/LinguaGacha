import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";
import { Input } from "@frontend/shadcn/input";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type ModelTaskSettingsDialogProps = {
  open: boolean;
  model: ModelEntrySnapshot | null;
  readonly: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
};

const THRESHOLD_INPUT_MIN = 0;
const THRESHOLD_INPUT_MAX = 9_999_999;
const THRESHOLD_FIELDS = [
  "input_token_limit",
  "output_token_limit",
  "concurrency_limit",
  "rpm_limit",
] as const;

/** 阈值收口为允许范围内的整数，非法输入归零。 */
function normalize_number_input(value: string): number {
  const parsed_value = Number(value);
  if (Number.isFinite(parsed_value)) {
    const normalized_value = Math.trunc(parsed_value);
    return Math.min(THRESHOLD_INPUT_MAX, Math.max(THRESHOLD_INPUT_MIN, normalized_value));
  } else {
    return 0;
  }
}

/** 批量任务阈值共用整数范围与提交格式。 */
export function ModelTaskSettingsDialog(props: ModelTaskSettingsDialogProps): JSX.Element | null {
  const { t } = useI18n();

  if (props.model === null) {
    return null;
  }

  const model = props.model;

  return (
    <AppPageDialog
      open={props.open}
      title={t("model_page.action.task_settings")}
      size="lg"
      onClose={props.onClose}
      bodyClassName="overflow-hidden p-0"
    >
      <div className="model-page__dialog-scroll">
        <div className="model-page__setting-list">
          {THRESHOLD_FIELDS.filter(
            (field) => field !== "output_token_limit" || model.auth_type !== "oauth",
          ).map((field) => (
            <SettingCardRow
              key={field}
              variant="group"
              title={t(`model_page.fields.${field}.title`)}
              description={t(`model_page.fields.${field}.description`)}
              action={
                <Input
                  className="model-page__field"
                  aria-label={t(`model_page.fields.${field}.title`)}
                  type="number"
                  min={THRESHOLD_INPUT_MIN}
                  max={THRESHOLD_INPUT_MAX}
                  step={1}
                  disabled={props.readonly}
                  value={model.threshold[field]}
                  onChange={(event) => {
                    void props.onPatch({
                      threshold: { [field]: normalize_number_input(event.target.value) },
                    });
                  }}
                />
              }
            />
          ))}
        </div>
      </div>
    </AppPageDialog>
  );
}
