import type { JSX } from "react";
import { LoaderCircle } from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";

type AppContentStateProps = {
  status: "loading" | "error";
  message?: string;
  on_retry?: () => void;
};

/** 内容状态表达可用性，专用恢复动作由调用者按需提供。 */
export function AppContentState(props: AppContentStateProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="flex items-center justify-center gap-2 p-4 text-[length:var(--ui-font-size-13)] text-muted-foreground"
      role="status"
    >
      {props.status === "loading" ? (
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      ) : null}
      <p>
        {props.status === "loading"
          ? (props.message ?? t("app.action.loading"))
          : t("app.feedback.content_unavailable")}
      </p>
      {props.status === "error" && props.on_retry ? (
        <AppButton variant="outline" size="sm" onClick={props.on_retry}>
          {t("app.action.retry")}
        </AppButton>
      ) : null}
    </div>
  );
}
