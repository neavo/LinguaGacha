import { tags } from "@lezer/highlight";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  RectangleMarker,
  layer,
  type LayerMarker,
  type ViewUpdate,
} from "@codemirror/view";

export type AppEditorMode = "plain" | "markdown";

type MarkdownPalette = {
  marker: string;
  heading: string;
  strong: string;
  emphasis: string;
  inline_code: string;
  link: string;
  quote: string;
  separator: string;
};

type EditorPalette = {
  background: string;
  foreground: string;
  gutter_background: string;
  gutter_foreground: string;
  gutter_active_foreground: string;
  selection_background: string;
  active_line_background: string;
  markdown: MarkdownPalette;
};

const light_editor_palette: EditorPalette = {
  background: "#ffffff",
  foreground: "#1f2328",
  gutter_background: "#ffffff",
  gutter_foreground: "#6e7781",
  gutter_active_foreground: "#4c5663",
  selection_background: "#e9eef9",
  active_line_background: "rgba(31, 35, 40, 0.045)",
  markdown: {
    marker: "#0451a5",
    heading: "#003eaa",
    strong: "#003eaa",
    emphasis: "#2f5fb3",
    inline_code: "#a31515",
    link: "#0451a5",
    quote: "#6e7781",
    separator: "#9a6700",
  },
};

const dark_editor_palette: EditorPalette = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  gutter_background: "#1e1e1e",
  gutter_foreground: "#858585",
  gutter_active_foreground: "#c6c6c6",
  selection_background: "#3b4556",
  active_line_background: "rgba(255, 255, 255, 0.045)",
  markdown: {
    marker: "#569cd6",
    heading: "#4ea1ff",
    strong: "#4ea1ff",
    emphasis: "#78b7ff",
    inline_code: "#ce9178",
    link: "#569cd6",
    quote: "#8b949e",
    separator: "#d7ba7d",
  },
};

function create_editor_theme(palette: EditorPalette, dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: palette.background,
        color: palette.foreground,
      },
      ".cm-content": {
        caretColor: "var(--primary)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--primary)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "transparent",
      },
      ".app-editor-selectionBackground": {
        backgroundColor: palette.selection_background,
      },
      ".cm-gutters": {
        backgroundColor: palette.gutter_background,
        color: palette.gutter_foreground,
      },
      ".cm-activeLineGutter": {
        backgroundColor: palette.active_line_background,
        color: palette.gutter_active_foreground,
      },
    },
    {
      dark,
    },
  );
}

function create_full_height_selection_marker(
  view: EditorView,
  marker: RectangleMarker,
): RectangleMarker {
  const marker_center = marker.top + marker.height / 2;
  const line_block = view.lineBlockAtHeight(marker_center);
  const line_height = line_block.bottom - line_block.top;
  const target_height = Math.max(line_height, view.defaultLineHeight, marker.height);
  const extra_height = target_height - marker.height;

  if (extra_height === 0) {
    return marker;
  }

  return new RectangleMarker(
    "app-editor-selectionBackground",
    marker.left,
    marker.top - extra_height / 2,
    marker.width,
    marker.height + extra_height,
  );
}

export const app_editor_full_height_selection_extension = layer({
  above: false,
  class: "app-editor-selectionLayer",
  markers(view: EditorView): readonly LayerMarker[] {
    const markers: LayerMarker[] = [];

    view.state.selection.ranges.forEach((range) => {
      if (range.empty) {
        return;
      }

      RectangleMarker.forRange(view, "app-editor-selectionBackground", range).forEach((marker) => {
        markers.push(create_full_height_selection_marker(view, marker));
      });
    });

    return markers;
  },
  update(update: ViewUpdate): boolean {
    return update.docChanged || update.selectionSet || update.viewportChanged;
  },
});

function create_markdown_highlight_extension(palette: EditorPalette): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: tags.processingInstruction,
        color: palette.markdown.marker,
      },
      {
        tag: [
          tags.heading1,
          tags.heading2,
          tags.heading3,
          tags.heading4,
          tags.heading5,
          tags.heading6,
          tags.heading,
        ],
        color: palette.markdown.heading,
        fontWeight: "700",
      },
      {
        tag: tags.strong,
        color: palette.markdown.strong,
        fontWeight: "700",
      },
      {
        tag: tags.emphasis,
        color: palette.markdown.emphasis,
        fontStyle: "italic",
      },
      {
        tag: tags.strikethrough,
        color: palette.foreground,
        textDecoration: "line-through",
      },
      {
        tag: tags.monospace,
        color: palette.markdown.inline_code,
      },
      {
        tag: [tags.link, tags.url, tags.labelName],
        color: palette.markdown.link,
        textDecoration: "underline",
      },
      {
        tag: tags.quote,
        color: palette.markdown.quote,
      },
      {
        tag: tags.contentSeparator,
        color: palette.markdown.separator,
      },
    ]),
  );
}

export function resolve_app_editor_theme_extensions(
  resolved_theme: string | undefined,
  mode: AppEditorMode,
): Extension {
  const palette = resolved_theme === "dark" ? dark_editor_palette : light_editor_palette;
  const base_theme = create_editor_theme(palette, resolved_theme === "dark");

  if (mode === "markdown") {
    return [base_theme, create_markdown_highlight_extension(palette)];
  }

  return base_theme;
}

export function resolve_app_editor_mode_extensions(mode: AppEditorMode): Extension {
  if (mode === "markdown") {
    // 为什么：提示词编辑器里常见的标题、链接、删除线都依赖 Markdown 语言扩展才能得到稳定高亮。
    return markdown({ base: markdownLanguage });
  }

  return [];
}
