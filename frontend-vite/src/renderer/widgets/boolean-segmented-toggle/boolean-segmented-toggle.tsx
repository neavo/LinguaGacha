import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import '@/widgets/boolean-segmented-toggle/boolean-segmented-toggle.css'

const BOOLEAN_SEGMENTED_VALUES = {
  disabled: 'disabled',
  enabled: 'enabled',
} as const

type BooleanSegmentedToggleProps = {
  aria_label: string
  value: boolean
  disabled?: boolean
  className?: string
  item_class_name?: string
  size?: 'default' | 'sm' | 'lg'
  disabled_label?: string
  enabled_label?: string
  on_value_change: (next_value: boolean) => void
}

export function BooleanSegmentedToggle(
  props: BooleanSegmentedToggleProps,
): JSX.Element {
  const { t } = useI18n()
  const current_value = props.value
    ? BOOLEAN_SEGMENTED_VALUES.enabled
    : BOOLEAN_SEGMENTED_VALUES.disabled
  const resolved_disabled_label = props.disabled_label ?? t('app.toggle.disabled')
  const resolved_enabled_label = props.enabled_label ?? t('app.toggle.enabled')
  const resolved_item_class_name = cn(
    'boolean-segmented-toggle__item',
    props.item_class_name,
  )

  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      aria-label={props.aria_label}
      className={props.className}
      size={props.size}
      value={current_value}
      disabled={props.disabled}
      onValueChange={(next_value) => {
        if (next_value === BOOLEAN_SEGMENTED_VALUES.disabled) {
          props.on_value_change(false)
        } else if (next_value === BOOLEAN_SEGMENTED_VALUES.enabled) {
          props.on_value_change(true)
        }
      }}
    >
      <ToggleGroupItem
        className={resolved_item_class_name}
        value={BOOLEAN_SEGMENTED_VALUES.disabled}
      >
        {resolved_disabled_label}
      </ToggleGroupItem>
      <ToggleGroupItem
        className={resolved_item_class_name}
        value={BOOLEAN_SEGMENTED_VALUES.enabled}
      >
        {resolved_enabled_label}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
