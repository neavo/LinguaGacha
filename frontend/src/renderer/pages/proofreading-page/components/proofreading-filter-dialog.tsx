import { useEffect, useMemo, useState } from 'react'

import { useI18n } from '@/i18n'
import {
  PROOFREADING_NO_WARNING_CODE,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_CODES,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  clone_proofreading_filter_options,
  normalize_proofreading_filter_options,
  resolve_proofreading_filter_source_items,
  resolve_proofreading_status_sort_rank,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
  type ProofreadingSnapshot,
} from '@/pages/proofreading-page/types'
import { Button } from '@/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/shadcn/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/shadcn/empty'
import { Input } from '@/shadcn/input'
import { ScrollArea } from '@/shadcn/scroll-area'

type ProofreadingFilterDialogProps = {
  open: boolean
  snapshot: ProofreadingSnapshot
  current_filters: ProofreadingFilterOptions
  on_confirm: (next_filters: ProofreadingFilterOptions) => Promise<void>
  on_close: () => void
}

function build_term_key(term: ProofreadingGlossaryTerm): string {
  return `${term[0]}→${term[1]}`
}

function toggle_string(values: string[], target_value: string): string[] {
  return values.includes(target_value)
    ? values.filter((value) => value !== target_value)
    : [...values, target_value]
}

function toggle_term(
  glossary_terms: ProofreadingGlossaryTerm[],
  target_term: ProofreadingGlossaryTerm,
): ProofreadingGlossaryTerm[] {
  const target_key = build_term_key(target_term)
  if (glossary_terms.some((term) => build_term_key(term) === target_key)) {
    return glossary_terms.filter((term) => build_term_key(term) !== target_key)
  }

  return [...glossary_terms, target_term]
}

function filter_items_by_options(args: {
  items: ProofreadingItem[]
  filters: ProofreadingFilterOptions
  apply_glossary_terms: boolean
}): ProofreadingItem[] {
  const selected_warning_set = new Set(args.filters.warning_types)
  const selected_status_set = new Set(args.filters.statuses)
  const selected_file_path_set = new Set(args.filters.file_paths)
  const selected_term_key_set = new Set(args.filters.glossary_terms.map((term) => build_term_key(term)))

  return args.items.filter((item) => {
    if (selected_file_path_set.size > 0 && !selected_file_path_set.has(item.file_path)) {
      return false
    }

    if (selected_status_set.size > 0 && !selected_status_set.has(item.status)) {
      return false
    }

    if (item.warnings.length > 0) {
      const matched_warning = item.warnings.some((warning) => selected_warning_set.has(warning))
      if (selected_warning_set.size > 0 && !matched_warning) {
        return false
      }
    } else if (
      selected_warning_set.size > 0
      && !selected_warning_set.has(PROOFREADING_NO_WARNING_CODE)
    ) {
      return false
    }

    if (!args.apply_glossary_terms || !item.warnings.includes('GLOSSARY')) {
      return true
    }

    if (selected_term_key_set.size === 0) {
      return false
    }

    return item.failed_glossary_terms.some((term) => selected_term_key_set.has(build_term_key(term)))
  })
}

function FilterToggleButton(props: {
  label: string
  count: number
  selected: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="proofreading-page__filter-toggle"
      data-selected={props.selected ? 'true' : undefined}
      onClick={props.onClick}
    >
      <span className="proofreading-page__filter-toggle-label">{props.label}</span>
      <span className="proofreading-page__filter-toggle-count">{props.count.toString()}</span>
    </button>
  )
}

function FilterListRow(props: {
  label: string
  count: number
  selected: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="proofreading-page__filter-list-row"
      data-selected={props.selected ? 'true' : undefined}
      onClick={props.onClick}
    >
      <span className="proofreading-page__filter-list-row-copy">{props.label}</span>
      <span className="proofreading-page__filter-list-row-count">{props.count.toString()}</span>
    </button>
  )
}

