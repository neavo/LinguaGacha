import { useEffect, useEffectEvent, useRef, useState, type JSX } from "react";
import { batch_task_endpoint_key, type BatchTaskEndpoint } from "@domain/batch-task";
import type { BatchTaskMetrics } from "@shared/batch-task";
import { CircleStop } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Badge } from "@frontend/shadcn/badge";
import { Card } from "@frontend/shadcn/card";
import { AppButton } from "@frontend/widgets/app-button";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@frontend/shadcn/sheet";
import {
  build_batch_task_cards,
  format_batch_task_speed,
  type BatchTaskSummaryDisplay,
} from "./batch-task-display";
import { BatchTaskWaveform } from "./batch-task-waveform";
import "./batch-task.css";

type BatchTaskDetailSheetProps = {
  open: boolean;
  summary: BatchTaskSummaryDisplay;
  metrics: BatchTaskMetrics;
  waveform_history: readonly number[];
  on_close: () => void;
  on_request_stop_confirmation: () => void;
};

/** 侧栏从实时速度开始，任务状态继续作为对话框名称。 */
export function BatchTaskDetailSheet(props: BatchTaskDetailSheetProps): JSX.Element {
  const { t } = useI18n();
  const title_ref = useRef<HTMLHeadingElement>(null);
  const { completion_percent, endpoints, kind, stopping } = props.metrics;
  const waveform_title = t("batch_translation.detail.waveform_title");
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.on_close();
      }}
    >
      <SheetContent initialFocus={title_ref} side="right" className="batch-translation__sheet">
        <div className="batch-translation__sheet-body">
          <SheetHeader className="sr-only">
            <SheetTitle ref={title_ref} tabIndex={-1} className="outline-none">
              {props.summary.status_text}
            </SheetTitle>
            <SheetDescription className="sr-only">{waveform_title}</SheetDescription>
          </SheetHeader>
          <Card variant="group" className="batch-translation__section">
            <div className="batch-translation__section-head">
              <h3 className="batch-translation__section-title">{waveform_title}</h3>
              <div className="batch-translation__waveform-values">
                <span>{props.summary.speed_text ?? format_batch_task_speed(0)}</span>
                {completion_percent === null ? null : (
                  <Badge tone={props.summary.tone}>{completion_percent.toFixed(2)}%</Badge>
                )}
              </div>
            </div>
            <BatchTaskWaveform history={props.waveform_history} />
          </Card>

          <BatchTaskEndpoints
            active={props.open}
            label={t("batch_translation.detail.provider")}
            endpoints={endpoints}
          />
          <dl className="batch-translation__metrics-grid">
            {build_batch_task_cards(props.metrics, t).map(({ label, value, unit }) => (
              <Card
                key={label}
                variant="group"
                render={<div />}
                className="batch-translation__metric"
              >
                <dt className="batch-translation__card-label">{label}</dt>
                <dd className="batch-translation__metric-main">
                  <span className="batch-translation__metric-value">{value}</span>
                  {unit === "" ? null : (
                    <span className="batch-translation__metric-unit">{unit}</span>
                  )}
                </dd>
              </Card>
            ))}
          </dl>
        </div>
        <div className="batch-translation__sheet-footer">
          <AppButton
            type="button"
            variant="destructive"
            disabled={kind === null || stopping}
            onClick={props.on_request_stop_confirmation}
          >
            <CircleStop data-icon="inline-start" />
            {t(
              props.summary.tone === "warning"
                ? "batch_translation.summary.stopping"
                : "batch_translation.action.stop",
            )}
          </AppButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const ENDPOINT_ROTATION_INTERVAL_MS = 4_000;

/** 保留当前接入点的位置，工程计数刷新时继续使用同一个轮换时钟。 */
function BatchTaskEndpoints({
  active,
  label,
  endpoints,
}: {
  active: boolean;
  label: string;
  endpoints: readonly BatchTaskEndpoint[];
}): JSX.Element {
  const { t } = useI18n();
  const entries = endpoints.map((endpoint) => ({
    key: batch_task_endpoint_key(endpoint),
    fields: [
      endpoint.name,
      endpoint.model_id,
      t(
        endpoint.thinking_level === "CUSTOM"
          ? "batch_translation.detail.custom_thinking"
          : MODEL_THINKING_LEVEL_LABEL_KEY[endpoint.thinking_level],
      ),
    ] as const,
  }));
  const [rotation, set_rotation] = useState<{ current_key: string; previous_key: string } | null>(
    null,
  );
  const [hovered, set_hovered] = useState(false);
  const [focused, set_focused] = useState(false);
  const index = Math.max(
    0,
    entries.findIndex(({ key }) => key === rotation?.current_key),
  );
  const current = entries[index];
  const multiple = entries.length > 1;
  const previous =
    multiple && current?.key === rotation?.current_key
      ? entries.find(({ key }) => key === rotation?.previous_key)
      : undefined;
  const advance = useEffectEvent(() => {
    const next = entries[(index + 1) % entries.length];
    if (current === undefined || next === undefined || next === current) return; // 旧定时器可能尚未清理。
    set_rotation({ current_key: next.key, previous_key: current.key });
  });

  useEffect(() => {
    if (!active || !multiple || hovered || focused) return;
    const timer = window.setInterval(() => advance(), ENDPOINT_ROTATION_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, focused, hovered, multiple]);

  return (
    <Card
      variant="group"
      className="batch-translation__endpoints"
      onMouseEnter={() => set_hovered(true)}
      onMouseLeave={() => set_hovered(false)}
    >
      <span className="batch-translation__card-label">{label}</span>
      <div
        className="batch-translation__endpoint-slot"
        tabIndex={multiple ? 0 : undefined}
        onFocus={() => set_focused(true)}
        onBlur={() => set_focused(false)}
      >
        {previous === undefined ? null : (
          <span key={"previous:" + previous.key} data-leaving aria-hidden="true">
            <EndpointFields fields={previous.fields} />
          </span>
        )}
        <span
          key={current?.key}
          data-entering={previous === undefined ? undefined : ""}
          title={current?.fields.join(" · ")}
        >
          {current === undefined ? "—" : <EndpointFields fields={current.fields} />}
        </span>
      </div>
    </Card>
  );
}

/** 名称和模型 ID 可以截断，思考等级始终可见。 */
function EndpointFields({
  fields: [name, model_id, level],
}: {
  fields: readonly [string, string, string];
}): JSX.Element {
  return (
    <>
      <span className="batch-translation__endpoint-field">{name}</span>
      <span className="batch-translation__endpoint-separator">{" · "}</span>
      <span className="batch-translation__endpoint-field">{model_id}</span>
      <span className="batch-translation__endpoint-separator">{" · "}</span>
      <span>{level}</span>
    </>
  );
}
