import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROJECT_LANGUAGE_SETTINGS } from "@domain/project-settings";
import {
  PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY,
  read_project_language_preference,
  save_project_language_preference,
} from "./project-language-preference";

describe("新建工程语言偏好", () => {
  beforeEach(() => {
    window.localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY);
  });

  it.each([null, "{", "null", "[]", "{}"])("无记录或无效载荷 %s 恢复默认值且不改写存储", (raw) => {
    if (raw !== null) window.localStorage.setItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY, raw);

    expect(read_project_language_preference()).toEqual(DEFAULT_PROJECT_LANGUAGE_SETTINGS);
    expect(window.localStorage.getItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY)).toBe(raw);
  });

  it.each([
    [
      { source_language: " all ", target_language: "zh-hant" },
      { source_language: "ALL", target_language: "ZH-HANT" },
    ],
    [
      { source_language: "ZH-HANT", target_language: "KO" },
      { source_language: "JA", target_language: "KO" },
    ],
    [
      { source_language: "EN", target_language: "ALL" },
      { source_language: "EN", target_language: "ZH" },
    ],
    [
      { source_language: 1, target_language: "KO" },
      { source_language: "JA", target_language: "KO" },
    ],
    [
      { source_language: "ALL", target_language: null },
      { source_language: "ALL", target_language: "ZH" },
    ],
  ])("逐字段恢复 %j，沿用语言领域规则", (value, expected) => {
    const raw = JSON.stringify(value);
    window.localStorage.setItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY, raw);

    expect(read_project_language_preference()).toEqual(expected);
    expect(window.localStorage.getItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY)).toBe(raw);
  });

  it("保存后可恢复，且只持久化两个语言字段", () => {
    const languages = { source_language: "ALL", target_language: "ZH-HANT", extra: "ignored" };
    save_project_language_preference(languages);

    const expected = { source_language: "ALL", target_language: "ZH-HANT" };
    expect(
      JSON.parse(window.localStorage.getItem(PROJECT_LANGUAGE_PREFERENCE_STORAGE_KEY)!),
    ).toEqual(expected);
    expect(read_project_language_preference()).toEqual(expected);
  });

  it("存储访问被拒绝时读取和保存均降级", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(read_project_language_preference()).toEqual(DEFAULT_PROJECT_LANGUAGE_SETTINGS);
    expect(() => save_project_language_preference(DEFAULT_PROJECT_LANGUAGE_SETTINGS)).not.toThrow();
  });

  it("存储读取失败时恢复默认值", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(read_project_language_preference()).toEqual(DEFAULT_PROJECT_LANGUAGE_SETTINGS);
  });
});
