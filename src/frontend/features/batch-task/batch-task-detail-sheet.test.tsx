import type { BatchTaskEndpoint } from "@domain/batch-task";
import { batch_task_metrics, empty_batch_task_list_snapshot } from "@shared/batch-task";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LocaleContext } from "@frontend/app/locale/locale-context";
import { create_text_resolver } from "@shared/i18n";
import { BatchTaskDetailSheet } from "./batch-task-detail-sheet";

it("空闲时保留同一侧栏轮廓，运行时显示共享速度并可请求停止", async () => {
  const root = createRoot(document.createElement("div"));
  const stop = vi.fn();
  const t = create_text_resolver("zh-CN");
  const metrics = batch_task_metrics(empty_batch_task_list_snapshot(), 0);
  const primary = {
    id: "provider",
    name: "共用接入点",
    model_id: "model",
    thinking_level: "LOW",
  } as const;
  const secondary = { ...primary, thinking_level: "CUSTOM" } as const;
  const primary_info = "共用接入点 · model · 低";
  const secondary_info = "共用接入点 · model · 自定义";
  const render = (endpoints: readonly BatchTaskEndpoint[], active = endpoints.length > 0) =>
    act(async () =>
      root.render(
        <LocaleContext.Provider value={{ locale: "zh-CN", t }}>
          <BatchTaskDetailSheet
            open
            summary={{
              status_text: active ? "正在处理批量任务" : "无任务",
              speed_text: active ? "77.00 T/s" : null,
              tone: active ? "success" : "neutral",
              detail_tooltip_text: "",
            }}
            metrics={{
              ...metrics,
              kind: active ? "mixed" : null,
              endpoints,
              request_in_flight_count: active ? 4 : 0,
              average_speed: active ? 24 : 0,
            }}
            waveform_history={active ? [77] : []}
            on_close={() => {}}
            on_request_stop_confirmation={stop}
          />
        </LocaleContext.Provider>,
      ),
    );
  vi.useFakeTimers();
  try {
    await render([]);
    const sheet = document.querySelector('[role="dialog"]')!;
    const stop_button = [...sheet.querySelectorAll("button")].find(
      (button) => button.textContent === "停止",
    )!;
    const title = document.getElementById(sheet.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("无任务");
    expect(sheet.textContent).toContain("实时速度0.00 T/s");
    const statistics = () =>
      Object.fromEntries(
        [...sheet.querySelectorAll("dt")].map((term) => [
          term.textContent,
          [...(term.nextElementSibling?.children ?? [])].map((item) => item.textContent).join(" "),
        ]),
      );
    expect(statistics()).toMatchObject({
      剩余时间: "00:00:00",
      平均速度: "0.00 T/s",
      "输入 Token": "0 T",
      实时任务数: "0 Task",
    });
    expect(sheet.querySelector("canvas")).not.toBeNull();
    expect(stop_button.disabled).toBe(true);

    await render([primary]);
    const current_endpoint = () => sheet.querySelector("[title]")?.textContent;
    expect(current_endpoint()).toBe(primary_info);
    await render([primary, secondary]);
    expect(title?.textContent).toBe("正在处理批量任务");
    expect(sheet.textContent).toContain("77.00 T/s");
    expect(statistics()).toMatchObject({
      平均速度: "24.00 T/s",
      实时任务数: "4 Task",
    });
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(current_endpoint()).toBe(secondary_info);
    const endpoint_slot = sheet.querySelector<HTMLElement>("[title]")?.parentElement;
    await act(async () => endpoint_slot?.focus());
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(current_endpoint()).toBe(secondary_info);
    await act(async () => endpoint_slot?.blur());
    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(current_endpoint()).toBe(primary_info);
    await render([secondary]);
    expect(current_endpoint()).toBe(secondary_info);
    await act(async () => stop_button.click());
    expect(stop).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
