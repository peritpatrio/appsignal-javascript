import { ErrorHandler, Injectable } from "@angular/core"

@Injectable()
export class AppsignalErrorHandler extends ErrorHandler {
  private _appsignal: any

  constructor(appsignal: any) {
    super()
    this._appsignal = appsignal
  }

  public handleError(error: any): void {
    const span = this._appsignal.createSpan()

    span.setError(error).setTags({ framework: "Angular" })

    this._appsignal.send(span)

    ErrorHandler.prototype.handleError.call(this, error)
  }
}

export function createErrorHandlerFactory(appsignal: any): Function {
  return function errorHandlerFactory(): AppsignalErrorHandler {
    return new AppsignalErrorHandler(appsignal)
  }
}
