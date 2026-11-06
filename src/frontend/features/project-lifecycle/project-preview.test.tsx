import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import type { ProjectPreview } from "@shared/project-preview";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import { ProjectPreviewSummary } from "./project-preview";

it("加载时保留摘要字段，就绪后替换占位", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  /** 保留组件实例，验证同一预览的加载切换。 */
  const render = (preview: ProjectPreview | null) =>
    root.render(
      <LocaleProvider locale="zh-CN">
        <ProjectPreviewSummary preview={preview} />
      </LocaleProvider>,
    );
  try {
    await act(async () => render(null));
    const labels = Array.from(container.querySelectorAll("dt"), (label) => label.textContent);
    const values = Array.from(container.querySelectorAll("dd"), (value) => value.textContent);
    expect(labels.length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () =>
      render({
        file_paths: ["a.txt", "b.txt"],
        created_at: "2026-11-06T14:50:19",
        updated_at: "2026-11-06T15:38:02",
        translation_stats: build_project_translation_stats([]),
      }),
    );
    expect(Array.from(container.querySelectorAll("dt"), (label) => label.textContent)).toEqual(
      labels,
    );
    expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    const ready_values = Array.from(container.querySelectorAll("dd"), (value) => value.textContent);
    expect(ready_values).toHaveLength(values.length);
    ready_values.forEach((value, index) => expect(value).not.toBe(values[index]));
  } finally {
    await act(async () => root.unmount());
  }
});
