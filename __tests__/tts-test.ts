/**
 * markdownToSpeech: assistant replies are markdown, but the synthesizer should
 * read prose — not backticks, pipes, or list bullets. Pure string transform, no
 * native deps.
 */
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('@/lib/i18n', () => ({ currentLanguage: () => 'en' }));

import { markdownToSpeech } from '@/lib/tts';

describe('markdownToSpeech', () => {
  it('strips fenced and inline code', () => {
    expect(markdownToSpeech('Run ```js\nconst x=1\n``` now')).toBe('Run now');
    expect(markdownToSpeech('use `npm test` here')).toBe('use npm test here');
  });

  it('keeps link text, drops the url and image', () => {
    expect(markdownToSpeech('See [the docs](https://x.com) and ![alt](img.png).')).toBe(
      'See the docs and .',
    );
  });

  it('removes heading, list, and blockquote markers', () => {
    expect(markdownToSpeech('# Title\n\n- one\n- two\n> quote')).toBe('Title one two quote');
  });

  it('unwraps emphasis and collapses whitespace', () => {
    expect(markdownToSpeech('**bold** and _italic_   spaced')).toBe('bold and italic spaced');
  });

  it('returns empty for a code-only block', () => {
    expect(markdownToSpeech('```\njust code\n```')).toBe('');
  });
});
