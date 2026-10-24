/** Errors that services throw on purpose. Their messages are safe to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "LIMIT",
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, "NOT_FOUND");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") {
    super(message, "FORBIDDEN");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, "VALIDATION", fieldErrors);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}
