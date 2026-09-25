import {
  AlertCircle,
  Ban,
  CircleCheck,
  CircleMinus,
  CopyX,
  Eraser,
  Eye,
  ListChecks,
  ListX,
  PencilLine,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import { type JSX, useMemo, type ReactNode } from "react";

import { ITEM_MANUAL_STATUSES, type ItemManualStatus } from "@domain/item";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
} from "@frontend/features/proofreading/proofreading-label-keys";
import {
  is_proofreading_page_row_id,
  type ProofreadingWarningCode,
  type ProofreadingRow,
} from "@shared/proofreading/proofreading-types";
import { Badge } from "@frontend/shadcn/badge";
import { Card, CardContent } from "@frontend/shadcn/card";
import { Spinner } from "@frontend/shadcn/spinner";
import {
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuShortcut,
  AppContextMenuSub,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
} from "@frontend/widgets/app-context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import { read_optional_item_name_text } from "@shared/item-name";
import type {
  AppTableColumn,
  AppTableRowModel,
  AppTableScrollAnchor,
  AppTableScrollTarget,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";

// 收口校对页状态 Hook 提供的只读展示和行操作入口。
type ProofreadingTableProps = {
  items: ProofreadingRow[];
  visible_row_count: number;
  sort_state: AppTableSortState | null;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  retranslating_row_ids: string[];
  readonly: boolean;
  get_row_at_index: (index: number) => ProofreadingRow | undefined;
  get_row_id_at_index: (index: number) => string | undefined;
  resolve_row_index: (row_id: string) => number | undefined;
  resolve_row_index_async: (row_id: string) => Promise<number | undefined>;
  resolve_row_ids_range: (range: { start: number; count: number }) => Promise<string[]>;
  on_visible_range_change: (range: { start: number; count: number }) => void;
  scroll_to_row: AppTableScrollTarget | null;
  preserve_scroll_anchor: AppTableScrollAnchor;
  on_sort_change: (next_sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_selection_error: (error: unknown) => void;
  on_open_edit: (row_id: string) => void;
  on_request_retranslate_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  on_request_clear_translation_row_ids: (
    row_ids: string[],
    preferred_row_id?: string | null,
  ) => void;
  on_request_set_translation_status_row_ids: (
    row_ids: string[],
    status: ItemManualStatus,
    preferred_row_id?: string | null,
  ) => void;
};

type ProofreadingStatusIconTone = "success" | "warning" | "failure" | "neutral";

// 菜单选择后会恢复焦点，弹窗动作延后一拍以免同轮抢焦点。
function run_after_context_menu_close(action: () => void): void {
  window.setTimeout(action, 0);
}

/** 将条目处理状态映射为当前表格的状态图标。 */
function resolve_status_icon(status: string): typeof AlertCircle | null {
  if (status === "PROCESSED") {
    return CircleCheck;
  }
  if (status === "ERROR") {
    return AlertCircle;
  }
  if (status === "EXCLUDED") {
    return Ban;
  }
  if (status === "LANGUAGE_SKIPPED") {
    return CircleMinus;
  }
  if (status === "RULE_SKIPPED") {
    return ListX;
  }
  if (status === "DUPLICATED") {
    return CopyX;
  }

  return null;
}

/** 成功与失败突出显示，其余状态使用中性图标色。 */
function resolve_status_icon_tone(status: string): ProofreadingStatusIconTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }

  return "neutral";
}

