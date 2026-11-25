import type { GraphErrorEntry, GraphErrorDecoderOptions } from '#index.js';
import { describe, expectTypeOf, test } from 'vitest';
import { AbstractError, utils } from '#index.js';

describe('error declarations', () => {
  test('preserves the declared cause type', () => {
    const error = new AbstractError<RangeError>('failure', {
      cause: new RangeError('cause'),
    });
    expectTypeOf(error.cause).toEqualTypeOf<RangeError>();
    expectTypeOf(error.timestamp).toEqualTypeOf<Date>();
    // @ts-expect-error A cause must match the declared type.
    new AbstractError<RangeError>('failure', { cause: 'wrong' });
  });

  test('JSON decoding retains the selected subclass type', () => {
    class DomainError extends AbstractError<Error> {}
    expectTypeOf(DomainError.fromJSON({})).toEqualTypeOf<DomainError>();
    const error = new DomainError();
    error.toJSON(undefined, (cause) => cause);
    expectTypeOf(
      DomainError.fromJSON({}, (cause) => cause),
    ).toEqualTypeOf<DomainError>();
    // @ts-expect-error The cause graph encoder must be a function.
    error.toJSON(undefined, 'not a callback');
    // @ts-expect-error The cause graph decoder must be a function.
    DomainError.fromJSON({}, 'not a callback');
  });

  test('graph helpers expose typed relations and unknown decoded values', () => {
    class DomainError extends AbstractError<Error> {}
    const options: GraphErrorDecoderOptions = {
      decoders: [DomainError],
      maxDepth: 3,
    };
    expectTypeOf(utils.walkErrorGraph(new Error())).toEqualTypeOf<
      Generator<GraphErrorEntry>
    >();
    expectTypeOf(
      utils.encodeErrorGraph(new DomainError(), { maxDepth: 3 }),
    ).toBeUnknown();
    expectTypeOf(utils.decodeErrorGraph({}, options)).toBeUnknown();
    // @ts-expect-error Decoder registrations are not encoding options.
    utils.encodeErrorGraph(new DomainError(), { decoders: [DomainError] });
    // @ts-expect-error Graph depth is a number, not a string.
    utils.walkErrorGraph(new Error(), { maxDepth: '3' });
  });
});
