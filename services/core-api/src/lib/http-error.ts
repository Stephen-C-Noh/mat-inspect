export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = 'HttpError';
  }
}

export const httpError = (status: number, code: string, detail: string): HttpError =>
  new HttpError(status, code, detail);
