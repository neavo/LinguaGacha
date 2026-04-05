import type { LocaleKey } from '@/i18n'

type ProjectFormatSupportItem = {
  id: string
  title_key: LocaleKey
  extensions: string
}

export const PROJECT_FORMAT_SUPPORT_ITEMS: ProjectFormatSupportItem[] = [
  {
    id: 'subtitle-bundle',
    title_key: 'common.project.home.formats.subtitle_bundle',
    extensions: '.srt .ass .txt .epub .md',
  },
  {
    id: 'renpy',
    title_key: 'common.project.home.formats.renpy',
    extensions: '.rpy',
  },
  {
    id: 'mtool',
    title_key: 'common.project.home.formats.mtool',
    extensions: '.json',
  },
  {
    id: 'sextractor',
    title_key: 'common.project.home.formats.sextractor',
    extensions: '.txt .json .xlsx',
  },
  {
    id: 'vntextpatch',
    title_key: 'common.project.home.formats.vntextpatch',
    extensions: '.json',
  },
  {
    id: 'trans_project',
    title_key: 'common.project.home.formats.trans_project',
    extensions: '.trans',
  },
  {
    id: 'trans_export',
    title_key: 'common.project.home.formats.trans_export',
    extensions: '.xlsx',
  },
  {
    id: 'wolf',
    title_key: 'common.project.home.formats.wolf',
    extensions: '.xlsx',
  },
]
