export interface MessagingErrorOptions {
  status?: number;
  /** Código numérico del proveedor (ej. 190 = token vencido, 131047 = ventana de 24h cerrada). */
  code?: number;
  subcode?: number;
  /** Id de traza del proveedor — es lo primero que pide su soporte ante un problema. */
  traceId?: string;
  /**
   * Si tiene sentido reintentar el MISMO envío. Un token vencido o una ventana
   * de 24h cerrada no se arreglan reintentando — hacerlo igual gasta los
   * reintentos de sendTextWithRetry (ver conversation/handleIncomingMessage.ts)
   * y ensucia el log sin cambiar el resultado. Ver cloudApi/errorCodes.ts.
   */
  retryable: boolean;
  cause?: unknown;
}

/** Error tipado para cualquier falla al hablar con un MessagingProvider. */
export class MessagingError extends Error {
  public readonly status?: number;
  public readonly code?: number;
  public readonly subcode?: number;
  public readonly traceId?: string;
  public readonly retryable: boolean;
  public override readonly cause?: unknown;

  constructor(message: string, options: MessagingErrorOptions) {
    super(message);
    this.name = "MessagingError";
    this.status = options.status;
    this.code = options.code;
    this.subcode = options.subcode;
    this.traceId = options.traceId;
    this.retryable = options.retryable;
    this.cause = options.cause;
  }
}
