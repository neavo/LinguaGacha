import { ArrowRight, ListFilter, Regex, Replace, ReplaceAll, TriangleAlert, X } from "lucide-react";
import * as React from "react";

import "@/widgets/search-bar/search-bar.css";
import { cn } from "@/lib/utils";
import { Button } from "@/shadcn/button";
import { Card, CardContent } from "@/shadcn/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shadcn/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shadcn/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";

export type SearchBarScopeOption<scope_value extends string = string> = {
  value: scope_value;
  label: React.ReactNode;
};

type SearchBarSharedProps<scope_value extends string = string> = React.ComponentProps<"section"> & {
  keyword: string;
  placeholder: string;
  clear_label: string;
  invalid_message: string | null;
  on_keyword_change: (next_keyword: string) => void;
  disabled?: boolean;
  scope: {
    value: scope_value;
    button_label: React.ReactNode;
    aria_label: string;
    tooltip: React.ReactNode;
    options: SearchBarScopeOption<scope_value>[];
    on_change: (next_value: scope_value) => void;
  };
  regex: {
    value: boolean;
    label: React.ReactNode;
    tooltip: React.ReactNode;
    enabled_label: React.ReactNode;
    disabled_label: React.ReactNode;
    on_change: (next_value: boolean) => void;
  };
};

type SearchBarFilterProps<scope_value extends string = string> =
  SearchBarSharedProps<scope_value> & {
    variant: "filter";
  };

type SearchBarReplaceProps<scope_value extends string = string> =
  SearchBarSharedProps<scope_value> & {
    variant: "replace";
    replace_text: string;
    replace_placeholder: string;
    replace_clear_label: string;
    on_replace_text_change: (next_replace_text: string) => void;
    replace_next_label: string;
    replace_all_label: string;
    on_replace_next: () => void | Promise<void>;
    on_replace_all: () => void | Promise<void>;
    extra_actions?: React.ReactNode;
  };

type SearchBarProps<scope_value extends string = string> =
  | SearchBarFilterProps<scope_value>
  | SearchBarReplaceProps<scope_value>;

function resolve_search_bar_card_props<scope_value extends string = string>(
  props: SearchBarProps<scope_value>,
): React.ComponentProps<"section"> {
  if (props.variant === "replace") {
    const {
      variant,
      keyword,
      placeholder,
      clear_label,
      invalid_message,
      on_keyword_change,
      disabled,
      scope,
      regex,
      replace_text,
      replace_placeholder,
      replace_clear_label,
      on_replace_text_change,
      replace_next_label,
      replace_all_label,
      on_replace_next,
      on_replace_all,
      extra_actions,
      ...replace_card_props
    } = props;

    void variant;
    void keyword;
    void placeholder;
    void clear_label;
    void invalid_message;
    void on_keyword_change;
    void disabled;
    void scope;
    void regex;
    void replace_text;
    void replace_placeholder;
    void replace_clear_label;
    void on_replace_text_change;
    void replace_next_label;
    void replace_all_label;
    void on_replace_next;
    void on_replace_all;
    void extra_actions;

    return replace_card_props;
  }

  const {
    variant,
    keyword,
    placeholder,
    clear_label,
    invalid_message,
    on_keyword_change,
    disabled,
    scope,
    regex,
    ...card_props
  } = props;

  void variant;
  void keyword;
  void placeholder;
  void clear_label;
  void invalid_message;
  void on_keyword_change;
  void disabled;
  void scope;
  void regex;

  return card_props;
}

type SearchBarKeywordFieldProps = {
  keyword: string;
  placeholder: string;
  clear_label: string;
  invalid_message: string | null;
  disabled?: boolean;
  on_keyword_change: (next_keyword: string) => void;
  className?: string;
};

