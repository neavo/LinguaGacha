import type { MermaidConfig } from "mermaid";

import type { ResolvedThemeMode } from "@gui/bridge-types";

const MERMAID_RENDER_CACHE_SIZE = 32;

export type MermaidRenderResult =
  | { status: "success"; svg: string }
  | { status: "error"; code: "parse_failed" | "render_failed" };

type MermaidThemeProfile = {
  key: string;
  config: MermaidConfig;
};

/** 统一拥有 Mermaid 的可变单例配置并串行渲染，避免主题切换与排队图表互相污染。 */
class MermaidRenderer {
  private readonly cache = new Map<string, MermaidRenderResult & { status: "success" }>();
  private readonly pending = new Map<string, Promise<MermaidRenderResult>>();
  private queue: Promise<void> = Promise.resolve();
  private configured_profile_key: string | null = null;
  private next_diagram_id = 0;

  /** 按主题与源码复用结果；未命中时进入全局串行渲染队列。 */
  request(source: string, theme_mode: ResolvedThemeMode): Promise<MermaidRenderResult> {
    const normalized_source = normalize_mermaid_source(source);
    const theme_profile = build_mermaid_theme_profile(theme_mode);
    const request_key = `${theme_profile.key}\u0000${normalized_source}`;
    const cached = this.cache.get(request_key);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = this.pending.get(request_key);
    if (existing !== undefined) return existing;

    const render_promise = this.enqueue(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (this.configured_profile_key !== theme_profile.key) {
          mermaid.initialize(theme_profile.config);
          this.configured_profile_key = theme_profile.key;
        }

        const parsed = await mermaid.parse(normalized_source, { suppressErrors: true });
        if (parsed === false) {
          return { status: "error", code: "parse_failed" } satisfies MermaidRenderResult;
        }

        const diagram_id = `agent-mermaid-${(this.next_diagram_id += 1).toString(36)}`;
        const { svg } = await mermaid.render(diagram_id, normalized_source);
        const result = { status: "success", svg } as const;
        this.cache.set(request_key, result);
        this.trim_cache();
        return result;
      } catch {
        return { status: "error", code: "render_failed" } satisfies MermaidRenderResult;
      }
    });
    this.pending.set(request_key, render_promise);
    void render_promise.then(
      () => this.pending.delete(request_key),
      () => this.pending.delete(request_key),
    );
    return render_promise;
  }

  /** 失败任务也必须释放队列，不能阻塞后续图表。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 按插入顺序淘汰最旧结果，限制长会话缓存占用。 */
  private trim_cache(): void {
    while (this.cache.size > MERMAID_RENDER_CACHE_SIZE) {
      const oldest_key = this.cache.keys().next().value;
      if (oldest_key === undefined) return;
      this.cache.delete(oldest_key);
    }
  }
}

export const mermaid_renderer = new MermaidRenderer();

/** 只归一化无语义的编码、换行和连线标签空白。 */
export function normalize_mermaid_source(source: string): string {
  // Mermaid 会拒绝带引号连线标签两侧仅用于排版的空白。
  return source
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/-->[ \t]*\|[ \t]*("[^"\r\n]*")[ \t]*\|/gu, "-->|$1|")
    .trim();
}

/** 从当前应用设计令牌生成 Mermaid 配置及其缓存身份。 */
function build_mermaid_theme_profile(theme_mode: ResolvedThemeMode): MermaidThemeProfile {
  const style = getComputedStyle(document.documentElement);
  const read_token = (name: string): string => style.getPropertyValue(name).trim();
  const font_family = "var(--ui-font-family-base)";
  const theme_variables = {
    background: read_token("--popover"),
    primaryColor: read_token("--muted"),
    primaryTextColor: read_token("--foreground"),
    primaryBorderColor: read_token("--border"),
    secondaryColor: read_token("--accent"),
    tertiaryColor: read_token("--secondary"),
    lineColor: read_token("--muted-foreground"),
    fontFamily: font_family,
    fontSize: "13px",
    darkMode: theme_mode === "dark",
  };
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    secure: ["theme", "themeVariables", "themeCSS", "fontFamily"],
    fontFamily: font_family,
    themeVariables: theme_variables,
    // 保留 SVG 固有尺寸，信息流与预览画布各自决定展示比例。
    flowchart: { useMaxWidth: false },
  };
  return {
    key: JSON.stringify({ theme_mode, theme_variables }),
    config,
  };
}
