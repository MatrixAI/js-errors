import type { POJO } from './types';
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
}

export default AbstractError;
