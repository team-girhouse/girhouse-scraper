/** The languages a demo can be written in. Italian unless the team asks otherwise. */
export type DemoLanguage = 'it' | 'en';

/** "lingua: inglese" (or "language: english") in the demo guidance switches it to English. */
const ENGLISH_SWITCH = /\b(?:lingua|language)\s*:\s*(?:inglese|english)\b/iu;

/**
 * Reads the language a demo is written in from the team's guidance, for the rare lead abroad.
 * @param guidance What the team wrote for the demo, if anything.
 * @returns English when the guidance asks for it, else Italian.
 */
export const demoLanguageOf = (guidance: string | null | undefined): DemoLanguage =>
  guidance && ENGLISH_SWITCH.test(guidance) ? 'en' : 'it';

/**
 * Added after the writing instructions of an English demo. The instructions stay Italian-minded
 * (and their examples Italian) because nearly every demo is Italian; this overrides the language.
 */
export const ENGLISH_DEMO_INSTRUCTIONS = [
  '',
  '# Language: English',
  'This demo is for a business outside Italy, so ignore every rule above that says to write in Italian:',
  '- Write every text in natural, plain English, keeping the same tone and the same rules. The Italian examples above only show the tone: never copy them, write the English a native speaker would.',
  '- Use the familiar "you" throughout, as the rules ask for "tu".',
  '- Invented customers get common first names of the country the business is in, not Italian ones. Places, people and settings fit that country, never Italy.',
  '- Keep the business name exactly as written.',
].join('\n');
