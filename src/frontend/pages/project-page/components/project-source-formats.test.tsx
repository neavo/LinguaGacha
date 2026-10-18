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
    return [...container.querySelectorAll<HTMLElement>(".project-home__format-tag")].find(
      (tag) => tag.querySelector(".project-home__format-title")?.textContent === t(title_key),
    )!;
  }

  it("按支持状态分两组展示，每个格式恰好出现一次并保留目录顺序", async () => {
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <ProjectSourceFormats />
        </LocaleProvider>,
      ),
    );
    const lists = [...container.querySelectorAll(".project-home__format-tags")];
    const groups = lists.map((list) =>
      [...list.querySelectorAll(".project-home__format-title")].map((tag) => tag.textContent),
    );
    // 这两个格式的归属属于产品要求，独立预期可发现支持状态填错。
    expect(groups).toEqual([
      PROJECT_SOURCE_FORMATS.filter((format) => format.id !== "xlsx" && format.id !== "trans").map(
        (format) => t(format.title_key),
      ),
      [t("project_page.formats.xlsx"), t("project_page.formats.trans")],
    ]);
    expect(
      lists.map((list) => document.getElementById(list.getAttribute("aria-labelledby")!)),
    ).toEqual([...container.querySelectorAll("h3")]);
  });

  it("两组都展示命中数量，零命中省略数量", async () => {
    const format_hit_counts = Object.fromEntries(
      PROJECT_SOURCE_FORMATS.map((format) => [format.id, 0]),
    ) as ProjectSourceFormatHitCounts;
    format_hit_counts.txt = 3;
    format_hit_counts.trans = 2;
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <ProjectSourceFormats format_hit_counts={format_hit_counts} />
        </LocaleProvider>,
      ),
    );

    expect(
      find_tag("project_page.formats.txt").querySelector('[data-slot="badge"]')?.textContent,
    ).toBe("3");
    expect(
      find_tag("project_page.formats.trans").querySelector('[data-slot="badge"]')?.textContent,
    ).toBe("2");
    expect(find_tag("project_page.formats.md").querySelector('[data-slot="badge"]')).toBeNull();
  });
});
