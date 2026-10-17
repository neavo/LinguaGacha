import type { JSX } from "react";
import { FileType, Play, SquareTerminal } from "lucide-react";

import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { useI18n } from "@frontend/app/locale/locale-context";
import "@frontend/pages/game-font-page/game-font-page.css";
import { useGameFontPageState } from "@frontend/pages/game-font-page/use-game-font-page-state";
import { Spinner } from "@frontend/shadcn/spinner";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { CommandBar, CommandBarGroup } from "@frontend/widgets/command-bar/command-bar";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

/** 选择字体与游戏程序后由后端识别引擎，确认后一次完成解包与替换。 */
export function GameFontPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const state = useGameFontPageState();
  const busy = state.status === "checking" || state.status === "running";

  return (
    <div className="game-font-page page-shell page-shell--full">
      <section className="game-font-page__list" aria-label={t("game_font_page.title")}>
        <SettingCardRow
          action_width="content"
          title={t("game_font_page.fields.font_file.title")}
          description={
            <span className="game-font-page__path">
              {state.paths.font_path ?? t("game_font_page.fields.font_file.description")}
            </span>
          }
          action={
            <AppButton
              variant="outline"
              disabled={busy}
              onClick={() => void state.pick_font_file()}
            >
              <FileType data-icon="inline-start" />
              {t("game_font_page.action.pick_file")}
            </AppButton>
          }
        />

        <SettingCardRow
          action_width="content"
          title={t("game_font_page.fields.game_path.title")}
          description={
            <span className="game-font-page__path">
              {state.paths.game_path ?? t("game_font_page.fields.game_path.description")}
            </span>
          }
          action={
            <AppButton
              variant="outline"
              disabled={busy}
              onClick={() => void state.pick_game_executable()}
            >
              <SquareTerminal data-icon="inline-start" />
              {t("game_font_page.action.pick_executable")}
            </AppButton>
          }
        />
      </section>

      <CommandBar
        className="game-font-page__command-bar"
        actions={
          <CommandBarGroup>
            <AppButton
              variant="ghost"
              size="toolbar"
              disabled={state.status !== "ready"}
              onClick={state.request_apply}
            >
              {busy ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {t("game_font_page.action.start")}
            </AppButton>
          </CommandBarGroup>
        }
      />

      <AppActionDialog
        open={state.confirm_open}
        description={t("game_font_page.confirm.description")}
        details={
          <dl className="game-font-page__confirm">
            <dt>{t("game_font_page.fields.game_path.title")}</dt>
            <dd>{state.paths.game_path}</dd>
            <dt>{t("game_font_page.fields.font_file.title")}</dt>
            <dd>{state.paths.font_path}</dd>
          </dl>
        }
        primaryAction={{
          label: t("game_font_page.action.start"),
          onSelect: state.confirm_apply,
        }}
        onClose={state.close_confirm}
      />
    </div>
  );
}
