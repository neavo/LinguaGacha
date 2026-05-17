import { useContext } from "react";

import { DesktopRuntimeContext } from "@/app/desktop/desktop-runtime-context";

export function useDesktopRuntime() {
  const context_value = useContext(DesktopRuntimeContext);

  if (context_value === null) {
    throw new Error("useDesktopRuntime must be used inside DesktopRuntimeProvider.");
  }

  return context_value;
}