export function ProofreadingFilterDialog(
  props: ProofreadingFilterDialogProps,
): JSX.Element {
  const { t } = useI18n()
  const [draft_filters, set_draft_filters] = useState<ProofreadingFilterOptions>(() => {
    return normalize_proofreading_filter_options(
      props.current_filters,
      resolve_proofreading_filter_source_items(props.snapshot.items),
    )
  })
  const [file_keyword, set_file_keyword] = useState('')
  const [term_keyword, set_term_keyword] = useState('')
  const [submitting, set_submitting] = useState(false)

  useEffect(() => {
    if (!props.open) {
      return
    }

    const filter_source_items = resolve_proofreading_filter_source_items(props.snapshot.items)
    set_draft_filters(normalize_proofreading_filter_options(props.current_filters, filter_source_items))
    set_file_keyword('')
    set_term_keyword('')
    set_submitting(false)
  }, [props.current_filters, props.open, props.snapshot.items])

  const filter_source_items = useMemo(() => {
    return resolve_proofreading_filter_source_items(props.snapshot.items)
  }, [props.snapshot.items])

  const linked_filters = useMemo<ProofreadingFilterOptions>(() => {
    return {
      ...draft_filters,
      glossary_terms: [],
    }
  }, [draft_filters])

  const linked_filtered_items = useMemo(() => {
    return filter_items_by_options({
      items: filter_source_items,
      filters: linked_filters,
      apply_glossary_terms: false,
    })
  }, [filter_source_items, linked_filters])

  const available_statuses = useMemo(() => {
    return [...new Set(filter_source_items.map((item) => item.status))]
      .sort((left_status, right_status) => {
        const left_rank = resolve_proofreading_status_sort_rank(left_status)
        const right_rank = resolve_proofreading_status_sort_rank(right_status)
        if (left_rank !== right_rank) {
          return left_rank - right_rank
        }

        return left_status.localeCompare(right_status)
      })
  }, [filter_source_items])

  const available_warning_types = useMemo(() => {
    const warning_type_set = new Set<string>([PROOFREADING_NO_WARNING_CODE])
    filter_source_items.forEach((item) => {
      if (item.warnings.length === 0) {
        warning_type_set.add(PROOFREADING_NO_WARNING_CODE)
        return
      }

      item.warnings.forEach((warning) => {
        warning_type_set.add(warning)
      })
    })

    return PROOFREADING_WARNING_CODES.filter((warning) => warning_type_set.has(warning))
  }, [filter_source_items])

  const available_file_paths = useMemo(() => {
    return [...new Set(filter_source_items.map((item) => item.file_path))]
      .sort((left_path, right_path) => left_path.localeCompare(right_path))
  }, [filter_source_items])

  const status_count_by_code = useMemo(() => {
    const next_count_by_code: Record<string, number> = {}
    linked_filtered_items.forEach((item) => {
      next_count_by_code[item.status] = (next_count_by_code[item.status] ?? 0) + 1
    })
    return next_count_by_code
  }, [linked_filtered_items])

  const warning_count_by_code = useMemo(() => {
    const next_count_by_code: Record<string, number> = {
      [PROOFREADING_NO_WARNING_CODE]: 0,
    }
    linked_filtered_items.forEach((item) => {
      if (item.warnings.length === 0) {
        next_count_by_code[PROOFREADING_NO_WARNING_CODE] = (
          next_count_by_code[PROOFREADING_NO_WARNING_CODE] ?? 0
        ) + 1
        return
      }

      item.warnings.forEach((warning) => {
        next_count_by_code[warning] = (next_count_by_code[warning] ?? 0) + 1
      })
    })
    return next_count_by_code
  }, [linked_filtered_items])

  const file_count_by_path = useMemo(() => {
    const next_count_by_path: Record<string, number> = {}
    linked_filtered_items.forEach((item) => {
      next_count_by_path[item.file_path] = (next_count_by_path[item.file_path] ?? 0) + 1
    })
    return next_count_by_path
  }, [linked_filtered_items])

  const term_count_entries = useMemo(() => {
    if (!draft_filters.warning_types.includes('GLOSSARY')) {
      return []
    }

    const next_term_count_map = new Map<string, { term: ProofreadingGlossaryTerm; count: number }>()
    linked_filtered_items.forEach((item) => {
      if (!item.warnings.includes('GLOSSARY')) {
        return
      }

      item.failed_glossary_terms.forEach((term) => {
        const term_key = build_term_key(term)
        const previous_entry = next_term_count_map.get(term_key)
        next_term_count_map.set(term_key, {
          term,
          count: (previous_entry?.count ?? 0) + 1,
        })
      })
    })

    return [...next_term_count_map.values()]
      .sort((left_entry, right_entry) => {
        if (left_entry.count !== right_entry.count) {
          return right_entry.count - left_entry.count
        }

        return build_term_key(left_entry.term).localeCompare(build_term_key(right_entry.term))
      })
  }, [draft_filters.warning_types, linked_filtered_items])

  const visible_file_paths = useMemo(() => {
    const normalized_keyword = file_keyword.trim().toLocaleLowerCase()
    if (normalized_keyword === '') {
      return available_file_paths
    }

    return available_file_paths.filter((file_path) => {
      return file_path.toLocaleLowerCase().includes(normalized_keyword)
    })
  }, [available_file_paths, file_keyword])

  const visible_term_entries = useMemo(() => {
    const normalized_keyword = term_keyword.trim().toLocaleLowerCase()
    if (normalized_keyword === '') {
      return term_count_entries
    }

    return term_count_entries.filter((entry) => {
      return build_term_key(entry.term).toLocaleLowerCase().includes(normalized_keyword)
    })
  }, [term_count_entries, term_keyword])

  async function handle_confirm(): Promise<void> {
    set_submitting(true)
    try {
      await props.on_confirm(clone_proofreading_filter_options(draft_filters))
    } finally {
      set_submitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open && !submitting) {
          props.on_close()
        }
      }}
    >
      <DialogContent size="xl" className="proofreading-page__filter-dialog-shell">
        <DialogTitle className="sr-only">{t('proofreading_page.action.filter')}</DialogTitle>

        <div className="proofreading-page__filter-dialog-scroll">
          <div className="proofreading-page__filter-layout">
            <div className="proofreading-page__filter-left-column">
              <section className="proofreading-page__filter-section">
                <div className="proofreading-page__filter-section-head">
                  <h3 className="proofreading-page__filter-section-title">
                    {t('proofreading_page.filter.status_title')}
                  </h3>
                </div>
                <div className="proofreading-page__filter-toggle-grid">
                  {available_statuses.map((status) => {
                    const label_key = PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
                      status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
                    ]
                    return (
                      <FilterToggleButton
                        key={status}
                        label={label_key === undefined ? status : t(label_key)}
                        count={status_count_by_code[status] ?? 0}
                        selected={draft_filters.statuses.includes(status)}
                        onClick={() => {
                          set_draft_filters((previous_filters) => {
                            return {
                              ...previous_filters,
                              statuses: toggle_string(previous_filters.statuses, status),
                            }
                          })
                        }}
                      />
                    )
                  })}
                </div>
              </section>

              <section className="proofreading-page__filter-section">
                <div className="proofreading-page__filter-section-head">
                  <h3 className="proofreading-page__filter-section-title">
                    {t('proofreading_page.result_check_title')}
                  </h3>
                </div>
                <div className="proofreading-page__filter-toggle-grid">
                  {available_warning_types.map((warning) => {
                    const label_key = PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
                      warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
                    ]
                    return (
                      <FilterToggleButton
                        key={warning}
                        label={label_key === undefined ? warning : t(label_key)}
                        count={warning_count_by_code[warning] ?? 0}
                        selected={draft_filters.warning_types.includes(warning)}
                        onClick={() => {
                          set_draft_filters((previous_filters) => {
                            return {
                              ...previous_filters,
                              warning_types: toggle_string(previous_filters.warning_types, warning),
                            }
                          })
                        }}
                      />
                    )
                  })}
                </div>
              </section>

              <section className="proofreading-page__filter-section proofreading-page__filter-section--stretch">
                <div className="proofreading-page__filter-section-head">
                  <h3 className="proofreading-page__filter-section-title">
                    {t('proofreading_page.filter.file_scope')}
                  </h3>
                  <div className="proofreading-page__filter-section-actions">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        set_draft_filters((previous_filters) => {
                          return {
                            ...previous_filters,
                            file_paths: [...available_file_paths],
                          }
                        })
                      }}
                    >
                      {t('proofreading_page.filter.select_all')}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        set_draft_filters((previous_filters) => {
                          return {
                            ...previous_filters,
                            file_paths: [],
                          }
                        })
                      }}
                    >
                      {t('proofreading_page.filter.clear')}
                    </Button>
                  </div>
                </div>

                <Input
                  value={file_keyword}
                  placeholder={t('proofreading_page.filter.search_file')}
                  onChange={(event) => {
                    set_file_keyword(event.target.value)
                  }}
                />

                <ScrollArea className="proofreading-page__filter-list">
                  <div className="proofreading-page__filter-list-body">
                    {visible_file_paths.map((file_path) => (
                      <FilterListRow
                        key={file_path}
                        label={file_path}
                        count={file_count_by_path[file_path] ?? 0}
                        selected={draft_filters.file_paths.includes(file_path)}
                        onClick={() => {
                          set_draft_filters((previous_filters) => {
                            return {
                              ...previous_filters,
                              file_paths: toggle_string(previous_filters.file_paths, file_path),
                            }
                          })
                        }}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </section>
            </div>

            <section className="proofreading-page__filter-section proofreading-page__filter-section--stretch">
              <div className="proofreading-page__filter-section-head">
                <h3 className="proofreading-page__filter-section-title">
                  {t('proofreading_page.filter.glossary_detail')}
                </h3>
                <div className="proofreading-page__filter-section-actions">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={term_count_entries.length === 0}
                    onClick={() => {
                      set_draft_filters((previous_filters) => {
                        return {
                          ...previous_filters,
                          glossary_terms: term_count_entries.map((entry) => entry.term),
                        }
                      })
                    }}
                  >
                    {t('proofreading_page.filter.select_all')}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={term_count_entries.length === 0}
                    onClick={() => {
                      set_draft_filters((previous_filters) => {
                        return {
                          ...previous_filters,
                          glossary_terms: [],
                        }
                      })
                    }}
                  >
                    {t('proofreading_page.filter.clear')}
                  </Button>
                </div>
              </div>

              <Input
                value={term_keyword}
                placeholder={t('proofreading_page.filter.search_term')}
                onChange={(event) => {
                  set_term_keyword(event.target.value)
                }}
              />

              <ScrollArea className="proofreading-page__filter-list proofreading-page__filter-list--terms">
                <div className="proofreading-page__filter-list-body">
                  {visible_term_entries.length > 0
                    ? visible_term_entries.map((entry) => (
                        <FilterListRow
                          key={build_term_key(entry.term)}
                          label={build_term_key(entry.term)}
                          count={entry.count}
                          selected={draft_filters.glossary_terms.some((term) => {
                            return build_term_key(term) === build_term_key(entry.term)
                          })}
                          onClick={() => {
                            set_draft_filters((previous_filters) => {
                              return {
                                ...previous_filters,
                                glossary_terms: toggle_term(previous_filters.glossary_terms, entry.term),
                              }
                            })
                          }}
                        />
                      ))
                    : (
                        <Empty variant="dashed" className="proofreading-page__filter-empty">
                          <EmptyHeader>
                            <EmptyTitle>{t('proofreading_page.filter.no_glossary_error')}</EmptyTitle>
                            <EmptyDescription>{t('proofreading_page.filter.no_glossary_error_description')}</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )}
                </div>
              </ScrollArea>
            </section>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={props.on_close}>
            {t('proofreading_page.action.cancel')}
          </Button>
          <Button type="button" disabled={submitting} onClick={() => { void handle_confirm() }}>
            {t('proofreading_page.action.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
