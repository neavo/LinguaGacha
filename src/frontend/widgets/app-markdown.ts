import type { Components } from "streamdown";

// 使用原生标签，让共享 CSS 负责正文排版。
export const MARKDOWN_BASE_COMPONENTS: Components = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  hr: "hr",
  strong: "strong",
};
