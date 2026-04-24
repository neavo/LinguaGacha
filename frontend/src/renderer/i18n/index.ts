import {
  Fragment,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { en_us_messages, zh_cn_messages } from "@/i18n/messages";
import type { Locale, LocaleMessageSchema } from "@/i18n/types";

const DEFAULT_LOCALE: Locale = "zh-CN";

type JoinPath<prefix extends string, key extends string> = prefix extends ""
  ? key
  : `${prefix}.${key}`;

type NestedMessageKey<tree, prefix extends string = ""> = {
  [key in keyof tree & string]: tree[key] extends string
    ? JoinPath<prefix, key>
    : tree[key] extends object
      ? NestedMessageKey<tree[key], JoinPath<prefix, key>>
      : never;
}[keyof tree & string];

type LocaleMessages = LocaleMessageSchema<typeof zh_cn_messages>;
export type LocaleKey = NestedMessageKey<LocaleMessages>;
export type RichTextComponentMap = Partial<Record<string, (children: ReactNode) => ReactNode>>;

type LocaleContextValue = {
  locale: Locale;
  t: (key: LocaleKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const ELEMENT_NODE_TYPE = 1;
const TEXT_NODE_TYPE = 3;

function resolve_locale_from_app_language(app_language: string): Locale {
  if (app_language === "EN") {
    return "en-US";
  }

  return DEFAULT_LOCALE;
}

function flatten_message_map(
  message_tree: Record<string, unknown>,
  message_map: Map<string, string>,
  path_prefix: string,
): void {
  for (const [entry_key, entry_value] of Object.entries(message_tree)) {
    const next_path = path_prefix === "" ? entry_key : `${path_prefix}.${entry_key}`;

    if (typeof entry_value === "string") {
      message_map.set(next_path, entry_value);
    } else if (typeof entry_value === "object" && entry_value !== null) {
      flatten_message_map(entry_value as Record<string, unknown>, message_map, next_path);
    }
  }
}

function build_message_map(messages: LocaleMessages): ReadonlyMap<LocaleKey, string> {
  const message_map: Map<string, string> = new Map();
  flatten_message_map(messages as Record<string, unknown>, message_map, "");
  return message_map as ReadonlyMap<LocaleKey, string>;
}

function read_message_value(message_map: ReadonlyMap<LocaleKey, string>, key: LocaleKey): string {
  const message_value = message_map.get(key);

  if (message_value !== undefined) {
    return message_value;
  } else {
    return key;
  }
}

function render_rich_text_text(text_content: string, key_prefix: string): ReactNode {
  const text_lines = text_content.split("\n");

  if (text_lines.length === 1) {
    return text_content;
  } else {
    return text_lines.flatMap((line, line_index) => {
      const is_last_line = line_index === text_lines.length - 1;

      if (is_last_line) {
        return [line];
      } else {
        return [line, createElement("br", { key: `${key_prefix}-line-break-${line_index}` })];
      }
    });
  }
}

function render_rich_text_nodes(
  child_nodes: ArrayLike<ChildNode>,
  component_map: RichTextComponentMap,
  key_prefix: string,
): ReactNode[] {
  return Array.from(child_nodes).map((child_node, child_index) => {
    return render_rich_text_node(child_node, component_map, `${key_prefix}-${child_index}`);
  });
}

function render_rich_text_node(
  child_node: ChildNode,
  component_map: RichTextComponentMap,
  key_prefix: string,
): ReactNode {
  if (child_node.nodeType === TEXT_NODE_TYPE) {
    return createElement(
      Fragment,
      { key: key_prefix },
      render_rich_text_text(child_node.textContent ?? "", key_prefix),
    );
  } else if (child_node.nodeType === ELEMENT_NODE_TYPE) {
    const element_node = child_node as Element;
    const element_children = render_rich_text_nodes(
      element_node.childNodes,
      component_map,
      `${key_prefix}-child`,
    );
    const component_renderer = component_map[element_node.tagName.toLowerCase()];

    if (component_renderer !== undefined) {
      return createElement(Fragment, { key: key_prefix }, component_renderer(element_children));
    } else {
      return createElement(Fragment, { key: key_prefix }, element_children);
    }
  } else {
    return createElement(Fragment, { key: key_prefix });
  }
}

function parse_rich_text_root(source_text: string): Element | null {
  if (typeof DOMParser === "undefined") {
    return null;
  } else {
    // 统一用受控容器包一层，避免多根节点时每个调用方各自补壳处理。
    const document = new DOMParser().parseFromString(
      `<lg-rich-text>${source_text}</lg-rich-text>`,
      "text/html",
    );
    const root_element = document.body.firstElementChild;

    if (root_element instanceof Element) {
      return root_element;
    } else {
      return null;
    }
  }
}

export function render_rich_text(
  source_text: string,
  component_map: RichTextComponentMap,
): ReactNode {
  const root_element = parse_rich_text_root(source_text);

  if (root_element !== null) {
    return render_rich_text_nodes(root_element.childNodes, component_map, "rich-text");
  } else {
    return source_text;
  }
}

const MESSAGE_MAP_BY_LOCALE: Readonly<Record<Locale, ReadonlyMap<LocaleKey, string>>> = {
  "zh-CN": build_message_map(zh_cn_messages),
  "en-US": build_message_map(en_us_messages),
};

export function LocaleProvider({ children }: { children: ReactNode }): ReactNode {
  const { settings_snapshot } = useDesktopRuntime();
  const locale = useMemo<Locale>(() => {
    return resolve_locale_from_app_language(settings_snapshot.app_language);
  }, [settings_snapshot.app_language]);
  const message_map = MESSAGE_MAP_BY_LOCALE[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.setAttribute("data-locale", locale);
  }, [locale]);

  const t = useCallback(
    (key: LocaleKey): string => {
      return read_message_value(message_map, key);
    },
    [message_map],
  );

  // Why: 文案函数会进入很多页面级 callback/effect 的依赖数组，
  // 这里必须稳定引用，避免页面在静置时持续重复刷新。
  const context_value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      t,
    };
  }, [locale, t]);

  return createElement(LocaleContext.Provider, { value: context_value }, children);
}

export function useI18n(): LocaleContextValue {
  const locale_context = useContext(LocaleContext);

  if (locale_context !== null) {
    return locale_context;
  } else {
    throw new Error("useI18n must be used inside LocaleProvider");
  }
}
