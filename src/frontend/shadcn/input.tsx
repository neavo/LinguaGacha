import * as React from "react";

import { cn } from "@frontend/shadcn/classnames";

/** 应用文本输入基元：默认关闭拼写检查，并保留只读文本的选择能力。 */
function Input({ className, spellCheck = false, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      spellCheck={spellCheck}
      className={cn(
        "h-8 w-full min-w-0 select-text rounded-lg border border-input bg-popover px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring read-only:cursor-text read-only:bg-muted/50 read-only:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:bg-destructive/5 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
