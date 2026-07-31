import * as React from "react";

import { cn } from "@frontend/shadcn/classnames";

/** 应用多行输入基元：默认关闭拼写检查，并保留只读文本的选择能力。 */
function Textarea({ className, spellCheck = false, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      spellCheck={spellCheck}
      className={cn(
        "min-h-[160px] w-full select-text rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring read-only:cursor-text read-only:bg-input/50 read-only:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:read-only:bg-input/80",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
