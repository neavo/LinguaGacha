import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@frontend/shadcn/classnames";

type CardVariant = "default" | "panel" | "table" | "toolbar" | "group";

/** 统一容器表面，通过 `render` 保留消费方的元素语义。 */
function Card({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"section"> & { variant?: CardVariant }) {
  // 交互标记由公开事件/语义属性推导，供卡片 hover 与按下反馈共用。
  const is_interactive =
    props.onClick !== undefined ||
    props.onKeyDown !== undefined ||
    props.onKeyUp !== undefined ||
    props.role === "button" ||
    props.role === "link" ||
    (props.tabIndex !== undefined && props.tabIndex >= 0);

  return useRender({
    defaultTagName: "section",
    props: mergeProps<"section">(
      {
        "data-slot": "card",
        "data-variant": variant,
        "data-interactive": is_interactive ? "true" : undefined,
        className: cn(
          "card-surface rounded-[var(--card-radius-current)] text-card-foreground",
          className,
        ),
      } as React.ComponentProps<"section">,
      props,
    ),
    render,
  });
}

/** 头部与正文共享变体间距，相邻正文省略顶部内边距。 */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex min-w-0 flex-col", className)} {...props} />
  );
}

/** 卡片标题沿用工作区标题的字号与字距。 */
function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(
        "min-w-0 text-[length:var(--ui-font-size-14)] leading-[1.25] tracking-[-0.018em] font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** 说明文字使用次级层级，并允许在窄容器内收缩。 */
function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn(
        "min-w-0 text-[length:var(--ui-font-size-12)] leading-[1.4] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** 正文间距由容器变体与相邻头部共同决定。 */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("min-w-0", className)} {...props} />;
}

/** 页脚使用变体间距组织同一容器的操作。 */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
