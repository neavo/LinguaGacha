import { CircleAlert, LoaderCircle } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { AppButton } from "@frontend/widgets/app-button";

type AppContentStateProps =
  | { status: "loading"; message: string }
  | { status: "error"; message: string; on_retry: () => void };

/** 内容不可读时占用原内容区域，重试仍由查询拥有者执行。 */
export function AppContentState(props: AppContentStateProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground"
      role={props.status === "error" ? "alert" : "status"}
    >
      {props.status === "loading" ? (
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      ) : (
        <CircleAlert className="size-5" aria-hidden="true" />
      )}
      <p>{props.message}</p>
      {props.status === "error" ? (
        <AppButton variant="outline" size="sm" onClick={props.on_retry}>
          {t("app.action.retry")}
        </AppButton>
      ) : null}
    </div>
  );
}
