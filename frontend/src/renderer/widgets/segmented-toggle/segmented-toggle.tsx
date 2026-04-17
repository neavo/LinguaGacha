import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/shadcn/toggle-group'
import '@/widgets/segmented-toggle/segmented-toggle.css'

export type SegmentedToggleOption<Value extends string> = {
  value: Value
  label: ReactNode
  disabled?: boolean
}

type SegmentedToggleProps<Value extends string> = {
  aria_label: string
  value: Value
  options: readonly SegmentedToggleOption<Value>[]
  disabled?: boolean
  className?: string
  item_class_name?: string
  size?: 'default' | 'sm' | 'lg'
  stretch?: boolean
  on_value_change: (next_value: Value) => void
}

function is_segmented_toggle_value<Value extends string>(
  options: readonly SegmentedToggleOption<Value>[],
  candidate: string,
): candidate is Value {
  return options.some((option) => option.value === candidate)
}

export function SegmentedToggle<Value extends string>(
  props: SegmentedToggleProps<Value>,
): JSX.Element {
  const resolved_item_class_name = cn(
    'segmented-toggle__item',
    props.stretch ? 'flex-1' : undefined,
    props.item_class_name,
  )

  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      size={props.size}
      aria-label={props.aria_label}
      className={cn(
        'segmented-toggle',
        props.stretch ? 'w-full justify-stretch' : undefined,
        props.className,
      )}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(next_value) => {
        if (is_segmented_toggle_value(props.options, next_value)) {
          props.on_value_change(next_value)
        }
      }}
    >
      {props.options.map((option) => {
        return (
          <ToggleGroupItem
            key={option.value}
            className={resolved_item_class_name}
            value={option.value}
            disabled={props.disabled || option.disabled}
          >
            {option.label}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

