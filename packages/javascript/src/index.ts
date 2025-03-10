/**
 * The AppSignal client.
 * @module Appsignal
 */

import { compose, toHashMap } from "@appsignal/core"
import { Breadcrumb } from "@appsignal/types"

import { VERSION } from "./version"
import { PushApi } from "./api"
import { Environment } from "./environment"
import { Span } from "./span"
import { Queue } from "./queue"
import { Dispatcher } from "./dispatcher"

import { Hook } from "./interfaces/hook"
import { AppsignalOptions } from "./types/options"

export default class Appsignal {
  public VERSION = VERSION

  public ignored: RegExp[]

  private _dispatcher: Dispatcher
  private _options: AppsignalOptions
  private _api: PushApi
  private _breadcrumbs: Breadcrumb[]

  private _hooks = {
    decorators: Array<Hook>(),
    overrides: Array<Hook>()
  }

  private _env = Environment.serialize()
  private _queue = new Queue([])

  /**
   * Creates a new instance of the AppSignal client.
   *
   * @constructor
   *
   * @param   {AppsignalOptions}  options        An object of options to configure the AppSignal client
   */
  constructor(options: AppsignalOptions) {
    const { key = "", uri, revision } = options

    // `revision` should be a `string`, but we attempt to
    // normalise to one anyway
    if (revision && typeof revision !== "string") {
      options.revision = String(revision)
    }

    // starting with no key means nothing will be sent to the API
    if (key === "") {
      console.info("[APPSIGNAL]: Started in development mode.")
    }

    this._api = new PushApi({
      key,
      uri,
      version: this.VERSION
    })

    // ignored exeptions are checked against the `message`
    // property of a given `Error`
    this.ignored = options.ignoreErrors || []

    this._breadcrumbs = []
    this._dispatcher = new Dispatcher(this._queue, this._api)

    this._options = options
  }

  /**
   * Records and sends a browser `Error` to AppSignal.
   *
   * @param   {Error}             error          A JavaScript Error object
   * @param   {object}            tags           An key, value object of tags
   * @param   {string}            namespace      An optional namespace name
   *
   * @return  {Promise<Span> | void}             An API response, or `void` if `Promise` is unsupported.
   */
  public send(
    error: Error,
    tags?: object,
    namespace?: string
  ): Promise<Span> | void

  /**
   * Records and sends an Appsignal `Span` object to AppSignal.
   *
   * @param   {Error}             error          A JavaScript Error object
   *
   * @return  {Promise<Span>}                    An API response, or `void` if `Promise` is unsupported.
   */
  public send(span: Span): Promise<Span> | void

  /**
   *
   * @param   {Error | Span}      data           A JavaScript Error or Appsignal Span object
   * @param   {object}            tags           An key, value object of tags
   * @param   {string}            namespace      An optional namespace name
   *
   * @return  {Promise<Span> | void}             An API response, or `void` if `Promise` is unsupported.
   */
  public send(
    data: Error | Span,
    tags = {},
    namespace?: string
  ): Promise<any> | void {
    if (!(data instanceof Error) && !(data instanceof Span)) {
      // @TODO: route this through a central logger
      console.error(
        "[APPSIGNAL]: Can't send error, given error is not a valid type"
      )
      return
    }

    // handle user defined ignores
    if (this.ignored.length !== 0) {
      if (
        data instanceof Error &&
        this.ignored.some(el => el.test(data.message))
      ) {
        console.warn(`[APPSIGNAL]: Ignored an error: ${data.message}`)
        return
      }

      if (data instanceof Span) {
        const { error } = data.serialize()

        // using the bang operator here as tsc doesnt recognise that we are
        // checking for the value to be set as the first predicate
        if (error.message && this.ignored.some(el => el.test(error.message!))) {
          console.warn(`[APPSIGNAL]: Ignored a span: ${error.message}`)
          return
        }
      }
    }

    // a "span" currently refers to a fixed point in time, as opposed to
    // a range or length in time. this may change in future!
    const span = data instanceof Span ? data : this._createSpanFromError(data)

    // A Span can be "decorated" with metadata after it has been created,
    // but before it is sent to the API and before metadata provided
    // as arguments is added
    if (this._hooks.decorators.length > 0) {
      compose(...this._hooks.decorators)(span)
    }

    if (tags) span.setTags(tags)
    if (namespace) span.setNamespace(namespace)
    if (this._breadcrumbs.length > 0) span.setBreadcrumbs(this._breadcrumbs)

    // A Span can be "overridden" with metadata after it has been created,
    // but before it is sent to the API and after metadata provided
    // as arguments is added
    if (this._hooks.overrides.length > 0) {
      compose(...this._hooks.overrides)(span)
    }

    if (Environment.supportsPromises()) {
      // clear breadcrumbs as they are now loaded into the span,
      // and we are sure that it's possible to send them
      this._breadcrumbs = []

      // if no key is supplied, we just output the span to the console
      // and rethrow the error
      if (!this._options.key) {
        // @TODO: route this through a central logger
        console.warn(
          "[APPSIGNAL]: Span not sent because we're in development mode:",
          span
        )

        if (data instanceof Error) {
          throw data
        }
      } else {
        // attempt to push to the API
        return this._api.push(span).catch(() => {
          this._queue.push(span)

          // schedule on next tick
          setTimeout(() => this._dispatcher.schedule(), 0)
        })
      }
    } else {
      // @TODO: route this through a central logger
      console.error(
        "[APPSIGNAL]: Error not sent. A Promise polyfill is required."
      )
      return
    }
  }

