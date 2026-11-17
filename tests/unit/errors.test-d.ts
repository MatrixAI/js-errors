import { describe, expectTypeOf, test } from 'vitest';
import { AbstractError } from '#index.js';

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
  });
});
