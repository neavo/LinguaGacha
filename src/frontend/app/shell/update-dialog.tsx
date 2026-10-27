import { createContext, memo, useContext, useMemo, type ComponentProps, type JSX } from "react";
import { Streamdown, defaultRehypePlugins, type ExtraProps } from "streamdown";
import { useExternalLink } from "@frontend/app/desktop/use-external-link";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  is_update_dialog_open,
  is_update_dialog_submitting,
  read_update_release,
  resolve_update_action_label,
  type UpdateDialogState,
} from "@frontend/app/app-shell-state";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { MARKDOWN_BASE_COMPONENTS } from "@frontend/widgets/app-markdown";
import "streamdown/styles.css";
import "@frontend/widgets/app-markdown.css";

// 安全清理保留相对地址，解析时再以发行页为基准补全。
const RELEASE_REHYPE_PLUGINS = [defaultRehypePlugins.raw!, defaultRehypePlugins.sanitize!];
const RELEASE_COMPONENTS = { ...MARKDOWN_BASE_COMPONENTS, a: ReleaseLink, img: ReleaseImage };
const ReleaseLinkContext = createContext(false); // 图片嵌套在链接中时复用外层目标

/** 更新状态由应用壳持有，弹窗负责展示和转发动作。 */
export function UpdateDialog(props: {
  state: UpdateDialogState;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const release = read_update_release(props.state);
  const label = resolve_update_action_label(props.state, t);
  return (
    <AppActionDialog
      open={is_update_dialog_open(props.state)}
      title={null}
      description={null}
      details={
        release?.release_notes ? (
          <ReleaseNotes text={release.release_notes} releaseUrl={release.release_url} />
        ) : undefined
      }
      contentClassName="sm:max-w-[720px]"
      submitting={is_update_dialog_submitting(props.state)}
      submittingLabel={label}
      submittingIcon={props.state.phase === "launching"}
      primaryAction={{ label, onSelect: props.onConfirm }}
      onClose={props.onClose}
    />
  );
}

/** 下载进度变化时复用正文解析结果。 */
const ReleaseNotes = memo(function ReleaseNotes({
  text,
  releaseUrl,
}: {
  text: string;
  releaseUrl: string;
}): JSX.Element {
  const transform = useMemo(
    () =>
      (value: string): string => {
        try {
          const url = new URL(value, releaseUrl);
          return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
        } catch {
          return "";
        }
      },
    [releaseUrl],
  );
  return (
    <div className="app-markdown">
      <Streamdown
        className="app-markdown__content space-y-0"
        mode="static"
        controls={false}
        components={RELEASE_COMPONENTS}
        rehypePlugins={RELEASE_REHYPE_PLUGINS}
        urlTransform={transform}
      >
        {text}
      </Streamdown>
    </div>
  );
});

/** 外链交由宿主打开。 */
function ReleaseLink({
  node: _node,
  href,
  children,
  ...props
}: ComponentProps<"a"> & ExtraProps): JSX.Element {
  const activate = useExternalLink();
  if (!href) return <span>{children}</span>;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void activate(href);
      }}
    >
      <ReleaseLinkContext value>{children}</ReleaseLinkContext>
    </a>
  );
}

/** 图片保留文字入口，避免直接加载远程资源。 */
function ReleaseImage({
  node: _node,
  src,
  alt,
  title,
}: ComponentProps<"img"> & ExtraProps): JSX.Element {
  const inside_link = useContext(ReleaseLinkContext);
  const label = alt || title || src || "";
  // 链接中的图片沿用外层目标，避免嵌套链接和重复打开。
  if (inside_link) return <>{label}</>;
  return <ReleaseLink href={src}>{label}</ReleaseLink>;
}
