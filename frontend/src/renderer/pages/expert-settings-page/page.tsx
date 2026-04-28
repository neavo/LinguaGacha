import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";

import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n } from "@/i18n";
import "@/pages/expert-settings-page/expert-settings-page.css";
import { useExpertSettingsState } from "@/pages/expert-settings-page/use-expert-settings-state";
import {
  PRECEDING_LINES_THRESHOLD_MAX,
  PRECEDING_LINES_THRESHOLD_MIN,
} from "@/pages/expert-settings-page/types";
import { Button } from "@/shadcn/button";
import {
  AppDropdownMenu,
  AppDropdownMenuCheckboxItem,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { Input } from "@/shadcn/input";
import { SettingCardRow } from "@/widgets/setting-card-row/setting-card-row";
import { SegmentedToggle } from "@/widgets/segmented-toggle/segmented-toggle";

type ExpertSettingsPageProps = {
  is_sidebar_collapsed: boolean;
};

function parse_number_draft(
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

export function ExpertSettingsPage(props: ExpertSettingsPageProps): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const expert_settings_state = useExpertSettingsState();
  const [is_response_check_menu_open, set_is_response_check_menu_open] = useState<boolean>(false);
  const [preceding_lines_threshold_draft, set_preceding_lines_threshold_draft] = useState<string>(
    () => {
      return String(expert_settings_state.snapshot.preceding_lines_threshold);
    },
  );
  const [is_preceding_lines_threshold_editing, set_is_preceding_lines_threshold_editing] =
    useState(false);
  const mutation_locked = expert_settings_state.is_task_busy;
  const parsed_preceding_lines_threshold = parse_number_draft(
    preceding_lines_threshold_draft,
    PRECEDING_LINES_THRESHOLD_MIN,
    PRECEDING_LINES_THRESHOLD_MAX,
  );
  const preceding_lines_threshold_invalid = parsed_preceding_lines_threshold === null;
  const boolean_segmented_options = [
    {
      value: "disabled",
      label: t("app.toggle.disabled"),
    },
    {
      value: "enabled",
      label: t("app.toggle.enabled"),
    },
  ] as const;

  function render_boolean_toggle(options: {
    title_key:
      | "expert_settings_page.fields.clean_ruby.title"
      | "expert_settings_page.fields.deduplication_in_trans.title"
      | "expert_settings_page.fields.deduplication_in_bilingual.title"
      | "expert_settings_page.fields.write_translated_name_fields_to_file.title"
      | "expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title";
    value: boolean;
    disabled: boolean;
    on_value_change: (next_value: boolean) => void;
  }): JSX.Element {
    return (
      <SegmentedToggle
        aria_label={t(options.title_key)}
        size="sm"
        value={options.value ? "enabled" : "disabled"}
        options={boolean_segmented_options}
        stretch
        disabled={options.disabled}
        on_value_change={(next_value) => {
          options.on_value_change(next_value === "enabled");
        }}
      />
    );
  }

  async function handle_response_check_menu_button_click(
    event: MouseEvent<HTMLButtonElement>,
  ): Promise<void> {
    event.preventDefault();

    if (mutation_locked) {
      set_is_response_check_menu_open(false);
    } else if (is_response_check_menu_open) {
      set_is_response_check_menu_open(false);
    } else {
      await expert_settings_state.refresh_snapshot();
      set_is_response_check_menu_open(true);
    }
  }

  useEffect(() => {
    if (is_preceding_lines_threshold_editing) {
      return;
    }

    set_preceding_lines_threshold_draft(
      String(expert_settings_state.snapshot.preceding_lines_threshold),
    );
  }, [
    expert_settings_state.snapshot.preceding_lines_threshold,
    is_preceding_lines_threshold_editing,
  ]);

  async function commit_preceding_lines_threshold_draft(): Promise<void> {
    if (parsed_preceding_lines_threshold === null) {
      push_toast("error", t("expert_settings_page.feedback.preceding_lines_threshold_invalid"));
      set_is_preceding_lines_threshold_editing(true);
      return;
    }

    if (
      parsed_preceding_lines_threshold === expert_settings_state.snapshot.preceding_lines_threshold
    ) {
      set_preceding_lines_threshold_draft(String(parsed_preceding_lines_threshold));
      set_is_preceding_lines_threshold_editing(false);
      return;
    }

    await expert_settings_state.update_preceding_lines_threshold(parsed_preceding_lines_threshold);
    set_is_preceding_lines_threshold_editing(false);
  }

  function handle_preceding_lines_threshold_key_down(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void commit_preceding_lines_threshold_draft();
  }

  return (
    <div
      className="expert-settings-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <section className="expert-settings-page__list" aria-label={t("expert_settings_page.title")}>
        <SettingCardRow
          title={t("expert_settings_page.fields.response_check_settings.title")}
          description={t("expert_settings_page.fields.response_check_settings.description")}
          action={
            <AppDropdownMenu
              open={is_response_check_menu_open}
              onOpenChange={(next_open) => {
                set_is_response_check_menu_open(next_open);
              }}
            >
              <AppDropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="expert-settings-page__menu-button"
                  onClick={(event) => {
                    void handle_response_check_menu_button_click(event);
                  }}
                  disabled={mutation_locked}
                >
                  {t("expert_settings_page.fields.response_check_settings.button")}
                </Button>
              </AppDropdownMenuTrigger>
              <AppDropdownMenuContent align="center">
                <AppDropdownMenuGroup>
                  <AppDropdownMenuCheckboxItem
                    checked={expert_settings_state.snapshot.check_kana_residue}
                    disabled={
                      mutation_locked || expert_settings_state.pending_state.check_kana_residue
                    }
                    onCheckedChange={(next_checked) => {
                      if (typeof next_checked === "boolean") {
                        void expert_settings_state.update_check_kana_residue(next_checked);
                      }
                    }}
                  >
                    {t("expert_settings_page.fields.response_check_settings.options.kana_residue")}
                  </AppDropdownMenuCheckboxItem>
                  <AppDropdownMenuCheckboxItem
                    checked={expert_settings_state.snapshot.check_hangeul_residue}
                    disabled={
                      mutation_locked || expert_settings_state.pending_state.check_hangeul_residue
                    }
                    onCheckedChange={(next_checked) => {
                      if (typeof next_checked === "boolean") {
                        void expert_settings_state.update_check_hangeul_residue(next_checked);
                      }
                    }}
                  >
                    {t(
                      "expert_settings_page.fields.response_check_settings.options.hangeul_residue",
                    )}
                  </AppDropdownMenuCheckboxItem>
                  <AppDropdownMenuCheckboxItem
                    checked={expert_settings_state.snapshot.check_similarity}
                    disabled={
                      mutation_locked || expert_settings_state.pending_state.check_similarity
                    }
                    onCheckedChange={(next_checked) => {
                      if (typeof next_checked === "boolean") {
                        void expert_settings_state.update_check_similarity(next_checked);
                      }
                    }}
                  >
                    {t("expert_settings_page.fields.response_check_settings.options.similarity")}
                  </AppDropdownMenuCheckboxItem>
                </AppDropdownMenuGroup>
              </AppDropdownMenuContent>
            </AppDropdownMenu>
          }
        />

        <SettingCardRow
          title={t("expert_settings_page.fields.preceding_lines_threshold.title")}
          description={t("expert_settings_page.fields.preceding_lines_threshold.description")}
          action={
            <div className="expert-settings-page__number-field">
              <Input
                type="number"
                min={PRECEDING_LINES_THRESHOLD_MIN}
                max={PRECEDING_LINES_THRESHOLD_MAX}
                value={preceding_lines_threshold_draft}
                aria-invalid={preceding_lines_threshold_invalid || undefined}
                disabled={
                  mutation_locked || expert_settings_state.pending_state.preceding_lines_threshold
                }
                onChange={(event) => {
                  set_is_preceding_lines_threshold_editing(true);
                  set_preceding_lines_threshold_draft(event.target.value);
                }}
                onBlur={() => {
                  void commit_preceding_lines_threshold_draft();
                }}
                onKeyDown={handle_preceding_lines_threshold_key_down}
                onFocus={() => {
                  set_is_preceding_lines_threshold_editing(true);
                }}
              />
            </div>
          }
        />

        <SettingCardRow
          title={t("expert_settings_page.fields.clean_ruby.title")}
          description={t("expert_settings_page.fields.clean_ruby.description")}
          action={render_boolean_toggle({
            title_key: "expert_settings_page.fields.clean_ruby.title",
            value: expert_settings_state.snapshot.clean_ruby,
            disabled: mutation_locked || expert_settings_state.pending_state.clean_ruby,
            on_value_change: (next_value) => {
              void expert_settings_state.update_clean_ruby(next_value);
            },
          })}
        />

        <SettingCardRow
          title={t("expert_settings_page.fields.deduplication_in_trans.title")}
          description={t("expert_settings_page.fields.deduplication_in_trans.description")}
          action={render_boolean_toggle({
            title_key: "expert_settings_page.fields.deduplication_in_trans.title",
            value: expert_settings_state.snapshot.deduplication_in_trans,
            disabled: mutation_locked || expert_settings_state.pending_state.deduplication_in_trans,
            on_value_change: (next_value) => {
              void expert_settings_state.update_deduplication_in_trans(next_value);
            },
          })}
        />

        <SettingCardRow
          title={t("expert_settings_page.fields.deduplication_in_bilingual.title")}
          description={t("expert_settings_page.fields.deduplication_in_bilingual.description")}
          action={render_boolean_toggle({
            title_key: "expert_settings_page.fields.deduplication_in_bilingual.title",
            value: expert_settings_state.snapshot.deduplication_in_bilingual,
            disabled:
              mutation_locked || expert_settings_state.pending_state.deduplication_in_bilingual,
            on_value_change: (next_value) => {
              void expert_settings_state.update_deduplication_in_bilingual(next_value);
            },
          })}
        />

        <SettingCardRow
          title={t("expert_settings_page.fields.write_translated_name_fields_to_file.title")}
          description={t(
            "expert_settings_page.fields.write_translated_name_fields_to_file.description",
          )}
          action={render_boolean_toggle({
            title_key: "expert_settings_page.fields.write_translated_name_fields_to_file.title",
            value: expert_settings_state.snapshot.write_translated_name_fields_to_file,
            disabled:
              mutation_locked ||
              expert_settings_state.pending_state.write_translated_name_fields_to_file,
            on_value_change: (next_value) => {
              void expert_settings_state.update_write_translated_name_fields_to_file(next_value);
            },
          })}
        />

        <SettingCardRow
          title={t("expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title")}
          description={t(
            "expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.description",
          )}
          action={render_boolean_toggle({
            title_key:
              "expert_settings_page.fields.auto_process_prefix_suffix_preserved_text.title",
            value: expert_settings_state.snapshot.auto_process_prefix_suffix_preserved_text,
            disabled:
              mutation_locked ||
              expert_settings_state.pending_state.auto_process_prefix_suffix_preserved_text,
            on_value_change: (next_value) => {
              void expert_settings_state.update_auto_process_prefix_suffix_preserved_text(
                next_value,
              );
            },
          })}
        />
      </section>
    </div>
  );
}
