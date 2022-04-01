import { AbstractError } from '@';

describe('index', () => {
  test('properties', () => {
    try {
      throw new AbstractError();
    } catch (e) {
      expect(e).toBeInstanceOf(AbstractError);
      expect(e.name).toBe(AbstractError.name);
      expect(e.description).toBe('');
      expect(e.data).toStrictEqual({});
      expect(e.cause).toBeUndefined();
      expect(e.timestamp).toBeInstanceOf(Date);
      expect(e.stack).toBeDefined();
      expect(Date.now() > e.timestamp).toBe(true);
    }
    try {
      throw new AbstractError(undefined, {
        data: {
          foo: 'bar',
        },
        cause: new Error(),
      });
    } catch (e) {
      expect(e.data).toStrictEqual({ foo: 'bar' });
      expect(e.cause).toBeInstanceOf(Error);
    }
  });
  test('extending', () => {
    class ErrorProgram<T = void> extends AbstractError<T> {
      public static description = 'static description';
    }
    try {
      throw new ErrorProgram('dynamic message');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorProgram);
      expect(e.message).toBe('dynamic message');
      expect(e.description).toBe('static description');
      expect(e.timestamp).toBeInstanceOf(Date);
    }
  });
  test('causation chain', () => {
    const eOriginal = new Error('cause');
    try {
      try {
        throw eOriginal;
      } catch (e) {
        const e_ = new AbstractError(undefined, { cause: e as Error });
        expect(e_.cause).toBeInstanceOf(Error);
        expect(e_.cause).toBe(eOriginal);
        expect(e_.cause.message).toBe('cause');
        throw e_;
      }
    } catch (e) {
      expect(e.cause).toBe(eOriginal);
    }
  });
});
