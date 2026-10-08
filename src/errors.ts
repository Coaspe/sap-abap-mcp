export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "AppError"
  }
}

export function tokenPassthroughRefused(): AppError {
  return new AppError("TOKEN_PASSTHROUGH_REFUSED",
    "MCP client tokens cannot be used as SAP Authorization credentials. Configure a BTP Destination exchange/propagation profile or an independently authenticated SAP profile.")
}

export function errorPayload(error: unknown): {
  code: string
  message: string
  details?: Record<string, unknown>
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  }

  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error)
  }
}
