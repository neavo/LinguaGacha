import {
  AlertCircle,
  Ban,
  CircleCheck,
  CircleMinus,
  CopyX,
  Eraser,
  ListChecks,
  ListX,
  PencilLine,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  type ProofreadingItem,
  type ProofreadingManualStatusCode,
  type ProofreadingVisibleItem,
} from "@shared/proofreading/proofreading-types";
import { Badge } from "@frontend/shadcn/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@frontend/shadcn/card";
import { Spinner } from "@frontend/shadcn/spinner";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
  AppContextMenuSub,
  AppContextMenuSubContent,
  AppContextMenuSubTrigger,
} from "@frontend/widgets/app-context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import { AppTableDragIndicator } from "@frontend/widgets/app-table/app-table-drag-indicator";
import { read_optional_item_name_text } from "@shared/item-name";
import type {
  AppTableColumn,
  AppTableRowModel,
  AppTableScrollAnchor,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";

// 收口校对页状态 Hook 给表格层的只读展示和行操作入口。
type ProofreadingTableProps = {
  items: ProofreadingVisibleItem[];
  visible_row_count: number;
  sort_state: AppTableSortState | null;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  retranslating_row_ids: string[];
  readonly: boolean;
  get_row_at_index: (index: number) => ProofreadingVisibleItem | undefined;
  get_row_id_at_index: (index: number) => string | undefined;
  resolve_row_index: (row_id: string) => number | undefined;
  resolve_row_index_async: (row_id: string) => Promise<number | undefined>;
  resolve_row_ids_range: (range: { start: number; count: number }) => Promise<string[]>;
  on_visible_range_change: (range: { start: number; count: number }) => void;
  restore_scroll_row_id: string | null;
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
    status: ProofreadingManualStatusCode,
    preferred_row_id?: string | null,
  ) => void;
};

type ProofreadingStatusIconTone = "success" | "warning" | "failure" | "neutral";

/**
 * 判断当前值是否满足业务条件。
 */
function should_ignore_box_selection_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-proofreading-ignore-box-select="true"]',
        '[data-app-table-ignore-box-select="true"]',
        '[data-slot="scroll-area-scrollbar"]',
        '[data-slot="scroll-area-thumb"]',
        '[data-slot="scroll-area-corner"]',
      ].join(", "),
    ) !== null
  );
}

/**
 * 判断当前值是否满足业务条件。
 */
function should_ignore_row_click_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-proofreading-ignore-row-click="true"]',
        '[data-app-table-ignore-row-click="true"]',
      ].join(", "),
    ) !== null
  );
}

/**
 * 执行当前场景的异步流程。
 */
function run_after_context_menu_close(action: () => void): void {
  // Radix ContextMenu 会在 select 后恢复焦点；弹窗类动作延后一拍，避免两个临时 layer 同轮抢焦点。
  window.setTimeout(action, 0);
}

/**
 * 解析当前场景的最终消费值。
 */
function resolve_context_target_row_ids(row_id: string, selected_row_ids: string[]): string[] {
  if (selected_row_ids.includes(row_id)) {
    return selected_row_ids;
  }

  return [row_id];
}

/**
 * 构建当前场景的稳定结果。
 */
function build_row_number_label(row_index: number): string {
  return String(row_index + 1);
}

/**
 * 解析当前场景的最终消费值。
 */
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

/**
 * 解析当前场景的最终消费值。
 */
function resolve_status_icon_tone(status: string): ProofreadingStatusIconTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }

  return "neutral";
}

/**
 * 构建当前场景的稳定结果。
 */
function build_compact_tooltip(template: string, title: string, content: string): string {
  return template.replace("{TITLE}", title).replace("{STATE}", content);
}

function render_name_prefixed_text(args: { name: string | null; text: string }): JSX.Element {
  return (
    <span className="proofreading-page__table-text-line">
      {args.name === null ? null : (
        <Badge
          variant="secondary"
          title={args.name}
          className="proofreading-page__table-name-badge"
        >
          <span className="proofreading-page__table-name-badge-label">{args.name}</span>
        </Badge>
      )}
      <span className="proofreading-page__table-text">{args.text}</span>
    </span>
  );
}

