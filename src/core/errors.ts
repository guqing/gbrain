export type BrainErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_SLUG'
  | 'DB_ERROR'
  | 'EMBED_ERROR'
  | 'LLM_ERROR'
  | 'CONFIG_ERROR'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR';

export class BrainError extends Error {
  readonly code: BrainErrorCode;

  constructor(code: BrainErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'BrainError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}
