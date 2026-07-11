/**
 * Locale integrity: every shipped translation must have exactly the same key
 * structure as the English source (no missing keys → no silent English
 * fallbacks in the middle of a translated screen, no stale extra keys).
 */
import ar from '@/lib/i18n/locales/ar.json';
import de from '@/lib/i18n/locales/de.json';
import en from '@/lib/i18n/locales/en.json';
import es from '@/lib/i18n/locales/es.json';
import fa from '@/lib/i18n/locales/fa.json';
import fr from '@/lib/i18n/locales/fr.json';
import pt from '@/lib/i18n/locales/pt.json';

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

const enKeys = flatKeys(en).sort();
const locales: Record<string, Record<string, unknown>> = { es, fr, de, pt, ar, fa };

describe('i18n locale parity', () => {
  it('English has a non-trivial catalog', () => {
    expect(enKeys.length).toBeGreaterThan(50);
  });

  for (const [code, cat] of Object.entries(locales)) {
    it(`${code} matches the English key set exactly`, () => {
      const keys = flatKeys(cat).sort();
      expect(keys).toEqual(enKeys);
    });

    it(`${code} has no empty values`, () => {
      for (const k of flatKeys(cat)) {
        const val = k.split('.').reduce<any>((o, part) => o?.[part], cat);
        expect(typeof val).toBe('string');
        expect(val.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
