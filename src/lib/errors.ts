export type ErrorCode =
  | 'INVALID_CODE'
  | 'CODE_DISABLED'
  | 'USERNAME_TAKEN'
  | 'INVALID_USERNAME'
  | 'WEAK_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_REMOVED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'INVITE_INVALID'
  | 'STUDENT_REMOVED';

export class DomainError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
