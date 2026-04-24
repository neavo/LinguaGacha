import { useContext } from "react";

import { DesktopRuntimeContext } from "@/app/runtime/desktop/desktop-runtime-context";

export function useDesktopRuntime() {
  const context_value = useContext(DesktopRuntimeContext);

  if (context_value === null) {
    throw new Error("useDesktopRuntime 必须在 DesktopRuntimeProvider 内使用。");
  }

  return context_value;
}
