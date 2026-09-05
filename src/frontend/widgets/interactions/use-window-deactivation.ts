import { useEffect, useEffectEvent } from "react";

/** 临时浮层在窗口失焦或页面隐藏时结束交互，恢复由新的用户操作发起。 */
export function useWindowDeactivation(on_deactivate: () => void): void {
  const deactivate = useEffectEvent(on_deactivate);
  useEffect(() => {
    const blur = (): void => deactivate();
    const visibility = (): void => {
      if (document.hidden) deactivate();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
}