// 只负责状态和 warning 图标展示，批量操作仍由行上下文菜单处理。
export function ProofreadingStatusCell(props: {
  item: ProofreadingItem;
  retranslating: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const StatusIcon = resolve_status_icon(props.item.status);
  const status_icon_tone = resolve_status_icon_tone(props.item.status);
  const warning_label = props.item.warnings
    .map((warning) => {
      const label_key =
        PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
          warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
        ];
      return label_key === undefined ? warning : t(label_key);
    })
    .join(" | ");
  const status_label_key =
    PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
      props.item.status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
    ];
  const status_label = status_label_key === undefined ? props.item.status : t(status_label_key);
  const compact_tooltip_template = t("proofreading_page.toggle.status");

  if (props.retranslating) {
    return (
      <div className="proofreading-page__status-icons">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="proofreading-page__status-icon"
              data-proofreading-ignore-box-select="true"
              data-proofreading-ignore-row-click="true"
            >
              <Spinner className="proofreading-page__status-spinner" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>
              {build_compact_tooltip(
                compact_tooltip_template,
                t("proofreading_page.fields.status"),
                t("proofreading_page.action.retranslate"),
              )}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (StatusIcon === null && props.item.warnings.length === 0) {
    return null;
  }

  return (
    <div className="proofreading-page__status-icons">
      {StatusIcon === null ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={[
                "proofreading-page__status-icon",
                `proofreading-page__status-icon--${status_icon_tone}`,
              ].join(" ")}
              data-proofreading-ignore-box-select="true"
              data-proofreading-ignore-row-click="true"
            >
              <StatusIcon />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>
              {build_compact_tooltip(
                compact_tooltip_template,
                t("proofreading_page.fields.status"),
                status_label,
              )}
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {props.item.warnings.length === 0 ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="proofreading-page__status-icon proofreading-page__status-icon--warning"
              data-proofreading-ignore-box-select="true"
              data-proofreading-ignore-row-click="true"
            >
              <TriangleAlert />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>
              {build_compact_tooltip(
                compact_tooltip_template,
                t("proofreading_page.tooltip.warning_title"),
                warning_label,
              )}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// 把校对页远端窗口模型适配给通用 AppTable。
export function ProofreadingTable(props: ProofreadingTableProps): JSX.Element {
  const { t } = useI18n();
  // 让状态列 O(1) 判断行级重翻状态。
  const retranslating_row_id_set = useMemo(() => {
    return new Set(props.retranslating_row_ids);
  }, [props.retranslating_row_ids]);
  // 暴露远端窗口读取能力，AppTable 不需要理解校对页 view id。
  const row_model = useMemo<AppTableRowModel<ProofreadingVisibleItem>>(() => {
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
  const columns = useMemo<AppTableColumn<ProofreadingVisibleItem>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("proofreading_page.fields.drag"),
        head_class_name: "proofreading-page__table-drag-head",
        cell_class_name: "proofreading-page__table-drag-cell",
        render_cell: (payload) => {
          return (
            <AppTableDragIndicator
              row_number={build_row_number_label(payload.row_index)}
              can_drag={payload.can_drag}
              dragging={payload.dragging}
              drag_handle={payload.drag_handle}
              show_tooltip={payload.presentation !== "overlay"}
            />
          );
        },
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
          return render_name_prefixed_text({
            name: read_optional_item_name_text(payload.row.item.name_src),
            text: payload.row.compressed_src,
          });
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
          return render_name_prefixed_text({
            name: read_optional_item_name_text(payload.row.item.name_dst),
            text: payload.row.compressed_dst,
          });
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
          if (payload.presentation === "overlay") {
            return null;
          }

          return (
            <ProofreadingStatusCell
              item={payload.row.item}
              retranslating={retranslating_row_id_set.has(payload.row.row_id)}
            />
          );
        },
      },
    ];
  }, [retranslating_row_id_set, t]);

  return (
    <Card variant="table" className="proofreading-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t("proofreading_page.title")}</CardTitle>
      </CardHeader>
      <CardContent className="proofreading-page__table-card-content">
        <AppTable
          rows={props.items}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_row_ids}
          active_row_id={props.active_row_id}
          anchor_row_id={props.anchor_row_id}
          sort_state={props.sort_state}
          drag_enabled={false}
          get_row_id={(item) => item.row_id}
          row_model={row_model}
          restore_scroll_row_id={props.restore_scroll_row_id}
          preserve_scroll_anchor={props.preserve_scroll_anchor}
          on_selection_change={props.on_selection_change}
          on_selection_error={props.on_selection_error}
          on_sort_change={props.on_sort_change}
          on_reorder={() => {}}
          on_row_double_click={(payload) => {
            props.on_open_edit(payload.row_id);
          }}
          render_row_context_menu={(payload) => {
            const target_row_ids = resolve_context_target_row_ids(
              payload.row_id,
              props.selected_row_ids,
            );

            return (
              <AppContextMenuContent>
                <AppContextMenuGroup>
                  <AppContextMenuItem
                    onSelect={() => {
                      run_after_context_menu_close(() => {
                        props.on_open_edit(payload.row_id);
                      });
                    }}
                  >
                    <PencilLine />
                    {t("proofreading_page.action.edit")}
                  </AppContextMenuItem>
                  <AppContextMenuItem
                    disabled={props.readonly}
                    onSelect={() => {
                      run_after_context_menu_close(() => {
                        props.on_request_retranslate_row_ids(target_row_ids, payload.row_id);
                      });
                    }}
                  >
                    <RefreshCcw />
                    {t("proofreading_page.action.retranslate")}
                  </AppContextMenuItem>
                  <AppContextMenuItem
                    disabled={props.readonly}
                    onSelect={() => {
                      run_after_context_menu_close(() => {
                        props.on_request_clear_translation_row_ids(target_row_ids, payload.row_id);
                      });
                    }}
                  >
                    <Eraser />
                    {t("proofreading_page.action.clear_translation")}
                  </AppContextMenuItem>
                  <AppContextMenuSub>
                    <AppContextMenuSubTrigger disabled={props.readonly}>
                      <ListChecks />
                      {t("proofreading_page.action.set_translation_status")}
                    </AppContextMenuSubTrigger>
                    <AppContextMenuSubContent>
                      {PROOFREADING_MANUAL_STATUS_CODES.map((status) => (
                        <AppContextMenuItem
                          key={status}
                          disabled={props.readonly}
                          onSelect={() => {
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
              </AppContextMenuContent>
            );
          }}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="proofreading-page__table"
          row_class_name={() => "proofreading-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
