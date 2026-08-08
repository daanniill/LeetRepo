export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export class QuotaError extends HttpError {
  constructor(code, message) {
    super(429, code, message);
    this.name = "QuotaError";
  }
}

