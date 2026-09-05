import { useCallback, useRef } from "react";

type TerminalPromptSuppressionReason = "manual-stop";
type TerminalFeedback = "done" | "stopped";

export function resolve_task_terminal_transition(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  is_active_status: (status: string) => boolean;
}): { feedback: TerminalFeedback | null; prompt_boundary: boolean } {
  const prompt_boundary =
    args.is_active_status(args.previous_status) && !args.is_active_status(args.next_status);
  if (args.previous_status === "stopping" && args.next_status !== "stopping") {
    return { feedback: "stopped", prompt_boundary };
  }
  if (!args.is_active_status(args.previous_status) || args.previous_status === "stopping") {
    return { feedback: null, prompt_boundary };
  }

  const completed = args.next_status === "done" || (args.next_status === "idle" && args.has_result);
  return { feedback: completed ? "done" : null, prompt_boundary };
}

export type TerminalPromptSuppression = {
  clear_terminal_prompt_suppression: () => void;
  consume_terminal_prompt_suppression: () => boolean;
  suppress_next_terminal_prompt: (reason: TerminalPromptSuppressionReason) => void;
};

export function useTerminalPromptSuppression(): TerminalPromptSuppression {
  const suppression_reason_ref = useRef<TerminalPromptSuppressionReason | null>(null);

  const clear_terminal_prompt_suppression = useCallback((): void => {
    suppression_reason_ref.current = null;
  }, []);

  const consume_terminal_prompt_suppression = useCallback((): boolean => {
    if (suppression_reason_ref.current === null) {
      return false;
    }

    suppression_reason_ref.current = null;
    return true;
  }, []);

  const suppress_next_terminal_prompt = useCallback(
    (reason: TerminalPromptSuppressionReason): void => {
      suppression_reason_ref.current = reason;
    },
    [],
  );

  return {
    clear_terminal_prompt_suppression,
    consume_terminal_prompt_suppression,
    suppress_next_terminal_prompt,
  };
}
