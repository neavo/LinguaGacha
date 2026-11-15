import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { api_blob } from "@frontend/app/desktop/desktop-api";
import { useI18n } from "@frontend/app/locale/locale-context";
import { MediaViewport } from "@frontend/features/media-preview/media-viewport";
import type { MediaImage } from "@frontend/features/media-preview/media-geometry";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { type JSX, useEffect, useRef, useState } from "react";

/** 每次挂载只读取一张图片；身份切换由详情弹窗的 key 和图片标签负责。 */
export function AgentToolImage(props: {
  chat_id: string;
  entry_id: string;
  index: number;
  label: string;
}): JSX.Element {
  const { t } = useI18n();
  const [image, set_image] = useState<MediaImage | "loading" | "error">("loading");
  const text = useRef(t); // 在途请求反馈使用当前界面语言。
  text.current = t;

  useEffect(() => {
    const controller = new AbortController();
    let object_url: string | null = null; // 当前挂载独占 URL，退出时释放。
    const query = new URLSearchParams({
      chatId: props.chat_id,
      entryId: props.entry_id,
      index: String(props.index),
    });
    void api_blob(`/api/agent/tool-image?${query}`, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        object_url = URL.createObjectURL(blob);
        set_image({ url: object_url, mime: blob.type });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        set_image("error");
        push_error_toast(text.current("app.feedback.read_failed"), error);
      });
    return () => {
      controller.abort();
      if (object_url !== null) URL.revokeObjectURL(object_url);
    };
  }, [props.chat_id, props.entry_id, props.index]);

  /** HTTP 成功仍可能解码失败，内容区与读取失败使用同一恢复路径。 */
  const handle_image_error = (): void => {
    set_image("error");
    push_error_toast(
      text.current("app.feedback.read_failed"),
      text.current("app.feedback.content_unavailable"),
    );
  };

  return (
    <div className="agent-tool-image" aria-busy={image === "loading"}>
      {typeof image === "string" ? (
        <AppContentState status={image} />
      ) : (
        <MediaViewport
          label={props.label}
          mode="image"
          image={image}
          on_error={handle_image_error}
        />
      )}
    </div>
  );
}
