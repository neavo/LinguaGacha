import { Badge } from "@frontend/shadcn/badge";
import "./quality-rule-hit-badge.css";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { useI18n } from "@frontend/app/locale/locale-provider";

type QualityRuleHitBadgeState = {
  kind: "matched" | "unmatched" | "related";
  hits: number;
  tooltip: string;
};

type QualityRuleHitBadgeProps = {
  entry_id: string;
  running: boolean;
  badge_state: QualityRuleHitBadgeState | null;
  query_label: string;
  relation_label?: string;
  on_query_entry_source: (entry_id: string) => Promise<void>;
  on_search_entry_relations?: (entry_id: string) => void;
};

const TONE_BY_KIND = {
  matched: "success",
  related: "warning",
  unmatched: "failure",
} as const;

/** 三类质量规则表共用命中状态、查询动作与关系菜单，页面提供业务动作与文案。 */
export function QualityRuleHitBadge(props: QualityRuleHitBadgeProps): JSX.Element | null {
  const { t } = useI18n();

  if (props.running) {
    return (
      <span
        data-app-table-ignore-box-select="true"
        data-app-table-ignore-row-click="true"
        className="quality-rule-hit-badge"
        aria-label={t("app.action.loading")}
      >
        <Badge>
          <Spinner data-icon="inline-start" />
        </Badge>
      </span>
    );
  }

  if (props.badge_state === null) {
    return null;
  }

  const badge = (
    <Badge tone={TONE_BY_KIND[props.badge_state.kind]}>{props.badge_state.hits.toString()}</Badge>
  );
  const tooltip_content = (
    <TooltipContent side="top" sideOffset={8}>
      <p className="whitespace-pre-line">{props.badge_state.tooltip}</p>
    </TooltipContent>
  );

  if (props.badge_state.kind === "unmatched") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              data-app-table-ignore-box-select="true"
              data-app-table-ignore-row-click="true"
              className="quality-rule-hit-badge"
              aria-label={props.badge_state.tooltip}
            >
              {badge}
            </span>
          }
        />
        {tooltip_content}
      </Tooltip>
    );
  }

  if (
    props.badge_state.kind !== "related" ||
    props.relation_label === undefined ||
    props.on_search_entry_relations === undefined
  ) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-app-table-ignore-box-select="true"
              data-app-table-ignore-row-click="true"
              className="quality-rule-hit-badge quality-rule-hit-badge__button"
              aria-label={props.badge_state.tooltip}
              onClick={(event) => {
                event.stopPropagation();
                void props.on_query_entry_source(props.entry_id);
              }}
            >
              {badge}
            </button>
          }
        />
        {tooltip_content}
      </Tooltip>
    );
  }

  return (
    <AppDropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <AppDropdownMenuTrigger
              render={
                <button
                  type="button"
                  data-app-table-ignore-box-select="true"
                  data-app-table-ignore-row-click="true"
                  className="quality-rule-hit-badge quality-rule-hit-badge__button"
                  aria-label={props.badge_state.tooltip}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {badge}
                </button>
              }
            />
          }
        />
        {tooltip_content}
      </Tooltip>
      <AppDropdownMenuContent align="center">
        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            onClick={() => {
              void props.on_query_entry_source(props.entry_id);
            }}
          >
            {props.query_label}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem
            onClick={() => {
              props.on_search_entry_relations?.(props.entry_id);
            }}
          >
            {props.relation_label}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
