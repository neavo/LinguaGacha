import type { ReactNode } from "react";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { MediaViewport } from "@frontend/features/media-preview/media-viewport";

/** Agent 拥有弹窗与页脚，画布交互由共享媒体查看器负责。 */
export function AgentMediaPreviewDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <AppPageDialog
      open={props.open}
      size="xl"
      title={props.title}
      onClose={props.onClose}
      footer={props.footer}
      bodyClassName="min-h-0 overflow-hidden p-0"
    >
      {props.open && <MediaViewport label={props.title}>{props.children}</MediaViewport>}
    </AppPageDialog>
  );
}
