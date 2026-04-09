import { useI18n } from '@/i18n'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

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
  on_value_change: (next_value: boolean) => void
}

export function BooleanSegmentedToggle(
  props: BooleanSegmentedToggleProps,
): JSX.Element {
  const { t } = useI18n()
  const current_value = props.value
    ? BOOLEAN_SEGMENTED_VALUES.enabled
    : BOOLEAN_SEGMENTED_VALUES.disabled

  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      aria-label={props.aria_label}
      className={props.className}
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
        className={props.item_class_name}
        value={BOOLEAN_SEGMENTED_VALUES.disabled}
      >
        {t('app.toggle.disabled')}
      </ToggleGroupItem>
      <ToggleGroupItem
        className={props.item_class_name}
        value={BOOLEAN_SEGMENTED_VALUES.enabled}
      >
        {t('app.toggle.enabled')}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
