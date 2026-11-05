import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { create_text_resolver, type LocaleKey } from "@shared/i18n";
import {
  PROJECT_SOURCE_FORMATS,
  type ProjectSourceFormatHitCounts,
} from "@shared/project-source-formats";

import { ProjectSourceFormats } from "./project-source-formats";

const t = create_text_resolver("zh-CN");

describe("ProjectSourceFormats", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 按词典解析后的可见名称定位格式标签。 */
  function find_tag(title_key: LocaleKey): HTMLElement {
    return [...container.querySelectorAll<HTMLElement>(".project-lifecycle__format-tag")].find(
      (tag) => tag.querySelector("span")?.textContent === t(title_key),
    )!;
  }

  it("格式标签显示非零计数并隐藏内部格式，提示图标可聚焦", async () => {
    const format_hit_counts = Object.fromEntries(
      PROJECT_SOURCE_FORMATS.map((format) => [format.id, 0]),
    ) as ProjectSourceFormatHitCounts;
    format_hit_counts.txt = 3;
    format_hit_counts.trans = 2;
    format_hit_counts.generic = 7;
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <ProjectSourceFormats format_hit_counts={format_hit_counts} />
        </LocaleProvider>,
      ),
    );

    expect(find_tag("project.formats.txt").querySelector('[data-slot="badge"]')?.textContent).toBe(
      "3",
    );
    expect(
      find_tag("project.formats.trans").querySelector('[data-slot="badge"]')?.textContent,
    ).toBe("2");
    expect(find_tag("project.formats.generic")).toBeUndefined();
    for (const icon of container.querySelectorAll<HTMLElement>("h3 [tabindex]")) {
      expect(icon.textContent).toBe("");
      expect(icon.getAttribute("aria-label")).toBe(icon.closest("h3")?.textContent);
      act(() => icon.focus());
      expect(document.activeElement).toBe(icon);
    }
    expect(container.querySelectorAll("h3 [tabindex]").length).toBeGreaterThan(0);
    expect(find_tag("project.formats.md").querySelector('[data-slot="badge"]')).toBeNull();
  });
});
