import type { POJO, Class } from './types';
import { performance } from 'perf_hooks';
import { CustomError } from 'ts-custom-error';

/**
 * Abstract error
 * Intended for further extension
 */
class AbstractError<T> extends CustomError {
  /**
   * Static description of exception
   */
  public static description: string = '';

  public static fromJSON<T extends Class<any>>(
    this: T,
    json: any,
  ): InstanceType<T> {
    if (
      typeof json !== 'object' ||
      json.type !== this.name ||
      typeof json.data !== 'object' ||
      typeof json.data.message !== 'string' ||
      isNaN(Date.parse(json.data.timestamp)) ||
      typeof json.data.data !== 'object' ||
      !('cause' in json.data) ||
      ('stack' in json.data && typeof json.data.stack !== 'string')
    ) {
      throw new TypeError(`Cannot decode JSON to ${this.name}`);
    }
    const e = new this(json.data.message, {
      timestamp: new Date(json.data.timestamp),
      data: json.data.data,
      cause: json.data.cause,
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
   * May contain microseconds in the fractional part
   * Guaranteed to be weakly monotonic
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
    this.timestamp =
      options.timestamp ?? new Date(performance.timeOrigin + performance.now());
    this.data = options.data ?? {};
    this.cause = options.cause as T;
  }

  public get description(): string {
    return this.constructor['description'];
  }

  public toJSON(): any {
    return {
      type: this.constructor.name,
      data: {
        message: this.message,
        timestamp: this.timestamp,
        data: this.data,
        cause: this.cause,
        stack: this.stack,
      },
    };
  }
}

export default AbstractError;
