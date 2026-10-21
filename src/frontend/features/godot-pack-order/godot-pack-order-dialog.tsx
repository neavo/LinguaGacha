import { type JSX } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical } from "lucide-react";
import type { GodotPackPreview } from "@shared/godot";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Card, CardTitle } from "@frontend/shadcn/card";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";
import {
  SORTABLE_OPTIONS,
  SORTABLE_PROVIDER_OPTIONS,
} from "@frontend/widgets/interactions/sortable";
import "./godot-pack-order.css";

/** 把手只表达排序状态，完整文件名由正文区域展示。 */
function PackRow(props: { name: string; index: number }): JSX.Element {
  const { t } = useI18n();
  const drag_label = t("app.drag.enabled");
  const { ref, handleRef, isDragSource } = useSortable({
    ...SORTABLE_OPTIONS,
    id: props.name,
    index: props.index,
  });
  return (
    <li ref={ref} className="godot-pack-order__row" data-dragging={isDragSource || undefined}>
      <span className="godot-pack-order__number">{props.index + 1}</span>
      <span className="godot-pack-order__name" title={props.name}>
        {props.name}
      </span>
      <Tooltip disabled={isDragSource}>
        <TooltipTrigger
          render={
            <AppButton ref={handleRef} variant="ghost" size="icon-sm" aria-label={drag_label}>
              <GripVertical aria-hidden="true" />
            </AppButton>
          }
        />
        <TooltipContent>{drag_label}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/** 每个游戏使用独立拖动上下文，防止跨游戏混排。 */
function PackGroup(props: {
  game: GodotPackPreview;
  on_reorder: (names: string[]) => void;
}): JSX.Element {
  const reorder = useReorder({
    ids: props.game.external_pcks,
    disabled: false,
    on_reorder: async (names) => props.on_reorder(names),
  });
  return (
    <Card variant="group" className="godot-pack-order__group">
      <CardTitle className="godot-pack-order__game" title={props.game.game_root}>
        {props.game.game_name}
      </CardTitle>
      <DragDropProvider {...SORTABLE_PROVIDER_OPTIONS} {...reorder.events}>
        <ol className="godot-pack-order__list">
          {reorder.ordered_ids.map((name, index) => (
            <PackRow key={name} name={name} index={index} />
          ))}
        </ol>
      </DragDropProvider>
    </Card>
  );
}

/** 草稿归 Hook 持有，视图直接消费当前顺序，关闭后释放整个会话。 */
export function GodotPackOrderDialog(props: {
  games: readonly GodotPackPreview[];
  on_reorder: (game_root: string, names: string[]) => void;
  on_confirm: () => void;
  on_close: () => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (!props.games.length) return null;
  return (
    <AppPageDialog
      open
      title={t("app.godot_pack_order.title")}
      size="sm"
      primaryAction={{
        label: t("app.action.confirm"),
        shortcut: "submit",
        onSelect: props.on_confirm,
      }}
      onClose={props.on_close}
    >
      <div className="godot-pack-order">
        <header className="godot-pack-order__heading">
          <h2 className="godot-pack-order__title font-heading">
            {t("app.godot_pack_order.title")}
          </h2>
          <p className="godot-pack-order__description">{t("app.godot_pack_order.description")}</p>
        </header>
        {props.games.map((game) => (
          <PackGroup
            key={game.game_root}
            game={game}
            on_reorder={(names) => props.on_reorder(game.game_root, names)}
          />
        ))}
      </div>
    </AppPageDialog>
  );
}
