import { tags } from "@lezer/highlight";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  highlightSpecialChars,
  highlightWhitespace,
  hoverTooltip,
  tooltips,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";

export type AppEditorMode = "plain" | "markdown";
export type AppTextMarkTone = "success" | "warning";

export type AppTextMark = {
  start: number;
  end: number;
  tone: AppTextMarkTone;
  tooltip?: string;
};

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
  active_line_background: string;
  markdown: MarkdownPalette;
};

const light_editor_palette: EditorPalette = {
  background: "#ffffff",
  foreground: "#1f2328",
  gutter_background: "#ffffff",
  gutter_foreground: "#6e7781",
  gutter_active_foreground: "#4c5663",
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

const fullwidth_space_decoration = Decoration.mark({
  class: "cm-highlightFullwidthSpace",
});

const success_text_mark_decoration = Decoration.mark({
  class: "app-text-mark app-text-mark--success",
});

const warning_text_mark_decoration = Decoration.mark({
  class: "app-text-mark app-text-mark--warning",
});

export const set_app_editor_text_marks_effect = StateEffect.define<readonly AppTextMark[]>();

const fullwidth_space_matcher = new MatchDecorator({
  regexp: /\u3000/g,
  decoration: fullwidth_space_decoration,
});

const fullwidth_space_highlight_extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = fullwidth_space_matcher.createDeco(view);
    }

    update(update: ViewUpdate): void {
      this.decorations = fullwidth_space_matcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations(plugin) {
      return plugin.decorations;
    },
  },
);

export function normalize_app_text_marks(
  text_length: number,
  marks: readonly AppTextMark[],
): AppTextMark[] {
  return marks
    .map((mark) => {
      return {
        ...mark,
        start: Math.max(0, Math.min(mark.start, text_length)),
        end: Math.max(0, Math.min(mark.end, text_length)),
      };
    })
    .filter((mark) => mark.end > mark.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      if (left.end !== right.end) {
        return left.end - right.end;
      }

      return left.tone.localeCompare(right.tone);
    });
}

function resolve_segment_tooltip(marks: readonly AppTextMark[]): string | undefined {
  const tooltip_lines = [
    ...new Set(marks.map((mark) => mark.tooltip ?? "").filter((tooltip) => tooltip.length > 0)),
  ];

  if (tooltip_lines.length === 0) {
    return undefined;
  }

  return tooltip_lines.join("\n\n");
}

function build_app_text_mark_decorations(
  text_length: number,
  marks: readonly AppTextMark[],
): DecorationSet {
  if (marks.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  normalize_app_text_marks(text_length, marks).forEach((mark) => {
    builder.add(
      mark.start,
      mark.end,
      mark.tone === "success" ? success_text_mark_decoration : warning_text_mark_decoration,
    );
  });

  return builder.finish();
}

export const app_editor_text_mark_field = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(current_decorations, transaction) {
    let next_decorations = current_decorations.map(transaction.changes);

    transaction.effects.forEach((effect) => {
      if (effect.is(set_app_editor_text_marks_effect)) {
        next_decorations = build_app_text_mark_decorations(transaction.newDoc.length, effect.value);
      }
    });

    return next_decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

function resolve_hovered_app_text_marks(
  marks: readonly AppTextMark[],
  pos: number,
  side: number,
): AppTextMark[] {
  const containing_marks = marks.filter((mark) => {
    if (mark.tooltip === undefined || mark.tooltip.length === 0) {
      return false;
    }

    if (side < 0) {
      return mark.start < pos && pos <= mark.end;
    }

    return mark.start <= pos && pos < mark.end;
  });

  if (containing_marks.length === 0) {
    return [];
  }

  const shortest_length = Math.min(...containing_marks.map((mark) => mark.end - mark.start));
  return containing_marks.filter((mark) => mark.end - mark.start === shortest_length);
}

export function create_app_editor_text_mark_hover_extension(marks_ref: {
  current: readonly AppTextMark[];
}): Extension {
  return [
    tooltips({
      parent: document.body,
      position: "fixed",
    }),
    hoverTooltip((view, pos, side): Tooltip | null => {
      void view;
      const hovered_marks = resolve_hovered_app_text_marks(marks_ref.current, pos, side);

      if (hovered_marks.length === 0) {
        return null;
      }

      const tooltip = resolve_segment_tooltip(hovered_marks);
      if (tooltip === undefined) {
        return null;
      }

      const tooltip_start = Math.min(...hovered_marks.map((mark) => mark.start));
      const tooltip_end = Math.max(...hovered_marks.map((mark) => mark.end));

      return {
        pos: tooltip_start,
        end: tooltip_end,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "app-text-mark-tooltip";

          const copy = document.createElement("div");
          copy.className = "app-text-mark-tooltip__copy";
          copy.textContent = tooltip;
          dom.append(copy);

          return { dom };
        },
      };
    }),
  ];
}

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

export const app_editor_whitespace_extension: Extension = [
  highlightSpecialChars(),
  highlightWhitespace(),
  fullwidth_space_highlight_extension,
];

export function resolve_app_editor_mode_extensions(mode: AppEditorMode): Extension {
  if (mode === "markdown") {
    // 为什么：提示词编辑器里常见的标题、链接、删除线都依赖 Markdown 语言扩展才能得到稳定高亮
    return markdown({ base: markdownLanguage });
  }

  return [];
}
