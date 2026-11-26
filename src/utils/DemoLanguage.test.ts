import { describe, expect, it } from 'vitest';
import { demoLanguageOf } from './DemoLanguage';

describe('DemoLanguage', () => {
  describe(demoLanguageOf, () => {
    it('keeps a demo Italian without guidance', () => {
      expect(demoLanguageOf(null)).toBe('it');
      expect(demoLanguageOf('Ha tre sedi, punta sui trattamenti viso')).toBe('it');
    });

    it('switches to English on "lingua: inglese", however it is written', () => {
      expect(demoLanguageOf('lingua: inglese')).toBe('en');
      expect(demoLanguageOf('Cliente a Malta.\nLingua:Inglese')).toBe('en');
      expect(demoLanguageOf('language: English')).toBe('en');
    });

    it('does not switch on English merely mentioned', () => {
      expect(demoLanguageOf('parla inglese con i clienti')).toBe('it');
    });
  });
});
