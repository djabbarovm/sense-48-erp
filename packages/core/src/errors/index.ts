/** Доменные ошибки. HTTP-слой мапит: NotFound→404, PermissionDenied→403, Validation→400, IllegalTransition→409. */

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class PermissionDeniedError extends Error {
  readonly code: string;
  constructor(permission: string) {
    super(`PERMISSION_DENIED:${permission}`);
    this.name = 'PermissionDeniedError';
    this.code = `PERMISSION_DENIED:${permission}`;
  }
}

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  constructor(objectType: string, from: string, to: string) {
    super(`Illegal transition ${objectType}: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class SodViolationError extends Error {
  readonly code = 'SOD_VIOLATION';
  constructor(message = 'Segregation of duties violation (BR-040)') {
    super(message);
    this.name = 'SodViolationError';
  }
}
