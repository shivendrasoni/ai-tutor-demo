import { genericMessage, type ApiError } from './api';

/** Friendly copy for a bad or disabled signup code (shown at lookup and on submit); undefined for other codes. */
export function codeCopy(code: string): string | undefined {
  if (code === 'INVALID_CODE') return "That signup code isn't valid. Check it and try again.";
  if (code === 'CODE_DISABLED') return 'Signups with this code are turned off. Ask your school.';
  return undefined;
}

/** Copy for a failed signup/invite submit, plus any username suggestions the server attached. */
export function submitError(e: ApiError): { message: string; suggestions: string[] } {
  const raw = e.details?.suggestions;
  const suggestions = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  switch (e.code) {
    case 'USERNAME_TAKEN':
      return { message: 'That username is taken. Pick another or choose one of the suggestions.', suggestions };
    case 'INVALID_CODE':
    case 'CODE_DISABLED':
      return { message: codeCopy(e.code)!, suggestions: [] };
    case 'INVALID_USERNAME':
    case 'WEAK_PASSWORD':
    case 'VALIDATION':
      return { message: e.message || genericMessage(e), suggestions };
    default:
      return { message: genericMessage(e), suggestions: [] };
  }
}
