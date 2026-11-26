import type { POJO, Class, GraphErrorDecoder } from './types.js';
import { CustomError } from 'ts-custom-error';
import { timestampNow } from './clock.js';
import { decodeErrorGraph, encodeErrorGraph } from './utils.js';

/**
 * Abstract error
 * Intended for further extension
 */
class AbstractError<T> extends CustomError {
  /**
   * Static description of exception
   */
  public static description: string = '';

  /**
   * Reconstruct this class from its serialized error record. By default the
   * cause decoder recognizes this class, AbstractError, and supported native
   * errors. Supply a cause decoder for other registered classes or an
   * application-specific representation. It converts only the cause: callers
   * must validate the complete record and apply their own trust policy. A custom
   * decoder must enforce any cycle and depth limits it needs. Overrides with
   * custom constructors must use the supplied callback for their cause.
   */
  public static fromJSON<T extends Class<any>>(
    this: T,
    json: any,
    decodeCause: (value: unknown) => unknown = (cause) =>
      decodeErrorGraph(cause, {
        decoders: [this as unknown as GraphErrorDecoder],
      }),
  ): InstanceType<T> {
    if (
      typeof json !== 'object' ||
      json.type !== this.name ||
      typeof json.data !== 'object' ||
      typeof json.data.message !== 'string' ||
      isNaN(Date.parse(json.data.timestamp)) ||
      typeof json.data.data !== 'object' ||
      (json.data.stack !== undefined && typeof json.data.stack !== 'string')
    ) {
      throw new TypeError(`Cannot decode JSON to ${this.name}`);
    }
    const cause = json.data.cause;
    const e = new this(json.data.message, {
      timestamp: new Date(json.data.timestamp),
      data: json.data.data,
      cause: cause === undefined ? undefined : decodeCause(cause),
    });
    e.stack = json.data.stack;
    return e;
  }

  /**
   * Arbitrary data
   */
  public data: POJO;

  /**
   * Causation of the exception
   * Can be used to know what caused this exception
   */
  public cause: T;

  /**
   * Timestamp when exception was constructed in milliseconds
   * Generated timestamps are weakly monotonic within this module instance.
   * Explicit timestamps are preserved without affecting the generated clock.
   */
  public timestamp: Date;

  public constructor(
    message: string = '',
    options: {
      timestamp?: Date;
      data?: POJO;
      cause?: T;
    } = {},
  ) {
    super(message);
    this.timestamp = options.timestamp ?? new Date(timestampNow());
    this.data = options.data ?? {};
    this.cause = options.cause as T;
  }

  public get description(): string {
    return this.constructor['description'];
  }

  /**
   * Create this error's class-directed record. By default the cause encoder
   * converts supported error graphs; supply a callback when the cause requires a
   * different representation. It converts only the cause and does not redact
   * this error's message, stack, timestamp, or data. A custom encoder must enforce
   * any cycle and depth limits it needs. Overrides must forward the callback to
   * super so graph traversal shares the caller's cycle and depth context.
   * JSON.stringify supplies the first argument as a string key; to use a custom
   * callback, call this method explicitly before stringifying its result.
   */
  public toJSON(
    _key?: string,
    encodeCause: (value: unknown) => unknown = (cause) =>
      encodeErrorGraph(cause, {}, new Set([this])),
  ): any {
    const cause = this.cause;
    return {
      type: this.constructor.name,
      description: this.description,
      data: {
        message: this.message,
        timestamp: this.timestamp,
        data: this.data,
        cause: cause === undefined ? undefined : encodeCause(cause),
        stack: this.stack,
      },
    };
  }
}

export default AbstractError;
