import { useRef, useState, type JSX } from "react";
import { FileInput, FileOutput, Play, type LucideIcon } from "lucide-react";

import { extract_file_name } from "@frontend/app/desktop/path";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  push_error_toast,
  push_toast,
  run_modal_progress_toast,
} from "@frontend/app/feedback/desktop-toast";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import type { TranslationInheritanceMode } from "@shared/translation-inheritance";
import { useI18n } from "@frontend/app/locale/locale-context";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import "@frontend/pages/translation-transfer-page/translation-transfer-page.css";
import { SegmentedToggle } from "@frontend/shadcn/segmented-toggle";
import { Spinner } from "@frontend/shadcn/spinner";
import { AppButton } from "@frontend/widgets/app-button";
import { CommandBar, CommandBarGroup } from "@frontend/widgets/command-bar/command-bar";
import type { PathDropIssue } from "@frontend/widgets/file-drop-zone/use-path-drop";
import {
  PathSelectionCard,
  PathSelectionField,
  PathSelectionFields,
} from "@frontend/widgets/path-selection-card/path-selection-card";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

type TransferPaths = Readonly<{ source_path: string | null; base_path: string | null }>; // 未选择时为 null。
type TransferResult = Readonly<{ filled: number; replaced: number; unmatched: number }>;

/** 以迁入工程为基础，迁入迁出工程已完成的译文，另存为新工程。 */
export function TranslationTransferPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const runtime_busy = is_runtime_busy(useRuntimeSnapshot());
  const [paths, set_paths] = useState<TransferPaths>({ source_path: null, base_path: null });
  const [mode, set_mode] = useState<TranslationInheritanceMode>("fill");
  const [running, set_running] = useState(false);
  const running_ref = useRef(false); // 状态提交前，同一轮事件内的重复点击由同步占用拒绝。
  const can_apply =
    paths.source_path !== null &&
    paths.base_path !== null &&
    paths.source_path !== paths.base_path &&
    !runtime_busy &&
    !running;

  /** 选择、拖入和清除共用同一字段写入口。 */
  function set_path(field: keyof TransferPaths, path: string | null): void {
    set_paths((current) => ({ ...current, [field]: path }));
  }

  /** 原生选择取消时保留原路径。 */
  async function pick_path(field: keyof TransferPaths): Promise<void> {
    const result = await window.desktopApp.pickProjectFilePath();
    const selected = result.canceled ? undefined : result.paths[0];
    if (selected !== undefined) set_path(field, selected);
  }

  /** 选择保存位置后生成新工程，完成后保留选择以便再次生成。 */
  async function apply(): Promise<void> {
    if (!can_apply || running_ref.current) return;
    running_ref.current = true;
    set_running(true);
    try {
      const picked = await window.desktopApp.pickProjectSavePath("");
      const output_path = picked.canceled ? undefined : picked.paths[0];
      if (output_path === undefined) return;
      const result = await run_modal_progress_toast({
        message: t("app.feedback.operation_running"),
        task: () =>
          api_fetch<TransferResult>("/api/toolbox/translation-transfer/apply", {
            source_path: paths.source_path,
            base_path: paths.base_path,
            output_path,
            mode,
          }),
      });
      push_toast("success", t("app.feedback.operation_success"), {
        description: t("translation_transfer_page.feedback.result", {
          FILLED: String(result.filled),
          REPLACED: String(result.replaced),
          UNMATCHED: String(result.unmatched),
        }),
      });
    } catch (error) {
      push_error_toast(t("app.feedback.operation_failed"), error);
    } finally {
      running_ref.current = false;
      set_running(false);
    }
  }

  /** 拖入问题保留当前选择，只提示改用点击选择。 */
  function handle_drop_issue(issue: PathDropIssue): void {
    push_toast(
      "warning",
      t(
        issue === "multiple"
          ? "app.drop.select_multiple_unavailable"
          : "app.drop.select_unavailable",
      ),
    );
  }

  /** 两个工程字段共用同一卡片形态，只有图标与标题不同。 */
  function render_field(field: keyof TransferPaths, title: string, icon: LucideIcon): JSX.Element {
    const path = paths[field];
    return (
      <PathSelectionField title={title}>
        <PathSelectionCard
          icon={icon}
          title={t("project_page.open.drop_title")}
          summary={path === null ? null : { name: extract_file_name(path), path }}
          clear_label={t("app.action.reset")}
          on_clear={() => set_path(field, null)}
          onClick={() => void pick_path(field)}
          on_path_drop={(dropped) => set_path(field, dropped)}
          on_drop_issue={handle_drop_issue}
        />
      </PathSelectionField>
    );
  }

  return (
    <div className="translation-transfer-page page-shell page-shell--full">
      <div className="translation-transfer-page__body">
        <PathSelectionFields label={t("translation_transfer_page.title")}>
          {render_field(
            "source_path",
            t("translation_transfer_page.fields.source.title"),
            FileOutput,
          )}
          {render_field("base_path", t("translation_transfer_page.fields.base.title"), FileInput)}
        </PathSelectionFields>
        <SettingCardRow
          title={t("translation_transfer_page.fields.mode.title")}
          description={t(
            mode === "fill"
              ? "translation_transfer_page.fields.mode.fill_description"
              : "translation_transfer_page.fields.mode.overwrite_description",
          )}
          action_width="content"
          action={
            <SegmentedToggle
              aria_label={t("translation_transfer_page.fields.mode.title")}
              value={mode}
              options={[
                { value: "fill", label: t("translation_transfer_page.fields.mode.fill") },
                {
                  value: "overwrite",
                  label: t("translation_transfer_page.fields.mode.overwrite"),
                },
              ]}
              on_value_change={set_mode}
            />
          }
        />
      </div>

      <CommandBar
        actions={
          <CommandBarGroup>
            <AppButton
              variant="ghost"
              size="toolbar"
              disabled={!can_apply}
              onClick={() => void apply()}
            >
              {running ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {t("translation_transfer_page.action.start")}
            </AppButton>
          </CommandBarGroup>
        }
      />
    </div>
  );
}