function SearchBarKeywordField(props: SearchBarKeywordFieldProps): JSX.Element {
  const show_clear_keyword = props.keyword !== "";
  const show_invalid_state = props.invalid_message !== null;
  const show_inline_controls = show_clear_keyword || show_invalid_state;

  return (
    <InputGroup
      data-disabled={props.disabled ? "true" : undefined}
      className={cn("search-bar__input-group", props.className)}
    >
      <InputGroupInput
        value={props.keyword}
        disabled={props.disabled}
        aria-invalid={show_invalid_state}
        className="search-bar__input"
        placeholder={props.placeholder}
        onChange={(event) => {
          props.on_keyword_change(event.target.value);
        }}
      />
      {show_inline_controls ? (
        <InputGroupAddon align="inline-end" className="search-bar__input-addon">
          {show_clear_keyword ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  disabled={props.disabled}
                  aria-label={props.clear_label}
                  className="search-bar__clear-button"
                  onClick={() => {
                    props.on_keyword_change("");
                  }}
                >
                  <X />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p>{props.clear_label}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {show_invalid_state ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={props.invalid_message ?? undefined}
                  className="search-bar__invalid-button"
                >
                  <TriangleAlert />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p className="search-bar__invalid-tooltip">{props.invalid_message}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

type SearchBarScopeActionProps<scope_value extends string = string> = {
  disabled?: boolean;
  scope: SearchBarSharedProps<scope_value>["scope"];
};

function SearchBarScopeAction<scope_value extends string = string>(
  props: SearchBarScopeActionProps<scope_value>,
): JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="toolbar"
              disabled={props.disabled}
              className="search-bar__action-trigger"
              data-active={props.scope.value === "all" ? undefined : "true"}
              aria-label={props.scope.aria_label}
            >
              <ListFilter data-icon="inline-start" />
              {props.scope.button_label}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={10}>
          <p>{props.scope.tooltip}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup
          value={props.scope.value}
          onValueChange={(next_value) => {
            props.scope.on_change(next_value as scope_value);
          }}
        >
          {props.scope.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SearchBarRegexActionProps = {
  disabled?: boolean;
  regex: SearchBarSharedProps["regex"];
};

function SearchBarRegexAction(props: SearchBarRegexActionProps): JSX.Element {
  const regex_menu_value = props.regex.value ? "enabled" : "disabled";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="toolbar"
              disabled={props.disabled}
              className="search-bar__action-trigger"
              data-active={props.regex.value ? "true" : undefined}
            >
              <Regex data-icon="inline-start" />
              {props.regex.label}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={10}>
          <p>{props.regex.tooltip}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup
          value={regex_menu_value}
          onValueChange={(next_value) => {
            props.regex.on_change(next_value === "enabled");
          }}
        >
          <DropdownMenuRadioItem value="enabled">{props.regex.enabled_label}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="disabled">
            {props.regex.disabled_label}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SearchBarReplaceFieldProps = {
  replace_text: string;
  replace_placeholder: string;
  replace_clear_label: string;
  replace_next_label: string;
  replace_all_label: string;
  disabled?: boolean;
  replace_actions_disabled: boolean;
  on_replace_text_change: (next_replace_text: string) => void;
  on_replace_next: () => void | Promise<void>;
  on_replace_all: () => void | Promise<void>;
};

function SearchBarReplaceField(props: SearchBarReplaceFieldProps): JSX.Element {
  const show_clear_replace_text = props.replace_text !== "";

  return (
    <InputGroup
      data-disabled={props.disabled ? "true" : undefined}
      className="search-bar__input-group search-bar__input-group--replace"
    >
      <InputGroupInput
        value={props.replace_text}
        disabled={props.disabled}
        className="search-bar__input"
        placeholder={props.replace_placeholder}
        onChange={(event) => {
          props.on_replace_text_change(event.target.value);
        }}
      />
      <InputGroupAddon
        align="inline-end"
        className="search-bar__input-addon search-bar__input-addon--replace"
      >
        {show_clear_replace_text ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton
                size="icon-xs"
                disabled={props.disabled}
                aria-label={props.replace_clear_label}
                className="search-bar__clear-button"
                onClick={() => {
                  props.on_replace_text_change("");
                }}
              >
                <X />
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p>{props.replace_clear_label}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton
              size="icon-xs"
              disabled={props.replace_actions_disabled}
              aria-label={props.replace_next_label}
              className="search-bar__replace-button"
              onClick={() => {
                void props.on_replace_next();
              }}
            >
              <Replace />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{props.replace_next_label}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton
              size="icon-xs"
              disabled={props.replace_actions_disabled}
              aria-label={props.replace_all_label}
              className="search-bar__replace-button"
              onClick={() => {
                void props.on_replace_all();
              }}
            >
              <ReplaceAll />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{props.replace_all_label}</p>
          </TooltipContent>
        </Tooltip>
      </InputGroupAddon>
    </InputGroup>
  );
}

export function SearchBar<scope_value extends string = string>(
  props: SearchBarProps<scope_value>,
): JSX.Element {
  const {
    className,
    variant,
    keyword,
    placeholder,
    clear_label,
    invalid_message,
    on_keyword_change,
    disabled,
    scope,
    regex,
  } = props;
  const card_props = resolve_search_bar_card_props(props);
  // 将替换动作的可用性收口在 SearchBar 内，避免页面层重复维护同一组前置条件。
  const replace_actions_disabled =
    variant !== "replace" ||
    disabled === true ||
    keyword === "" ||
    props.replace_text === "" ||
    invalid_message !== null;

  return (
    <Card
      variant="toolbar"
      role="search"
      className={cn("search-bar", `search-bar--${variant}`, className)}
      {...card_props}
    >
      <CardContent className="search-bar__content">
        <div
          className={cn(
            "search-bar__toolbar",
            variant === "replace" ? "search-bar__toolbar--replace" : null,
          )}
        >
          {variant === "replace" ? (
            <div className="search-bar__replace-fields">
              <SearchBarKeywordField
                keyword={keyword}
                placeholder={placeholder}
                clear_label={clear_label}
                invalid_message={invalid_message}
                disabled={disabled}
                on_keyword_change={on_keyword_change}
              />
              <div className="search-bar__replace-arrow" aria-hidden="true">
                <ArrowRight />
              </div>
              <SearchBarReplaceField
                replace_text={props.replace_text}
                replace_placeholder={props.replace_placeholder}
                replace_clear_label={props.replace_clear_label}
                replace_next_label={props.replace_next_label}
                replace_all_label={props.replace_all_label}
                disabled={disabled}
                replace_actions_disabled={replace_actions_disabled}
                on_replace_text_change={props.on_replace_text_change}
                on_replace_next={props.on_replace_next}
                on_replace_all={props.on_replace_all}
              />
            </div>
          ) : (
            <SearchBarKeywordField
              keyword={keyword}
              placeholder={placeholder}
              clear_label={clear_label}
              invalid_message={invalid_message}
              disabled={disabled}
              on_keyword_change={on_keyword_change}
            />
          )}
          <div className="search-bar__actions">
            <SearchBarScopeAction disabled={disabled} scope={scope} />
            <SearchBarRegexAction disabled={disabled} regex={regex} />
            {variant === "replace" ? props.extra_actions : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
