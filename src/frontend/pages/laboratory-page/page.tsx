import type { JSX, ReactNode } from "react";
import type { AppPrefilterSettingKey } from "@domain/project-settings";
import { useI18n } from "@frontend/app/locale/locale-context";
import "@frontend/pages/laboratory-page/laboratory-page.css";
import { useLaboratoryPageState } from "@frontend/pages/laboratory-page/use-laboratory-page-state";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { SettingHelpButton } from "@frontend/widgets/setting-help-button";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

export function LaboratoryPage(): JSX.Element {
  const { locale, t } = useI18n();
  const { snapshot, pending_state, runtime_locked, update_setting } = useLaboratoryPageState();

  function render_setting(field: AppPrefilterSettingKey, title_suffix?: ReactNode): JSX.Element {
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
            disabled={pending_state[field] || runtime_locked}
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
            label={t("laboratory_page.fields.mtool_optimizer_enable.title")}
            className="laboratory-page__help-button"
          />,
        )}
        {render_setting("skip_duplicate_source_text_enable")}
      </section>
    </div>
  );
}
