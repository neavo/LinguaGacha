import { cn } from "@frontend/shadcn/classnames";

/**
 * 提供键帽外观，按键行为与无障碍声明由消费方管理。
 * 底色取自身继承的文字色叠加低透明度，使键帽在任意宿主（按钮各 variant、Tooltip、菜单、明暗主题）中
 * 都朝宿主文字色方向偏移；宿主不得再按 variant 或容器覆盖键帽颜色。
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center rounded-md bg-current/15 px-1 font-sans text-xs font-normal select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
