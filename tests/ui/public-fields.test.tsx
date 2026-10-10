import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UsernameField } from '@/app/(public)/_lib/fields';

const render = (suggestions: string[]) =>
  renderToStaticMarkup(<UsernameField value="kid.one" onChange={() => {}} suggestions={suggestions} onSuggestions={() => {}} />);

describe('UsernameField', () => {
  it('renders suggestion chips as buttons when the name is taken', () => {
    const html = render(['kid.one1', 'kid.one2']);
    expect(html).toContain('Try one of these:');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>kid\.one1<\/button>/);
    expect(html).toContain('kid.one2');
  });
  it('shows the rules hint and no chips without suggestions', () => {
    const html = render([]);
    expect(html).not.toContain('Try one of these');
    expect(html).toContain('Letters, numbers, _ or . (4–32 characters). Not case-sensitive.');
  });
});
