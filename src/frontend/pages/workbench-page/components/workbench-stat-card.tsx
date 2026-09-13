import { Card, CardContent, CardTitle } from "@frontend/shadcn/card";
import { cn } from "@frontend/shadcn/classnames";

type WorkbenchStatCardProps = {
  title: string;
  value: number | null;
  unit: string;
  accent?: "skipped" | "success" | "failure";
};

/** 展示单项工程计数；统计尚未返回时保留占位。 */
export function WorkbenchStatCard(props: WorkbenchStatCardProps): JSX.Element {
  return (
    <Card className="workbench-page__stat-card">
      <CardContent className="workbench-page__stat-card-content">
        <div className="workbench-page__stat-card-stack">
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--title">
            <CardTitle className="workbench-page__stat-card-title">{props.title}</CardTitle>
          </div>
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--value">
            <div className="workbench-page__stat-card-metric">
              <p
                className={cn(
                  "workbench-page__stat-card-value",
                  props.accent === "skipped" && "workbench-page__stat-card-value--skipped",
                  props.accent === "success" && "workbench-page__stat-card-value--success",
                  props.accent === "failure" && "workbench-page__stat-card-value--failure",
                )}
              >
                {props.value?.toLocaleString() ?? "—"}
              </p>
            </div>
          </div>
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--unit">
            <div className="workbench-page__stat-card-unit-row">
              <span className="workbench-page__stat-card-unit">{props.unit}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
