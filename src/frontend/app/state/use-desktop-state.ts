import { useContext } from "react";

import { DesktopStateContext } from "@frontend/app/state/desktop-state-context";

export function useDesktopState() {
  const context_value = useContext(DesktopStateContext);

  if (context_value === null) {
    throw new Error("useDesktopState must be used inside DesktopStateProvider.");
  }

  return context_value;
}
