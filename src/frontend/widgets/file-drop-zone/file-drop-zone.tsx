import type { JSX, ReactNode } from "react";

import { cn } from "@frontend/shadcn/classnames";
import { type PathDropOptions, usePathDrop } from "@frontend/widgets/file-drop-zone/use-path-drop";
import "@frontend/widgets/file-drop-zone/file-drop-zone.css";

type FileDropZoneProps = PathDropOptions & {
  label: string;
  children: ReactNode;
  className?: string;
};

/** 在既有内容上叠加拖入覆盖层，文件读写由调用者接管。 */
export function FileDropZone(props: FileDropZoneProps): JSX.Element {
  const { drop_active, drop_handlers } = usePathDrop(props);

  return (
    <div
      className={cn("file-drop-zone", props.className)}
      data-drop-active={drop_active ? "true" : undefined}
      {...drop_handlers}
    >
      <div className="file-drop-zone__content">{props.children}</div>
      <div className="file-drop-zone__overlay" aria-hidden={!drop_active}>
        <p className="file-drop-zone__label font-medium">{props.label}</p>
      </div>
    </div>
  );
}
