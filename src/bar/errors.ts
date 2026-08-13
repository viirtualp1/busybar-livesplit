/** The generated client rejects with a plain body object, not an Error. */
export class BarApiError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status: number | undefined, body: unknown) {
    super(message);
    this.name = 'BarApiError';
    this.status = status;
    this.body = body;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toBarError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  const status = statusOf(value);
  const detail = bodyError(value) || errorMessage(value);
  return new BarApiError(
    status ? `BUSY Bar responded ${status}: ${detail}` : detail,
    Number.isNaN(status) ? undefined : status,
    value,
  );
}

function statusOf(error: unknown): number {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return Number.NaN;
  }
  return Number(error.status);
}

function bodyError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  if ('error' in error && typeof error.error === 'string') {
    return error.error;
  }
  if (!('body' in error) || !error.body || typeof error.body !== 'object') {
    return '';
  }
  const body = error.body;
  return 'error' in body ? String(body.error) : '';
}

/** The Bar refuses draws while a higher-priority app owns the screen. */
export function isLowPriority(error: unknown): boolean {
  return (
    statusOf(error) === 409 ||
    /low priority/i.test(errorMessage(error)) ||
    /low priority/i.test(bodyError(error))
  );
}

export function isClientError(error: unknown): boolean {
  const status = statusOf(error);
  return status >= 400 && status < 500;
}

export function isForbidden(error: unknown): boolean {
  return statusOf(error) === 403 || /forbidden/i.test(errorMessage(error));
}