  /**
   * Records and sends a browser `Error` to AppSignal. An alias to `#send()`
   * to maintain compatibility.
   *
   * @param   {Error}             error          A JavaScript Error object
   * @param   {object}            tags           An key, value object of tags
   * @param   {string}            namespace      An optional namespace name
   *
   * @return  {Promise<Span> | void}             An API response, or `void` if `Promise` is unsupported.
   */
  public sendError(
    error: Error,
    tags?: object,
    namespace?: string
  ): Promise<Span> | void {
    return this.send(error, tags, namespace)
  }

  /**
   * Registers and installs a valid plugin.
   *
   * A plugin is typically a function that can be used to provide a
   * reference to the `Appsignal` instance via returning a function
   * that can be bound to `this`.
   *
   * @param   {Plugin}            plugin         A JavaScript Error object
   *
   * @return  {void}
   */
  public use(plugin: Function): void {
    plugin.call(this)
  }

  /**
   * Creates a new `Span`, augmented with the current environment.
   *
   * @param   {Function | void}   fn         Optional function to modify span
   *
   * @return  {Span}              An AppSignal `Span` object
   */
  public createSpan(fn?: Function): Span {
    const { revision = "", namespace } = this._options

    const span = new Span({
      environment: this._env,
      revision
    })

    // set default namespace from constructor if none is set
    if (namespace) span.setNamespace(namespace)

    if (fn && typeof fn === "function") fn(span)

    return span
  }

  /**
   * Wraps and catches errors within a given function. If the function throws an
   * error, a rejected `Promise` will be returned and the error thrown will be
   * logged to AppSignal.
   *
   * @param   {Function}          fn             A function to wrap
   * @param   {object}            tags           An key, value object of tags
   * @param   {string}            namespace      An optional namespace name
   *
   * @return  {Promise<any>}      A Promise containing the return value of the function, or a `Span` if an error was thrown.
   */
  public async wrap(fn: Function, tags = {}, namespace?: string): Promise<any> {
    try {
      return await fn()
    } catch (e) {
      await this.sendError(e, tags, namespace)
      return Promise.reject(e)
    }
  }

  /**
   * Registers a span decorator to be applied every time a Span
   * is sent to the Push API
   *
   * @param   {Function}  decorator  A decorator function, returning `Span`
   *
   * @return  {void}
   */
  public addDecorator<T extends Hook>(decorator: T): void {
    this._hooks.decorators.push(decorator)
  }

  /**
   * Registers a span override to be applied every time a Span
   * is sent to the Push API
   *
   * @param   {Function}  override  An override function, returning `Span`
   *
   * @return  {void}
   */
  public addOverride<T extends Hook>(override: T): void {
    this._hooks.overrides.push(override)
  }

  /**
   * Sends a demonstration error to AppSignal.
   *
   * @return  {void}
   */
  public demo(): void {
    const span = this._createSpanFromError(
      new Error(
        "Hello world! This is an error used for demonstration purposes."
      )
    )

    span
      .setAction("TestAction")
      .setParams({
        path: "/hello",
        method: "GET"
      })
      .setTags({
        demo_sample: "true"
      })

    this.send(span)
  }

  /**
   * Adds a breadcrumb.
   *
   * @param   {Breadcrumb}  breadcrumb  A valid breadcrumb
   *
   * @return  {void}
   */
  public addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
    const crumb: Breadcrumb = {
      timestamp: Math.round(new Date().getTime() / 1000),
      ...breadcrumb,
      metadata: toHashMap(breadcrumb.metadata)
    }

    if (!crumb.category) {
      console.warn("[APPSIGNAL]: Breadcrumb not added. `category` is missing.")
      return
    }

    if (!crumb.action) {
      console.warn("[APPSIGNAL]: Breadcrumb not added. `action` is missing.")
      return
    }

    if (this._breadcrumbs.length === 20) {
      this._breadcrumbs.pop()
    }

    this._breadcrumbs.unshift(crumb)
  }

  /**
   * Creates a valid AppSignal `Span` from a JavaScript `Error`
   * object.
   *
   * @param   {Error}  error  A JavaScript error
   *
   * @return  {Span}         An AppSignal event
   */
  private _createSpanFromError(error: Error): Span {
    const event = this.createSpan()
    event.setError(error)

    return event
  }
}
