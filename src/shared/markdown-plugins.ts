import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { remarkAlert } from "remark-github-blockquote-alert";

/** 聊天与 PDF 共用内容语法；各消费方拥有 HTML、资源和排版规则。 */
export const MARKDOWN_CJK = cjk;
export const MARKDOWN_MATH = createMathPlugin({ singleDollarTextMath: true });
export const MARKDOWN_ALERT = remarkAlert;