// 正文负责单行展示，尾部按钮通过表格交互标记独立预览全文。
function ProofreadingTextCell(props: {
  name: string | null;
  text: string;
  full_text: string;
  label: string; // 复用列标题作为按钮名称，让辅助技术区分原文和译文。
}): JSX.Element {
  return (
    <span className="proofreading-page__table-text-line">
      {props.name === null ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge className="proofreading-page__table-name-badge">
                <span className="proofreading-page__table-name-badge-label">{props.name}</span>
              </Badge>
            }
          />
          <TooltipContent>{props.name}</TooltipContent>
        </Tooltip>
      )}
      <span className="proofreading-page__table-text">{props.text}</span>
      {props.full_text !== "" && (
        <Tooltip>
          <TooltipTrigger
            render={
              <AppButton
                variant="ghost"
                size="icon-xs"
                className="proofreading-page__text-preview-trigger"
                aria-label={props.label}
                data-app-table-ignore-row-click="true"
                data-app-table-ignore-box-select="true"
              >
                <Eye aria-hidden="true" />
              </AppButton>
            }
          />
          <TooltipContent className="proofreading-page__text-preview">
            <div className="proofreading-page__text-preview-body">{props.full_text}</div>
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

/** 状态、警告和重翻共用图标与提示容器，行操作继续由表格拥有。 */
function ProofreadingStatusIndicator(props: {
  tone: ProofreadingStatusIconTone;
  icon: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={`proofreading-page__status-icon proofreading-page__status-icon--${props.tone}`}
            data-app-table-ignore-box-select="true"
            data-app-table-ignore-row-click="true"
          >
            {props.icon}
          </span>
        }
      />
      <TooltipContent>
        <div className="grid gap-1">{props.children}</div>
      </TooltipContent>
    </Tooltip>
  );
}

/** 文本和页面按同一状态映射显示图标与提示。 */
function ProofreadingStatusCell(props: {
  status: string;
  warnings: readonly ProofreadingWarningCode[];
  retranslating: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const StatusIcon = resolve_status_icon(props.status);
  const status_label_key =
    PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
      props.status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
    ];
  const status_label = status_label_key === undefined ? props.status : t(status_label_key);
  if (props.retranslating)
    return (
      <div className="proofreading-page__status-icons">
        <ProofreadingStatusIndicator
          tone="neutral"
          icon={<Spinner className="proofreading-page__status-spinner" />}
        >
          <p>
            {t("app.tooltip.value", {
              TITLE: t("proofreading_page.fields.status"),
              VALUE: t("proofreading_page.action.retranslate"),
            })}
          </p>
        </ProofreadingStatusIndicator>
      </div>
    );
  if (StatusIcon === null && props.warnings.length === 0) return null;
  const warning_label = props.warnings
    .map((warning) => {
      const key = PROOFREADING_WARNING_LABEL_KEY_BY_CODE[warning];
      return key === undefined ? warning : t(key);
    })
    .join(" | ");
  return (
    <div className="proofreading-page__status-icons">
      {StatusIcon && (
        <ProofreadingStatusIndicator
          tone={resolve_status_icon_tone(props.status)}
          icon={<StatusIcon />}
        >
          <p>
            {t("app.tooltip.value", {
              TITLE: t("proofreading_page.fields.status"),
              VALUE: status_label,
            })}
          </p>
        </ProofreadingStatusIndicator>
      )}
      {props.warnings.length > 0 && (
        <ProofreadingStatusIndicator tone="warning" icon={<TriangleAlert />}>
          <p>
            {t("app.tooltip.value", {
              TITLE: t("proofreading_page.tooltip.warning_title"),
              VALUE: warning_label,
            })}
          </p>
        </ProofreadingStatusIndicator>
      )}
    </div>
  );
}

// 把校对页远端窗口模型适配给通用 `AppTable`。
export function ProofreadingTable(props: ProofreadingTableProps): JSX.Element {
  const { t } = useI18n();
  // 让状态列 O(1) 判断行级重翻状态。
  const retranslating_row_id_set = useMemo(() => {
    return new Set(props.retranslating_row_ids);
  }, [props.retranslating_row_ids]);
  // 表格通过行身份和位置读取远端窗口，查询视图身份由校对页维护。
  const row_model = useMemo<AppTableRowModel<ProofreadingRow>>(() => {
    return {
      row_count: props.visible_row_count,
      loaded_row_ids: props.items.map((item) => item.row_id),
      get_row_at_index: props.get_row_at_index,
      get_row_id_at_index: props.get_row_id_at_index,
      resolve_row_index: props.resolve_row_index,
      resolve_row_index_async: props.resolve_row_index_async,
      resolve_row_ids_range: props.resolve_row_ids_range,
      on_visible_range_change: props.on_visible_range_change,
    };
  }, [
    props.get_row_at_index,
    props.get_row_id_at_index,
    props.items,
    props.on_visible_range_change,
    props.resolve_row_index_async,
    props.resolve_row_ids_range,
    props.resolve_row_index,
    props.visible_row_count,
  ]);
  // 校对页表格语义和菜单入口的唯一列配置。
  const columns = useMemo<AppTableColumn<ProofreadingRow>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("app.drag.handle"),
        head_class_name: "proofreading-page__table-drag-head",
        cell_class_name: "proofreading-page__table-drag-cell",
      },
      {
        kind: "data",
        id: "src",
        title: t("proofreading_page.fields.source"),
        sortable: {
          action_labels: {
            ascending: t("proofreading_page.sort.ascending"),
            descending: t("proofreading_page.sort.descending"),
            clear: t("proofreading_page.sort.clear"),
          },
        },
        head_class_name: "proofreading-page__table-source-head",
        cell_class_name: "proofreading-page__table-source-cell",
        render_cell: (payload) => {
          if (payload.row.kind === "page")
            return (
              <span className="proofreading-page__table-text">
                {payload.row.page.file_path} ·{" "}
                {t("proofreading_page.pages.source_page", { PAGE: String(payload.row.page.page) })}
              </span>
            );
          return (
            <ProofreadingTextCell
              label={t("proofreading_page.fields.source")}
              name={read_optional_item_name_text(payload.row.item.name_src)}
              text={payload.row.compressed_src}
              full_text={payload.row.item.src}
            />
          );
        },
      },
      {
        kind: "data",
        id: "dst",
        title: t("proofreading_page.fields.translation"),
        sortable: {
          action_labels: {
            ascending: t("proofreading_page.sort.ascending"),
            descending: t("proofreading_page.sort.descending"),
            clear: t("proofreading_page.sort.clear"),
          },
        },
        head_class_name: "proofreading-page__table-translation-head",
        cell_class_name: "proofreading-page__table-translation-cell",
        render_cell: (payload) => {
          if (payload.row.kind === "page")
            return payload.row.page.status === "NONE" ? null : (
              <span className="proofreading-page__table-text">
                {t("proofreading_page.pages.view")}
              </span>
            );
          return (
            <ProofreadingTextCell
              label={t("proofreading_page.fields.translation")}
              name={read_optional_item_name_text(payload.row.item.name_dst)}
              text={payload.row.compressed_dst}
              full_text={payload.row.item.dst}
            />
          );
        },
      },
      {
        kind: "data",
        id: "status",
        title: t("proofreading_page.fields.status"),
        width: 108,
        align: "center",
        sortable: {
          action_labels: {
            ascending: t("proofreading_page.sort.ascending"),
            descending: t("proofreading_page.sort.descending"),
            clear: t("proofreading_page.sort.clear"),
          },
        },
        head_class_name: "proofreading-page__table-status-head",
        cell_class_name: "proofreading-page__table-status-cell",
        render_cell: (payload) => {
          const row = payload.row;
          return (
            <ProofreadingStatusCell
              status={row.kind === "item" ? row.item.status : row.page.status}
              warnings={row.kind === "item" ? row.item.warnings : []}
              retranslating={row.kind === "item" && retranslating_row_id_set.has(row.row_id)}
            />
          );
        },
      },
    ];
  }, [retranslating_row_id_set, t]);

  return (
    <Card variant="table" className="proofreading-page__table-card">
      <CardContent className="proofreading-page__table-card-content">
        <AppTable
          rows={props.items}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_row_ids}
          active_row_id={props.active_row_id}
          anchor_row_id={props.anchor_row_id}
          sort_state={props.sort_state}
          get_row_id={(item) => item.row_id}
          row_model={row_model}
          scroll_to_row={props.scroll_to_row ?? undefined}
          preserve_scroll_anchor={props.preserve_scroll_anchor}
          on_selection_change={props.on_selection_change}
          on_selection_error={props.on_selection_error}
          on_sort_change={props.on_sort_change}
          on_row_activate={props.on_open_edit}
          render_row_context_menu_items={(payload) => {
            const target_row_ids = payload.target_row_ids;
            const text_only = target_row_ids.every((id) => !is_proofreading_page_row_id(id));

            return (
              <AppContextMenuGroup>
                {!text_only && (
                  <span className="px-2 text-xs text-muted-foreground">
                    {t("proofreading_page.pages.text_only")}
                  </span>
                )}
                <AppContextMenuItem
                  aria-keyshortcuts="Enter"
                  onClick={() => {
                    run_after_context_menu_close(() => {
                      props.on_open_edit(payload.row_id);
                    });
                  }}
                >
                  <PencilLine />
                  {t(
                    is_proofreading_page_row_id(payload.row_id)
                      ? "proofreading_page.pages.title"
                      : "app.action.edit",
                  )}
                  <AppContextMenuShortcut>Enter</AppContextMenuShortcut>
                </AppContextMenuItem>
                <AppContextMenuItem
                  disabled={props.readonly || !text_only}
                  onClick={() => {
                    run_after_context_menu_close(() => {
                      props.on_request_retranslate_row_ids(target_row_ids, payload.row_id);
                    });
                  }}
                >
                  <RefreshCcw />
                  {t("proofreading_page.action.retranslate")}
                </AppContextMenuItem>
                <AppContextMenuItem
                  disabled={props.readonly || !text_only}
                  onClick={() => {
                    run_after_context_menu_close(() => {
                      props.on_request_clear_translation_row_ids(target_row_ids, payload.row_id);
                    });
                  }}
                >
                  <Eraser />
                  {t("proofreading_page.action.clear_translation")}
                </AppContextMenuItem>
                <AppContextMenuSub>
                  <AppContextMenuSubTrigger disabled={props.readonly || !text_only}>
                    <ListChecks />
                    {t("proofreading_page.action.set_translation_status")}
                  </AppContextMenuSubTrigger>
                  <AppContextMenuSubContent>
                    {ITEM_MANUAL_STATUSES.map((status) => (
                      <AppContextMenuItem
                        key={status}
                        disabled={props.readonly || !text_only}
                        onClick={() => {
                          props.on_request_set_translation_status_row_ids(
                            target_row_ids,
                            status,
                            payload.row_id,
                          );
                        }}
                      >
                        {t(PROOFREADING_STATUS_LABEL_KEY_BY_CODE[status])}
                      </AppContextMenuItem>
                    ))}
                  </AppContextMenuSubContent>
                </AppContextMenuSub>
              </AppContextMenuGroup>
            );
          }}
          box_selection_enabled
        />
      </CardContent>
    </Card>
  );
}
