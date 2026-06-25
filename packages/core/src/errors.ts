export class ClawchatError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ClawchatError";
    this.code = code;
  }
}
