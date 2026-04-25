import {
  AlertCircle,
  Ban,
  CircleCheck,
  CircleMinus,
  PencilLine,
  Recycle,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/i18n";
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  type ProofreadingItem,
  type ProofreadingVisibleItem,
} from "@/pages/proofreading-page/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import {
  AppContextMenuContent,
  AppContextMenuGroup,
  AppContextMenuItem,
} from "@/widgets/app-context-menu/app-context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { AppTable } from "@/widgets/app-table/app-table";
import { AppTableDragIndicator } from "@/widgets/app-table/app-table-drag-indicator";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";

type ProofreadingTableProps = {
  items: ProofreadingVisibleItem[];
  sort_state: AppTableSortState | null;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  readonly: boolean;
  on_sort_change: (next_sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (row_id: string) => void;
  on_request_retranslate_row_ids: (row_ids: string[]) => void;
  on_request_reset_row_ids: (row_ids: string[]) => void;
};

type ProofreadingStatusIconTone = "success" | "warning" | "failure" | "neutral";

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

function resolve_context_target_row_ids(row_id: string, selected_row_ids: string[]): string[] {
  if (selected_row_ids.includes(row_id)) {
    return selected_row_ids;
  }

  return [row_id];
}

function build_row_number_label(row_index: number): string {
  return String(row_index + 1);
}

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

  return null;
}

function resolve_status_icon_tone(status: string): ProofreadingStatusIconTone {
  if (status === "PROCESSED") {
    return "success";
  }
  if (status === "ERROR") {
    return "failure";
  }

  return "neutral";
}

function build_compact_tooltip(template: string, title: string, content: string): string {
  return template.replace("{TITLE}", title).replace("{STATE}", content);
}

function ProofreadingStatusCell(props: { item: ProofreadingItem }): JSX.Element | null {
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

export function ProofreadingTable(props: ProofreadingTableProps): JSX.Element {
  const { t } = useI18n();
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
          return (
            <span className="proofreading-page__table-text">{payload.row.compressed_src}</span>
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
          return (
            <span className="proofreading-page__table-text">{payload.row.compressed_dst}</span>
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
          if (payload.presentation === "overlay") {
            return null;
          }

          return <ProofreadingStatusCell item={payload.row.item} />;
        },
      },
    ];
  }, [t]);

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
          on_selection_change={props.on_selection_change}
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
                    onClick={() => {
                      props.on_open_edit(payload.row_id);
                    }}
                  >
                    <PencilLine />
                    {t("proofreading_page.action.edit")}
                  </AppContextMenuItem>
                  <AppContextMenuItem
                    disabled={props.readonly}
                    onClick={() => {
                      props.on_request_retranslate_row_ids(target_row_ids);
                    }}
                  >
                    <RefreshCcw />
                    {t("proofreading_page.action.retranslate")}
                  </AppContextMenuItem>
                  <AppContextMenuItem
                    disabled={props.readonly}
                    onClick={() => {
                      props.on_request_reset_row_ids(target_row_ids);
                    }}
                  >
                    <Recycle />
                    {t("proofreading_page.action.reset_translation")}
                  </AppContextMenuItem>
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
