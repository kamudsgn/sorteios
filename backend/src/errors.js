/** Erro de aplicação com código estável, mensagem para o usuário e dica opcional. */
export class AppError extends Error {
  constructor(code, message, { status = 400, hint, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.hint = hint;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}

export function toErrorBody(err) {
  if (err instanceof AppError) return { error: err.toJSON() };
  return { error: { code: 'INTERNAL', message: 'Erro interno inesperado. Tente novamente.' } };
}
