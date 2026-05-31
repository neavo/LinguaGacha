export type TranslationPromptInput = {
  speaker: string | null;
  text: string;
};

export type DecodedTranslationLine = {
  speaker_translation: string | null;
  text: string;
};
