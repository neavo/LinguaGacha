import { GodotPackOrderDialog } from "@frontend/features/godot-pack-order/godot-pack-order-dialog";
import type { JSX } from "react";
import { FileType, FolderOpen, Gamepad2, Play, SquareTerminal } from "lucide-react";

import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import "@frontend/pages/game-font-page/game-font-page.css";
import { useGameFontPageState } from "@frontend/pages/game-font-page/use-game-font-page-state";
import { Spinner } from "@frontend/shadcn/spinner";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuTrigger,
} from "@frontend/widgets/app-context-menu";
import { CommandBar, CommandBarGroup } from "@frontend/widgets/command-bar/command-bar";
import type { PathDropIssue } from "@frontend/widgets/file-drop-zone/use-path-drop";
import {
  PathSelectionCard,
  type PathSelectionSummary,
} from "@frontend/widgets/path-selection-card/path-selection-card";
import { open_context_menu_at_click_position } from "@frontend/widgets/app-menu";

/** 名称取路径末段，目录路径末尾的分隔符不影响结果。 */
function build_summary(path: string | null): PathSelectionSummary | null {
  if (path === null) return null;
  return {
    name: path.split(/[\\/]+/u).findLast((segment) => segment !== "") ?? path,
    detail: path,
  };
}

/** 点击或拖入选择游戏与字体，后端检查通过后确认修改游戏字体。 */
export function GameFontPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const state = useGameFontPageState();

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

  return (
    <div className="game-font-page page-shell page-shell--full">
      <section className="game-font-page__fields" aria-label={t("game_font_page.title")}>
        <div className="game-font-page__field">
          <h2 className="game-font-page__field-title">{t("game_font_page.fields.game.title")}</h2>
          <AppContextMenu disabled={state.input_locked}>
            <AppContextMenuTrigger
              render={
                <PathSelectionCard
                  icon={Gamepad2}
                  title={t("game_font_page.fields.game.description")}
                  summary={build_summary(state.paths.game_path)}
                  clear_label={t("app.action.reset")}
                  on_clear={() => void state.clear_path("game_path")}
                  disabled={state.input_locked}
                  onClick={open_context_menu_at_click_position}
                  on_path_drop={(path) => state.drop_path("game_path", path)}
                  on_drop_issue={handle_drop_issue}
                />
              }
            />
            <AppContextMenuContent>
              <AppContextMenuItem onClick={() => void state.pick_game_executable()}>
                <SquareTerminal className="size-4" />
                {t("game_font_page.action.pick_executable")}
              </AppContextMenuItem>
              <AppContextMenuItem onClick={() => void state.pick_game_directory()}>
                <FolderOpen className="size-4" />
                {t("game_font_page.action.pick_directory")}
              </AppContextMenuItem>
            </AppContextMenuContent>
          </AppContextMenu>
        </div>

        <div className="game-font-page__field">
          <h2 className="game-font-page__field-title">
            {t("game_font_page.fields.font_file.title")}
          </h2>
          <PathSelectionCard
            icon={FileType}
            title={t("game_font_page.fields.font_file.description")}
            hint={t("game_font_page.fields.font_file.hint")}
            summary={build_summary(state.paths.font_path)}
            clear_label={t("app.action.reset")}
            on_clear={() => void state.clear_path("font_path")}
            disabled={state.input_locked}
            onClick={() => void state.pick_font_file()}
            on_path_drop={(path) => state.drop_path("font_path", path)}
            on_drop_issue={handle_drop_issue}
          />
        </div>
      </section>

      <CommandBar
        actions={
          <CommandBarGroup>
            <AppButton
              variant="ghost"
              size="toolbar"
              disabled={!state.can_apply}
              onClick={state.request_apply}
            >
              {state.loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {t("game_font_page.action.start")}
            </AppButton>
          </CommandBarGroup>
        }
      />

      <GodotPackOrderDialog {...state.godot_pack_order.dialog_props} />
      <AppActionDialog
        open={state.confirm_open}
        description={t("game_font_page.confirm.description")}
        details={
          <dl className="game-font-page__confirm">
            <dt>{t("game_font_page.fields.game.title")}</dt>
            <dd>{state.paths.game_path}</dd>
            <dt>{t("game_font_page.fields.font_file.title")}</dt>
            <dd>{state.paths.font_path}</dd>
          </dl>
        }
        primaryAction={{ label: t("game_font_page.action.start"), onSelect: state.confirm_apply }}
        onClose={state.close_confirm}
      />
    </div>
  );
}
