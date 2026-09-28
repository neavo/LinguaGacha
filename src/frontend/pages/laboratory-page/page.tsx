import type { JSX, ReactNode } from "react";
import { PROJECT_SETTING_KEYS } from "@domain/setting";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { useI18n } from "@frontend/app/locale/locale-context";
import "@frontend/pages/laboratory-page/laboratory-page.css";
import {
  useLaboratoryPageState,
  type LaboratoryField,
} from "@frontend/pages/laboratory-page/use-laboratory-page-state";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { SettingHelpButton } from "@frontend/widgets/setting-help-button";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

/** 实验选项通过页面状态入口保存，仅工程预过滤操作消费运行锁。 */
export function LaboratoryPage(_props: ScreenComponentProps): JSX.Element {
  const { locale, t } = useI18n();
  const { snapshot, pending_state, runtime_locked, update_setting } = useLaboratoryPageState();

  /** 用同一字段关联文案、值、禁用状态和保存命令。 */
  function render_setting(field: LaboratoryField, title_suffix?: ReactNode): JSX.Element {
    const title = t(`laboratory_page.fields.${field}.title`);
    return (
      <SettingCardRow
        title={title}
        title_suffix={title_suffix}
        description={t(`laboratory_page.fields.${field}.description`)}
        action={
          <BooleanSegmentedToggle
            aria_label={title}
            value={snapshot[field]}
            stretch
            disabled={
              pending_state[field] ||
              (runtime_locked && PROJECT_SETTING_KEYS.some((key) => key === field))
            }
            on_value_change={(value) => {
              void update_setting(field, value);
            }}
          />
        }
      />
    );
  }

  return (
    <div className="laboratory-page page-shell page-shell--full">
      <section className="laboratory-page__list" aria-label={t("laboratory_page.title")}>
        {render_setting(
          "mtool_optimizer_enable",
          <SettingHelpButton
            url={`https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer${locale === "zh-CN" ? "" : "EN"}`}
            aria_label={t("laboratory_page.fields.mtool_optimizer_enable.title")}
            className="laboratory-page__help-button"
          />,
        )}
        {render_setting("skip_duplicate_source_text_enable")}
        {render_setting("prompt_enhancement_enable")}
        {render_setting("agent_batch_translation_thinking_adaptive_enable")}
      </section>
    </div>
  );
}
