import { genericMessage, type ApiError } from './api';

/** Copy for a failed signup/invite submit, plus any username suggestions the server attached. */
export function submitError(e: ApiError): { message: string; suggestions: string[] } {
  const raw = e.details?.suggestions;
  const suggestions = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  switch (e.code) {
    case 'USERNAME_TAKEN':
      return { message: 'That username is taken. Pick another or choose one of the suggestions.', suggestions };
    case 'INVALID_USERNAME':
    case 'WEAK_PASSWORD':
    case 'VALIDATION':
    case 'INVALID_CODE':
    case 'CODE_DISABLED':
      return { message: e.message || genericMessage(e), suggestions };
    default:
      return { message: genericMessage(e), suggestions: [] };
  }
}
