import { cva } from "class-variance-authority";
import "./badge.css";

// 普通徽标和组合控件共用语义色，尺寸与颜色值由 badge.css 维护。
export const badgeVariants = cva("app-badge", {
  variants: {
    tone: {
      neutral: "app-badge--neutral",
      brand: "app-badge--brand",
      success: "app-badge--success",
      warning: "app-badge--warning",
      failure: "app-badge--failure",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});
