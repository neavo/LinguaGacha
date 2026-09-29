import { useEffect, useState } from "react";

/** 分辨率查询失配后重新绑定，覆盖跨屏和浏览器缩放，监听随消费者卸载释放。 */
export function useDevicePixelRatio(): number {
  const [ratio, set_ratio] = useState(() => window.devicePixelRatio);
  useEffect(() => {
    let query: MediaQueryList;
    /** 旧查询只描述旧屏幕，变化后按当前 DPR 重建监听。 */
    const update = (): void => {
      query?.removeEventListener("change", update);
      const next = window.devicePixelRatio;
      set_ratio(next);
      query = window.matchMedia(`(resolution: ${next}dppx)`);
      query.addEventListener("change", update);
    };
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return ratio;
}
