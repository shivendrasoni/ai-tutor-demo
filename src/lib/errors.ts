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
  | 'STUDENT_REMOVED'
  | 'RATE_LIMITED'
  | 'ATTEMPT_EXPIRED'
  | 'BUDGET_EXCEEDED'
  | 'GENERATION_LIMIT'
  | 'TUTOR_BUSY';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}
