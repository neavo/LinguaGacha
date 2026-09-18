import type { ProofreadingPagePreviewResult as PreviewResult } from "@shared/proofreading/proofreading-types";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { AppButton } from "@frontend/widgets/app-button";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { MediaControl, MediaViewport } from "@frontend/features/media-preview/media-viewport";
import { Spinner } from "@frontend/shadcn/spinner";
import { ProofreadingDetailLayout } from "./proofreading-detail-layout";

type Target = { project: string; file_path: string; page: number };

/** 请求与分页归校对页，已显示图像在刷新和重试期间保留，画布单独拥有阅读位置。 */
function PreviewPane(props: {
  target: Target;
  request_id: string;
  side: "source" | "translation";
  revision: number;
}): JSX.Element {
  const { t } = useI18n();
  // 新请求对象允许同页重试，也覆盖后端夹取页码后再次请求原目标页。
  const [request, set_request] = useState({ page: 1 });
  const [result, set_result] = useState<PreviewResult | null>(null);
  const [status, set_status] = useState<"loading" | "ready" | "error">("loading");
  const { project, file_path, page } = props.target;
  const { request_id, side, revision } = props;
  useEffect(() => {
    const controller = new AbortController();
    set_status("loading");
    void api_fetch<PreviewResult>(
      "/api/proofreading/page",
      {
        action: side,
        request_id,
        project_path: project,
        file_path,
        page,
        output_page: request.page,
      },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          // 实际页码和图像一起发布，页数缩减时以服务端夹取后的页码为准。
          set_result(value);
          set_status("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) set_status("error");
      });
    return () => controller.abort();
  }, [project, file_path, page, request_id, side, request, revision]);
  const actual_page = result?.page ?? 1;
  const title = t(
    side === "source" ? "proofreading_page.fields.source" : "proofreading_page.fields.translation",
  );
  return (
    <div
      className="proofreading-page__preview-pane"
      aria-busy={status === "loading"}
      aria-disabled={(status === "ready" && !result?.image) || undefined}
    >
      {result?.image ? (
        <MediaViewport
          key={actual_page}
          label={title}
          extra_controls={
            side === "translation" && (result.count ?? 0) > 1 ? (
              <>
                <MediaControl
                  label={t("proofreading_page.pages.previous")}
                  disabled={status !== "ready" || actual_page <= 1}
                  onClick={() => set_request({ page: actual_page - 1 })}
                >
                  <ChevronLeft aria-hidden="true" />
                </MediaControl>
                <MediaControl
                  label={t("proofreading_page.pages.next")}
                  disabled={status !== "ready" || actual_page >= result.count!}
                  onClick={() => set_request({ page: actual_page + 1 })}
                >
                  <ChevronRight aria-hidden="true" />
                </MediaControl>
              </>
            ) : undefined
          }
        >
          <img src={result.image} alt={title} draggable={false} />
        </MediaViewport>
      ) : null}
      {status !== "ready" && (
        <div className="proofreading-page__preview-feedback" role="status">
          {status === "loading" ? (
            <Spinner />
          ) : (
            <>
              <span>{t("proofreading_page.pages.failed")}</span>
              <AppButton
                variant="outline"
                size="sm"
                onClick={() => set_request({ page: request.page })}
              >
                {t("proofreading_page.pages.retry")}
              </AppButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 两栏共享一次详情请求身份，卸载时释放后端预览资源。 */
export function ProofreadingPagePreview(props: {
  target: Target;
  revision: number;
  on_close: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [request_id] = useState(() => crypto.randomUUID());
  useEffect(
    () => () => {
      // 关闭是幂等资源释放；网络已断开时后端随会话关闭或下一次预览释放。
      void api_fetch("/api/proofreading/page", { action: "close", request_id }).catch(
        () => undefined,
      );
    },
    [request_id],
  );
  const identity = JSON.stringify([
    props.target.project,
    props.target.file_path,
    props.target.page,
  ]);
  return (
    <AppPageDialog
      open
      title={t("proofreading_page.pages.title")}
      size="lg"
      onClose={props.on_close}
      bodyClassName="overflow-hidden p-0"
    >
      <div className="proofreading-page__dialog-scroll">
        <ProofreadingDetailLayout
          file_label={`${props.target.file_path} · ${t("proofreading_page.pages.source_page", { PAGE: String(props.target.page) })}`}
          source={
            <PreviewPane
              key={`${identity}:source`}
              target={props.target}
              request_id={request_id}
              side="source"
              revision={props.revision}
            />
          }
          translation={
            <PreviewPane
              key={`${identity}:translation`}
              target={props.target}
              request_id={request_id}
              side="translation"
              revision={props.revision}
            />
          }
        />
      </div>
    </AppPageDialog>
  );
}
