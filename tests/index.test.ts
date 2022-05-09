import type { Class } from '@/types';
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
  test('inheritance', () => {
    // Propagate the cause, allow cause to be generic
    // and the cause is determined by the instantiator
    class ErrorPropagate<T> extends AbstractError<T> {}
    // Fix the cause, so that `SyntaxError` is always the cause
    class ErrorFixed extends AbstractError<SyntaxError> {}
    // Default the cause, but allow instantiator to override
    class ErrorDefault<T = TypeError> extends AbstractError<T> {}
    const eP = new ErrorPropagate<string>(undefined, { cause: 'string' });
    const eF = new ErrorFixed(undefined, { cause: new SyntaxError() });
    const eD = new ErrorDefault<number>(undefined, { cause: 123 });
    expect(eP.cause).toBe('string');
    expect(eF.cause).toBeInstanceOf(SyntaxError);
    expect(eD.cause).toBe(123);
  });
  test('JSON encoding/decoding', () => {
    const e = new AbstractError();
    expect(AbstractError.fromJSON(e.toJSON())).toBeInstanceOf(AbstractError);
    expect(AbstractError.fromJSON(e.toJSON()).toJSON()).toStrictEqual(
      e.toJSON(),
    );
    const eJSON = {
      type: 'AbstractError',
      data: {
        message: 'some message',
        timestamp: '2022-05-07T09:16:06.632Z',
        data: {},
        cause: undefined,
      },
    };
    const e2 = AbstractError.fromJSON(eJSON);
    expect(e2).toBeInstanceOf(AbstractError);
    expect(e2.message).toBe(eJSON.data.message);
    expect(e2.timestamp).toStrictEqual(new Date(eJSON.data.timestamp));
    expect(e2.data).toStrictEqual(eJSON.data.data);
    expect(e2.cause).toStrictEqual(eJSON.data.cause);
  });
  describe('JSON serialiation and deserialisation', () => {
    // Demonstrates an extended error with its own encoding and decoding
    class SpecificError<T> extends AbstractError<T> {
      public static fromJSON<T extends Class<any>>(
        this: T,
        json: any,
      ): InstanceType<T> {
        if (
          typeof json !== 'object' ||
          json.type !== this.name ||
          typeof json.data !== 'object' ||
          typeof json.data.message !== 'string' ||
          typeof json.data.num !== 'number' ||
          ('stack' in json.data && typeof json.data.stack !== 'string')
        ) {
          throw new TypeError(`Cannot decode JSON to ${this.name}`);
        }
        const e = new this(json.data.num, json.data.message);
        e.stack = json.data.stack;
        return e;
      }
      public num: number;
      public constructor(num: number, message: string) {
        super(message);
        this.num = num;
      }
      public toJSON() {
        const obj = super.toJSON();
        obj.data.num = this.num;
        return obj;
      }
    }
    class UnknownError<T> extends AbstractError<T> {}
    // AbstractError classes, these should be part of our application stack
    const customErrors = {
      AbstractError,
      SpecificError,
      UnknownError,
    };
    // Standard JS errors, these do not have fromJSON routines
    const standardErrors = {
      Error,
      TypeError,
      SyntaxError,
      ReferenceError,
      EvalError,
      RangeError,
      URIError,
      AggregateError,
    };
    function replacer(key: string, value: any): any {
      if (value instanceof AggregateError) {
        return {
          type: value.constructor.name,
          data: {
            errors: value.errors,
            message: value.message,
            stack: value.stack,
          },
        };
      } else if (value instanceof Error) {
        return {
          type: value.constructor.name,
          data: {
            message: value.message,
            stack: value.stack,
          },
        };
      } else {
        return value;
      }
    }
    // Assume that the purpose of the reviver is to deserialise JSON string
    // back into exceptions
    // The reviver has 3 choices when encountering an unknown value
    // 1. throw an "parse" exception
    // 2. return the value as it is
    // 3. return as special "unknown" exception that contains the unknown value as data
    // Choice 1. results in strict deserialisation procedure (no forwards-compatibility)
    // Choice 2. results in ambiguous parsed result
    // Choice 3. is the best option as it ensures a typed-result and debuggability of ambiguous data
    function reviver(key: string, value: any): any {
      if (
        typeof value === 'object' &&
        typeof value.type === 'string' &&
        typeof value.data === 'object'
      ) {
        try {
          let eClass = customErrors[value.type];
          if (eClass != null) return eClass.fromJSON(value);
          eClass = standardErrors[value.type];
          if (eClass != null) {
            let e;
            switch (eClass) {
              case AggregateError:
                if (
                  !Array.isArray(value.data.errors) ||
                  typeof value.data.message !== 'string' ||
                  ('stack' in value.data &&
                    typeof value.data.stack !== 'string')
                ) {
                  throw new TypeError(`Cannot decode JSON to ${value.type}`);
                }
                e = new eClass(value.data.errors, value.data.message);
                e.stack = value.data.stack;
                break;
              default:
                if (
                  typeof value.data.message !== 'string' ||
                  ('stack' in value.data &&
                    typeof value.data.stack !== 'string')
                ) {
                  throw new TypeError(`Cannot decode JSON to ${value.type}`);
                }
                e = new eClass(value.data.message);
                e.stack = value.data.stack;
                break;
            }
            return e;
          }
        } catch (e) {
          // If `TypeError` which represents decoding failure
          // then return value as-is
          // Any other exception is a bug
          if (!(e instanceof TypeError)) {
            throw e;
          }
        }
        // Other values are returned as-is
        return value;
      } else if (key === '') {
        // Root key will be ''
        // Reaching here means the root JSON value is not a valid exception
        // Therefore UnknownError is only ever returned at the top-level
        return new UnknownError('Unknown error JSON', {
          data: {
            json: value,
          },
        });
      } else {
        // Other values will be returned as-is
        return value;
      }
    }
    test('abstract on specific', () => {
      const e = new AbstractError('msg1', {
        cause: new SpecificError(123, 'msg2'),
      });
      const eJSONString = JSON.stringify(e, replacer);
      const e_ = JSON.parse(eJSONString, reviver);
      expect(e_).toBeInstanceOf(AbstractError);
      expect(e_.message).toBe(e.message);
      expect(e_.cause).toBeInstanceOf(SpecificError);
      expect(e_.cause.message).toBe(e.cause.message);
    });
    test('abstract on abstract on range', () => {
      const e = new AbstractError('msg1', {
        cause: new AbstractError('msg2', {
          cause: new RangeError('msg3'),
        }),
      });
      const eJSONString = JSON.stringify(e, replacer);
      const e_ = JSON.parse(eJSONString, reviver);
      expect(e_).toBeInstanceOf(AbstractError);
      expect(e_.message).toBe(e.message);
      expect(e_.cause).toBeInstanceOf(AbstractError);
      expect(e_.cause.message).toBe(e.cause.message);
      expect(e_.cause.cause).toBeInstanceOf(RangeError);
      expect(e_.cause.cause.message).toBe(e.cause.cause.message);
    });
    test('abstract on something random', () => {
      const e = new AbstractError('msg1', {
        cause: 'something random',
      });
      const eJSONString = JSON.stringify(e, replacer);
      const e_ = JSON.parse(eJSONString, reviver);
      expect(e_).toBeInstanceOf(AbstractError);
      expect(e_.message).toBe(e.message);
      expect(e_.cause).toBe('something random');
    });
    test('unknown at root', () => {
      const e = '123';
      const eJSONString = JSON.stringify(e, replacer);
      const e_ = JSON.parse(eJSONString, reviver);
      expect(e_).toBeInstanceOf(UnknownError);
    });
    test('unknown not at root is returned as-is', () => {
      const e = new AbstractError('msg1', {
        cause: new AggregateError([
          // This will look like an `AbstractError`, but will cause decoding failure
          // which means it should be returned as-is
          {
            type: 'AbstractError',
            data: {},
          },
          // This will look like an `Error`
          {
            type: 'Error',
            data: {
              message: 'msg2',
            },
          },
        ]),
      });
      const eJSONString = JSON.stringify(e, replacer);
      const e_ = JSON.parse(eJSONString, reviver);
      expect(e_).toBeInstanceOf(AbstractError);
      expect(e_.cause).toBeInstanceOf(AggregateError);
      expect(e_.cause.errors[0]).not.toBeInstanceOf(AbstractError);
      expect(e_.cause.errors[0]).toStrictEqual(e.cause.errors[0]);
      expect(e_.cause.errors[1]).toBeInstanceOf(Error);
    });
  });
});
