import { closestCenter } from "@dnd-kit/collision";
import {
  Feedback,
  KeyboardSensor,
  PointerSensor,
  PointerActivationConstraints,
} from "@dnd-kit/dom";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import type { DragDropProvider } from "@dnd-kit/react";
import type { ComponentProps } from "react";

// 保持桌面手柄的起拖距离与原排序动画；新版默认会立即起拖并采用更长的缓动。
const SORTABLE_ANIMATION = { duration: 200, easing: "ease" };
export const SORTABLE_PROVIDER_OPTIONS = {
  sensors: [
    PointerSensor.configure({
      activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
    }),
    KeyboardSensor,
  ],
  plugins: (defaults) => [
    ...defaults,
    Feedback.configure({
      keyboardTransition: SORTABLE_ANIMATION,
      dropAnimation: SORTABLE_ANIMATION,
    }),
  ],
} satisfies Pick<ComponentProps<typeof DragDropProvider>, "sensors" | "plugins">;

export const SORTABLE_OPTIONS = {
  collisionDetector: closestCenter,
  transition: { ...SORTABLE_ANIMATION, idle: false },
  // React 拥有预览顺序，保留键盘排序，避免 OptimisticSortingPlugin 再次改写 DOM。
  plugins: [SortableKeyboardPlugin],
};
