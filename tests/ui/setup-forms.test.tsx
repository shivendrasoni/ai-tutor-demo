import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseSetupError, SetupFormError } from '@/app/(staff)/school/_components/SetupForms';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

describe('setup form errors', () => {
  const body409 = {
    error: { code: 'USERNAME_TAKEN', message: 'That username is taken', details: { suggestions: ['new_teacher2', 'new_teacher_1'] } },
  };
  it('parseSetupError keeps the message and the string suggestions of a 409 body', () => {
    expect(parseSetupError(body409)).toEqual({ message: 'That username is taken', suggestions: ['new_teacher2', 'new_teacher_1'] });
  });
  it('parseSetupError falls back for malformed bodies and ignores non-string suggestions', () => {
    expect(parseSetupError(null)).toEqual({ message: 'Could not save', suggestions: [] });
    expect(parseSetupError({ error: { message: 'x', details: { suggestions: [1, 'ok', null] } } })).toEqual({ message: 'x', suggestions: ['ok'] });
  });
  it('SetupFormError renders the message and one button per suggestion', () => {
    const html = renderToStaticMarkup(<SetupFormError error={parseSetupError(body409)} onPick={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('That username is taken');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>new_teacher2<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>new_teacher_1<\/button>/);
  });
  it('SetupFormError renders no buttons without suggestions', () => {
    const html = renderToStaticMarkup(<SetupFormError error={{ message: 'Nope', suggestions: [] }} onPick={() => {}} />);
    expect(html).toContain('Nope');
    expect(html).not.toContain('<button');
  });
});
