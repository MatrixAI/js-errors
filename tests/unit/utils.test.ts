import type { GraphErrorDecoderOptions } from '#types.js';
import { describe, expect, test, vi } from 'vitest';
import { AbstractError, utils } from '#index.js';

describe('error graph inspection', () => {
  test('distinguishes causes, aggregate membership, suppression, and sharing', () => {
    const shared = new Error('shared');
    const aggregate = new AggregateError([shared, shared]);
    const cleanup = new Error('cleanup');
    const suppressed = new SuppressedError(
      cleanup,
      aggregate,
      'cleanup failed',
    );
    const root = new Error('root', { cause: suppressed });
    const entries = [...utils.walkErrorGraph(root)];
    expect(entries.map((entry) => entry.relation?.kind)).toEqual([
      undefined,
      'cause',
      'error',
      'suppressed',
      'aggregate',
      'aggregate',
    ]);
    expect(entries[4].relation).toEqual({ kind: 'aggregate', index: 0 });
    expect(entries[5].relation).toEqual({ kind: 'aggregate', index: 1 });
    expect(entries[5]).toMatchObject({
      value: shared,
      repeated: true,
      circular: false,
    });
    expect(entries.some((entry) => entry.value === cleanup)).toBe(true);
  });

  test('reports cycles, not repeated primitive values', () => {
    const root = new AggregateError([7, 7]);
    root.cause = root;
    const entries = [...utils.walkErrorGraph(root)];
    expect(entries[1]).toMatchObject({
      value: root,
      repeated: true,
      circular: true,
    });
    expect(entries[2]).toMatchObject({
      value: 7,
      repeated: false,
      circular: false,
    });
    expect(entries[3]).toMatchObject({
      value: 7,
      repeated: false,
      circular: false,
    });
  });

  test('does not inspect unrequested descendants or diagnostic fields', () => {
    const root = new Error('root');
    const cause = vi.fn(() => new Error('cause'));
    const stack = vi.fn(() => 'private');
    Object.defineProperty(root, 'cause', { get: cause });
    Object.defineProperty(root, 'stack', { get: stack });
    const walk = utils.walkErrorGraph(root);
    expect(walk.next().value).toMatchObject({ value: root });
    walk.return(undefined);
    expect(cause).not.toHaveBeenCalled();
    expect(stack).not.toHaveBeenCalled();
  });

  test('enforces declared limits and propagates failing relation reads', () => {
    const root = new Error('root', { cause: new Error('child') });
    expect(() => [...utils.walkErrorGraph(root, { maxDepth: 0 })]).toThrow(
      RangeError,
    );
    expect(() => [...utils.walkErrorGraph(root, { maxEntries: 1 })]).toThrow(
      RangeError,
    );
    Object.defineProperty(root, 'cause', {
      get() {
        throw new Error('getter');
      },
    });
    expect(() => [...utils.walkErrorGraph(root)]).toThrow('getter');
  });

  test('requires the suppression constructor when inspecting errors', () => {
    vi.stubGlobal('SuppressedError', undefined);
    try {
      expect(() => [...utils.walkErrorGraph(new Error('root'))]).toThrow(
        TypeError,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('uses an application-provided suppression constructor', () => {
    class SuppressedError extends Error {
      public constructor(
        public error: unknown,
        public suppressed: unknown,
        message?: string,
      ) {
        super(message);
      }
    }
    vi.stubGlobal('SuppressedError', SuppressedError);
    try {
      const failure = new SuppressedError(new Error('cleanup'), 'prior');
      const values = [...utils.walkErrorGraph(failure)].map(
        (entry) => entry.value,
      );
      expect(values).toEqual([failure, failure.error, 'prior']);
      const decoded = utils.decodeErrorGraph(
        JSON.parse(JSON.stringify(utils.encodeErrorGraph(failure))),
      );
      expect(decoded).toBeInstanceOf(SuppressedError);
      expect((decoded as SuppressedError).suppressed).toBe('prior');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('does not impose a default depth budget', () => {
    let root: Error = new Error('leaf');
    for (let index = 0; index < 70; index++) {
      root = new Error('parent', { cause: root });
    }
    expect([...utils.walkErrorGraph(root)]).toHaveLength(71);
  });
});

class ErrorService<T = unknown> extends AbstractError<T> {}

function roundTrip(
  value: unknown,
  options: GraphErrorDecoderOptions = {},
): unknown {
  const json = JSON.stringify(
    utils.encodeErrorGraph(value, { maxDepth: options.maxDepth }),
  );
  return utils.decodeErrorGraph(JSON.parse(json), options);
}

describe('class-directed error graph JSON', () => {
  test('reconstructs the package base class by default', () => {
    const root = new AbstractError('base', { cause: 'original' });
    const decoded = roundTrip(root) as AbstractError<string>;
    expect(decoded).toBeInstanceOf(AbstractError);
    expect(decoded.cause).toBe('original');
    expect(roundTrip(root, { decoders: [AbstractError] })).toBeInstanceOf(
      AbstractError,
    );
  });

  test('round-trips approved classes with native and arbitrary causes', () => {
    const cause = new TypeError('native', { cause: 42 });
    const root = new ErrorService('service', {
      data: { code: 'service' },
      cause,
    });
    const encoded = utils.encodeErrorGraph(root) as ReturnType<
      typeof root.toJSON
    >;
    expect(encoded.type).toBe('ErrorService');
    expect(encoded.data.message).toBe('service');
    expect(encoded.data.cause.type).toBe('TypeError');
    const decoded = roundTrip(root, {
      decoders: [ErrorService],
    }) as ErrorService<TypeError>;
    expect(decoded).toBeInstanceOf(ErrorService);
    expect(decoded.data).toEqual({ code: 'service' });
    expect(decoded.cause).toBeInstanceOf(TypeError);
    expect(decoded.cause.message).toBe('native');
    expect(decoded.cause.cause).toBe(42);
  });

  test('class methods and graph utilities share the default conversion', () => {
    const root = new ErrorService('outer', {
      cause: new SuppressedError(
        new TypeError('cleanup'),
        new AggregateError([new ErrorService('nested'), 'plain']),
      ),
    });
    const json = JSON.stringify(root);
    expect(JSON.parse(json)).toEqual(
      JSON.parse(JSON.stringify(utils.encodeErrorGraph(root))),
    );
    const decoded = ErrorService.fromJSON(JSON.parse(json));
    expect(decoded).toBeInstanceOf(ErrorService);
    expect(decoded.cause).toBeInstanceOf(SuppressedError);
    const cause = decoded.cause as SuppressedError;
    expect(cause.error).toBeInstanceOf(TypeError);
    expect(cause.suppressed).toBeInstanceOf(AggregateError);
    expect((cause.suppressed as AggregateError).errors[0]).toBeInstanceOf(
      ErrorService,
    );
    const cycle = new ErrorService('cycle');
    cycle.cause = cycle;
    expect(() => JSON.stringify(cycle)).toThrow('Cyclic error graph');
    expect(() => utils.encodeErrorGraph(cycle)).toThrow('Cyclic error graph');
    root.stack = undefined;
    expect(ErrorService.fromJSON(root.toJSON())).toBeInstanceOf(ErrorService);
  });

  test('class methods accept caller-owned cause conversion', () => {
    const cause = new Error('private');
    const root = new ErrorService('outer', { cause });
    const encode = vi.fn((value: unknown) => {
      expect(value).toBe(cause);
      return { kind: 'approved' };
    });
    const json = root.toJSON(undefined, encode);
    expect(json.data.cause).toEqual({ kind: 'approved' });
    const replacement = new TypeError('public');
    const decode = vi.fn((value: unknown) => {
      expect(value).toEqual({ kind: 'approved' });
      return replacement;
    });
    const decoded = ErrorService.fromJSON(json, decode);
    expect(decoded.cause).toBe(replacement);
    expect(encode).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
    expect(() =>
      root.toJSON(undefined, () => {
        throw new Error('encode failure');
      }),
    ).toThrow('encode failure');
    expect(() =>
      ErrorService.fromJSON(json, () => {
        throw new Error('decode failure');
      }),
    ).toThrow('decode failure');
  });

  test('class conversion reads a cause once per method call', () => {
    const root = new ErrorService('outer');
    const getCause = vi.fn(() => 'original');
    Object.defineProperty(root, 'cause', { get: getCause });
    const json = root.toJSON(undefined, (cause) => cause);
    expect(getCause).toHaveBeenCalledOnce();
    const getEncodedCause = vi.fn(() => 'encoded');
    Object.defineProperty(json.data, 'cause', { get: getEncodedCause });
    expect(ErrorService.fromJSON(json, (cause) => cause).cause).toBe('encoded');
    expect(getEncodedCause).toHaveBeenCalledOnce();
  });

  test('a caller can supply additional application classes to the decoder', () => {
    class ErrorInner extends AbstractError<unknown> {}
    const root = new ErrorService('outer', { cause: new ErrorInner('inner') });
    const json = JSON.parse(JSON.stringify(root));
    const defaultDecoded = ErrorService.fromJSON(json);
    expect(defaultDecoded.cause).not.toBeInstanceOf(ErrorInner);
    const decoded = ErrorService.fromJSON(json, (cause) =>
      utils.decodeErrorGraph(cause, { decoders: [ErrorInner] }),
    );
    expect(decoded.cause).toBeInstanceOf(ErrorInner);
  });

  test('shares depth and cycle tracking through subclass callbacks', () => {
    class ErrorForwarding extends ErrorService {
      public toJSON(key?: string, encodeCause?: (value: unknown) => unknown) {
        return super.toJSON(key, encodeCause);
      }
    }
    const root = new ErrorForwarding('outer', {
      cause: new TypeError('inner'),
    });
    const encoded = utils.encodeErrorGraph(root);
    expect(() => utils.encodeErrorGraph(root, { maxDepth: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      utils.decodeErrorGraph(encoded, {
        decoders: [ErrorForwarding],
        maxDepth: 0,
      }),
    ).toThrow(RangeError);

    const cyclic = new ErrorForwarding('cyclic');
    cyclic.cause = new AggregateError([cyclic]);
    expect(() => utils.encodeErrorGraph(cyclic)).toThrow('Cyclic error graph');
    expect(() => cyclic.toJSON()).toThrow('Cyclic error graph');
    const getCause = vi.fn(() => cyclic);
    Object.defineProperty(cyclic, 'cause', { get: getCause });
    expect(() => cyclic.toJSON()).toThrow('Cyclic error graph');
    expect(getCause).toHaveBeenCalledOnce();

    const encodedCycle: any = root.toJSON();
    encodedCycle.data.cause = {
      type: 'AggregateError',
      data: { message: 'aggregate', errors: [encodedCycle] },
    };
    expect(() =>
      utils.decodeErrorGraph(encodedCycle, { decoders: [ErrorForwarding] }),
    ).toThrow('Cyclic encoded error graph');
    expect(() => ErrorForwarding.fromJSON(encodedCycle)).toThrow(
      'Cyclic encoded error graph',
    );
  });

  test('accepts a trusted decoder adapter and forwards its cause traversal', () => {
    const adapter = {
      name: 'ErrorExternal',
      fromJSON(
        value: any,
        decodeCause: (cause: unknown) => unknown = (cause) => cause,
      ) {
        return new Error(value.data.message, {
          cause: decodeCause(value.data.cause),
        });
      },
    };
    const encoded = {
      type: 'ErrorExternal',
      data: {
        message: 'external',
        cause: { type: 'TypeError', data: { message: 'inner' } },
      },
    };
    const decoded = utils.decodeErrorGraph(encoded, {
      decoders: [adapter],
    }) as Error;
    expect(decoded.message).toBe('external');
    expect(decoded.cause).toBeInstanceOf(TypeError);
    expect(() =>
      utils.decodeErrorGraph(encoded, { decoders: [adapter], maxDepth: 0 }),
    ).toThrow(RangeError);
  });

  test('reconstructs supported native error types without changing their types', () => {
    for (const ErrorClass of [
      Error,
      TypeError,
      RangeError,
      ReferenceError,
      SyntaxError,
      URIError,
      EvalError,
    ]) {
      const decoded = roundTrip(new ErrorClass('native')) as Error;
      expect(decoded.constructor).toBe(ErrorClass);
      expect(decoded.message).toBe('native');
    }
  });

  test('reconstructs aggregate and suppressed relationships in order', () => {
    const shared = new RangeError('shared');
    const aggregate = new AggregateError([shared, shared, 'not an error']);
    const root = new SuppressedError(
      new Error('cleanup'),
      aggregate,
      'suppressed',
    );
    root.cause = new SyntaxError('cause');
    const decoded = roundTrip(root) as SuppressedError;
    expect(decoded).toBeInstanceOf(SuppressedError);
    expect(decoded.cause).toBeInstanceOf(SyntaxError);
    expect(decoded.error).toBeInstanceOf(Error);
    expect(decoded.suppressed).toBeInstanceOf(AggregateError);
    const errors = (decoded.suppressed as AggregateError).errors;
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect(errors[1]).toBeInstanceOf(RangeError);
    expect(errors[0]).not.toBe(errors[1]);
    expect(errors[2]).toBe('not an error');
  });

  test('reports an unavailable suppression constructor on decode', () => {
    const encoded = utils.encodeErrorGraph(
      new SuppressedError('cleanup', 'prior', 'message'),
    );
    vi.stubGlobal('SuppressedError', undefined);
    try {
      expect(() => utils.decodeErrorGraph(encoded)).toThrow(TypeError);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('uses class fromJSON for custom constructors', () => {
    class ErrorCode extends AbstractError<unknown> {
      public constructor(
        public code: number,
        message: string,
      ) {
        super(message);
      }
      public toJSON(
        key?: string,
        encodeCause?: (value: unknown) => unknown,
      ): any {
        const json = super.toJSON(key, encodeCause);
        json.data.code = this.code;
        return json;
      }
      public static fromJSON<T extends new (...args: Array<any>) => any>(
        this: T,
        json: any,
        decodeCause: (value: unknown) => unknown = (cause) =>
          utils.decodeErrorGraph(cause),
      ): InstanceType<T> {
        const error = new this(json.data.code, json.data.message);
        error.cause = decodeCause(json.data.cause);
        return error;
      }
    }
    const original = new ErrorCode(3, 'coded');
    original.cause = new RangeError('cause');
    const decoded = roundTrip(original, {
      decoders: [ErrorCode],
    }) as ErrorCode;
    expect(decoded).toBeInstanceOf(ErrorCode);
    expect(decoded.code).toBe(3);
    expect(decoded.cause).toBeInstanceOf(RangeError);
    const direct = ErrorCode.fromJSON(JSON.parse(JSON.stringify(original)));
    expect(direct.code).toBe(3);
    expect(direct.cause).toBeInstanceOf(RangeError);
  });

  test('keeps unknown types and ordinary non-error values unchanged', () => {
    const unknown = { type: 'ErrorForeign', data: { message: 'foreign' } };
    expect(utils.decodeErrorGraph(unknown)).toBe(unknown);
    const value = { category: 'expected', count: 2 };
    expect(roundTrip(value)).toEqual(value);
    class ErrorForeign extends Error {}
    expect(roundTrip(new ErrorForeign('foreign'))).toMatchObject({
      type: 'ErrorForeign',
    });
  });

  test('leaves JSON compatibility of arbitrary values to the caller', () => {
    const failure = new ErrorService<unknown>('failure', { cause: 1n });
    const encoded = utils.encodeErrorGraph(failure) as ReturnType<
      typeof failure.toJSON
    >;
    expect(encoded.data.cause).toBe(1n);
    expect(() => JSON.stringify(encoded)).toThrow(TypeError);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    failure.cause = cyclic;
    expect(() => JSON.stringify(utils.encodeErrorGraph(failure))).toThrow(
      TypeError,
    );
    const nested = { error: new TypeError('nested in plain data') };
    failure.cause = nested;
    const withNested = utils.encodeErrorGraph(failure) as ReturnType<
      typeof failure.toJSON
    >;
    expect(withNested.data.cause).toBe(nested);
    expect(JSON.parse(JSON.stringify(withNested)).data.cause.error).toEqual({});
  });

  test('rejects cyclic graphs, invalid native nodes, and reserved registrations', () => {
    const cyclic = new Error('cycle');
    cyclic.cause = cyclic;
    expect(() => utils.encodeErrorGraph(cyclic)).toThrow('Cyclic error graph');
    expect(() =>
      utils.decodeErrorGraph({ type: 'TypeError', data: { message: 3 } }),
    ).toThrow(TypeError);
    expect(() =>
      utils.decodeErrorGraph({}, { decoders: [ErrorService, ErrorService] }),
    ).toThrow(TypeError);
    expect(() =>
      utils.encodeErrorGraph(
        new Error('outer', { cause: new Error('inner') }),
        { maxDepth: 0 },
      ),
    ).toThrow(RangeError);
    const encoded: any = { type: 'Error', data: { message: 'cycle' } };
    encoded.data.cause = encoded;
    expect(() => utils.decodeErrorGraph(encoded)).toThrow(
      'Cyclic encoded error graph',
    );
    const ConflictingTypeError = class TypeError extends Error {};
    expect(() =>
      utils.encodeErrorGraph(new ConflictingTypeError('custom')),
    ).toThrow('reserved type');
  });

  test('can be composed inside an application-owned JSON envelope', () => {
    class ErrorRemote<T = unknown> extends AbstractError<T> {}
    const remote = new ErrorService('remote failure', {
      cause: new TypeError('cause'),
    });
    const wire = JSON.stringify({
      version: 1,
      failure: utils.encodeErrorGraph(remote),
    });
    const parsed = JSON.parse(wire);
    const cause = utils.decodeErrorGraph(parsed.failure, {
      decoders: [ErrorService],
    });
    const container = new ErrorRemote('remote', { cause });
    expect(parsed.version).toBe(1);
    expect(container.cause).toBeInstanceOf(ErrorService);
    expect((container.cause as ErrorService<Error>).cause).toBeInstanceOf(
      TypeError,
    );
  });

  test('preserves nested remote containers and their selected causes', () => {
    class ErrorRemote<T = unknown> extends AbstractError<T> {}
    const remote = new ErrorRemote('outer hop', {
      cause: new ErrorRemote('inner hop', {
        cause: new ErrorService('service', {
          cause: new TypeError('provider'),
        }),
      }),
    });
    const decoded = roundTrip(remote, {
      decoders: [ErrorRemote, ErrorService],
    }) as ErrorRemote<ErrorRemote<ErrorService<TypeError>>>;
    expect(decoded).toBeInstanceOf(ErrorRemote);
    expect(decoded.cause).toBeInstanceOf(ErrorRemote);
    expect(decoded.cause.cause).toBeInstanceOf(ErrorService);
    expect(decoded.cause.cause.cause).toBeInstanceOf(TypeError);
  });

  test('leaves coincidentally error-shaped values to a boundary-specific policy', () => {
    const ambiguous = { type: 'TypeError', data: { message: 'ordinary data' } };
    expect(utils.decodeErrorGraph(ambiguous)).toBeInstanceOf(TypeError);
    const wrapped = { kind: 'value', value: ambiguous };
    expect(utils.decodeErrorGraph(wrapped)).toBe(wrapped);
  });

  test('preserves ordinary class serialization and does not silently redact fields', () => {
    const root = new ErrorService('private', { data: { secret: 'example' } });
    const encoded = utils.encodeErrorGraph(root) as ReturnType<
      typeof root.toJSON
    >;
    expect(encoded.data.data.secret).toBe('example');
    expect(encoded.data.stack).toBe(root.stack);
    expect(root.toJSON().data.cause).toBeUndefined();
  });
});

describe('application-owned IPC boundary', () => {
  test('projects, validates, and reconstructs only the permitted graph', () => {
    class ErrorRemote<T = unknown> extends AbstractError<T> {}
    // Stand-in for the provider's documented invalid-input error at this call.
    class ProviderInvalidInput extends Error {}
    const maxBytes = 1024;
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const hasKeys = (value: unknown, keys: Array<string>): boolean =>
      isRecord(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key));

    // This boundary deliberately maps a documented provider failure to its
    // public TypeError representation. Other failures need a different policy.
    function project(failure: ErrorService<unknown>): ErrorService<TypeError> {
      if (!(failure.cause instanceof ProviderInvalidInput)) {
        throw new TypeError('Failure is not approved for this response');
      }
      const cause = new TypeError('Invalid input');
      cause.stack = undefined;
      const result = new ErrorService('Request failed', { cause });
      result.stack = undefined;
      return result;
    }

    function receiveConfirmedRemoteFailure(
      payload: string,
    ): ErrorRemote<unknown> {
      // Framing and authentication belong to the transport. It should enforce
      // its byte budget before buffering. The caller has already established
      // that this is a remote failure response; shape alone does not prove it.
      // This check occurs before JSON.parse.
      if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
        throw new TypeError('Response too large');
      }
      const envelope: unknown = JSON.parse(payload);
      if (
        !hasKeys(envelope, ['version', 'failure']) ||
        !isRecord(envelope) ||
        envelope.version !== 1
      ) {
        throw new TypeError('Invalid envelope');
      }
      const failure = envelope.failure;
      if (
        !hasKeys(failure, ['type', 'description', 'data']) ||
        !isRecord(failure) ||
        failure.type !== ErrorService.name ||
        failure.description !== '' ||
        !hasKeys(failure.data, ['message', 'timestamp', 'data', 'cause']) ||
        !isRecord(failure.data)
      ) {
        throw new TypeError('Invalid service failure');
      }
      const data = failure.data;
      if (
        data.message !== 'Request failed' ||
        typeof data.timestamp !== 'string' ||
        Number.isNaN(Date.parse(data.timestamp)) ||
        new Date(data.timestamp).toISOString() !== data.timestamp ||
        !hasKeys(data.data, [])
      ) {
        throw new TypeError('Invalid service data');
      }
      const cause = data.cause;
      if (
        !hasKeys(cause, ['type', 'data']) ||
        !isRecord(cause) ||
        cause.type !== 'TypeError' ||
        !hasKeys(cause.data, ['message']) ||
        !isRecord(cause.data) ||
        cause.data.message !== 'Invalid input'
      ) {
        throw new TypeError('Invalid cause');
      }
      // Only after complete schema validation do we invoke approved decoders.
      const decoded = utils.decodeErrorGraph(failure, {
        decoders: [ErrorService],
        maxDepth: 1,
      });
      return new ErrorRemote('Remote operation failed', { cause: decoded });
    }

    const privateFailure = new ErrorService('secret service message', {
      data: { secret: 'credential' },
      cause: new ProviderInvalidInput('secret provider message'),
    });
    expect(() =>
      project(new ErrorService('unexpected', { cause: new TypeError('bug') })),
    ).toThrow('Failure is not approved for this response');
    const payload = JSON.stringify({
      version: 1,
      failure: utils.encodeErrorGraph(project(privateFailure)),
    });
    expect(payload).not.toContain('secret');
    expect(payload).not.toContain('credential');
    expect(payload).not.toContain('stack');
    const remote = receiveConfirmedRemoteFailure(payload);
    expect(remote.cause).toBeInstanceOf(ErrorService);
    expect((remote.cause as ErrorService<unknown>).cause).toBeInstanceOf(
      TypeError,
    );

    const altered = JSON.parse(payload);
    altered.failure.data.cause.type = 'RangeError';
    expect(() =>
      receiveConfirmedRemoteFailure(JSON.stringify(altered)),
    ).toThrow('Invalid cause');
    altered.failure.data.cause.type = 'TypeError';
    altered.failure.data.cause.data.stack = 'private';
    expect(() =>
      receiveConfirmedRemoteFailure(JSON.stringify(altered)),
    ).toThrow('Invalid cause');
    expect(() => receiveConfirmedRemoteFailure('{')).toThrow(SyntaxError);
    expect(() =>
      receiveConfirmedRemoteFailure('x'.repeat(maxBytes + 1)),
    ).toThrow('Response too large');
  });
});
