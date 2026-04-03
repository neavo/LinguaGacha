export type PlaceholderLineWidth = 'wide' | 'medium' | 'thin'

export type PlaceholderCardTone = 'default' | 'accent'

export type PlaceholderCard = {
  id: string
  tone: PlaceholderCardTone
}

export type PageScaffoldMock = {
  hero_line_widths: PlaceholderLineWidth[]
  cards: PlaceholderCard[]
}

type CreatePageScaffoldMockOptions = {
  card_count: number
  accent_card_indices?: number[]
}

export function create_page_scaffold_mock(
  options: CreatePageScaffoldMockOptions,
): PageScaffoldMock {
  const accent_card_index_set: ReadonlySet<number> = new Set(options.accent_card_indices ?? [])
  const cards: PlaceholderCard[] = []

  for (let card_index = 0; card_index < options.card_count; card_index += 1) {
    cards.push({
      id: `card-${card_index + 1}`,
      tone: accent_card_index_set.has(card_index) ? 'accent' : 'default',
    })
  }

  return {
    hero_line_widths: ['wide', 'medium', 'thin'],
    cards,
  }
}
