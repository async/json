export type JsonDbErrorOptions = {
  status?: number;
  hint?: string;
  details?: unknown;
};

export class JsonDbError extends Error {
  code: string;
  status?: number;
  hint?: string;
  details?: unknown;

  constructor(code: string, message: string, options: JsonDbErrorOptions = {}) {
    super(message);
    this.name = 'JsonDbError';
    this.code = code;
    this.status = options.status;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export function jsonDbError(code: string, message: string, options: JsonDbErrorOptions = {}): JsonDbError {
  return new JsonDbError(code, message, options);
}
