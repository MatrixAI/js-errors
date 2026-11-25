import type {
  GraphErrorEntry,
  GraphErrorRelation,
  GraphErrorWalkOptions,
  GraphErrorDecoderOptions,
  SerializedErrorRecord,
  NativeErrorClass,
} from './types.js';
import AbstractError from './AbstractError.js';

/**
 * Yield immediate relationships without reading messages, stacks or data.
 * Property access, iteration and instanceof checks can execute user code and
 * their exceptions propagate. Foreign-realm errors are not recognized.
 */
function* errorRelations(
  value: unknown,
): Generator<{ value: unknown; parent: Error; relation: GraphErrorRelation }> {
  if (!(value instanceof Error)) return;
  if ('cause' in value) {
    yield { value: value.cause, parent: value, relation: { kind: 'cause' } };
  }
  if (value instanceof AggregateError) {
    let index = 0;
    for (const member of value.errors) {
      yield {
        value: member,
        parent: value,
        relation: { kind: 'aggregate', index: index++ },
      };
    }
  }
  if (value instanceof SuppressedError) {
    yield { value: value.error, parent: value, relation: { kind: 'error' } };
    yield {
      value: value.suppressed,
      parent: value,
      relation: { kind: 'suppressed' },
    };
  }
}

/**
 * Walk depth-first in cause, aggregate, error, suppressed order. Every edge is
 * yielded, including edges to previously encountered objects, but repeated
 * targets are not expanded. Equal primitives do not count as shared identity.
 * The consumer may stop iteration before later relations are read. Limits are
 * per walk and throw RangeError when a demanded entry exceeds them. There are
 * no default limits; deep walks are also subject to the JavaScript call stack.
 * The runtime must provide SuppressedError, natively or via an application
 * polyfill.
 *
 * @example
 * const failure = new Error('outer', { cause: new TypeError('invalid') });
 * let hasDirectTypeError = false;
 * for (const entry of errorsUtils.walkErrorGraph(failure)) {
 *   if (entry.parent === failure && entry.relation?.kind === 'cause' &&
 *       entry.value instanceof TypeError) {
 *     hasDirectTypeError = true;
 *     break;
 *   }
 * }
 */
function* walkErrorGraph(
  root: unknown,
  options: GraphErrorWalkOptions = {},
): Generator<GraphErrorEntry> {
  const maxDepth = options.maxDepth ?? Infinity;
  const maxEntries = options.maxEntries ?? Infinity;
  if (
    options.maxDepth !== undefined &&
    (!Number.isSafeInteger(maxDepth) || maxDepth < 0)
  ) {
    throw new RangeError('Invalid maximum error graph depth');
  }
  if (
    options.maxEntries !== undefined &&
    (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
  ) {
    throw new RangeError('Invalid maximum error graph entries');
  }
  const seen = new Set<object>();
  const ancestors = new Set<object>();
  let count = 0;

  function* visit(
    value: unknown,
    parent: Error | undefined,
    relation: GraphErrorRelation | undefined,
    depth: number,
  ): Generator<GraphErrorEntry> {
    if (depth > maxDepth || ++count > maxEntries) {
      throw new RangeError('Error graph limit exceeded');
    }
    const identity =
      value !== null &&
      (typeof value === 'object' || typeof value === 'function')
        ? value
        : undefined;
    const repeated = identity !== undefined && seen.has(identity);
    const circular = identity !== undefined && ancestors.has(identity);
    if (identity !== undefined) seen.add(identity);
    yield { value, parent, relation, depth, repeated, circular };
    if (repeated) return;
    if (identity !== undefined) ancestors.add(identity);
    try {
      for (const child of errorRelations(value)) {
        yield* visit(child.value, child.parent, child.relation, depth + 1);
      }
    } finally {
      if (identity !== undefined) ancestors.delete(identity);
    }
  }

  yield* visit(root, undefined, undefined, 0);
}

const nativeErrors: Readonly<Record<string, NativeErrorClass>> = {
  Error,
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  URIError,
  EvalError,
};

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkDepth(depth: number, limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError('Invalid error graph depth');
  }
  if (limit !== undefined && depth > limit) {
    throw new RangeError('Error graph depth exceeded');
  }
}

/**
 * Encode an error graph as serialized error records. The graph consists of errors
 * and thrown values connected by causes, ordered aggregate members, and
 * suppression relationships. Each error becomes a record containing its type
 * and data; arbitrary non-error values pass through unchanged. AbstractError
 * instances use their class-directed serialization. The encoder does not
 * traverse errors nested inside arbitrary non-error objects or application data.
 *
 * Active error cycles throw; shared errors are copied, not identity-preserved.
 * The optional depth limit applies to traversed relationships, not arbitrary
 * data. The optional ancestors seed is copied and treated as already active.
 * Custom class serializers must forward the supplied cause encoder. Hooks and
 * property reads can execute or throw. JSON can discard undefined values or
 * reject data that is not JSON-compatible. The caller must ensure arbitrary
 * values, custom data, and callback results satisfy its JSON contract.
 *
 * For an IPC boundary, construct or project only recipient-approved errors and
 * values before encoding. This helper does not filter messages, stacks, data,
 * timestamps, or causes. Hooks and property reads can execute before it returns;
 * do not rely on later filtering to prevent their effects. Check the encoded
 * result against the boundary's schema before sending it.
 *
 * @example
 * // The application has chosen this fixed message and an empty data object.
 * const approved = new AbstractError('Request failed');
 * approved.stack = undefined;
 * const encoded = errorsUtils.encodeErrorGraph(approved);
 * const json = JSON.stringify(encoded);
 * // The application must also approve the type, description and timestamp.
 *
 * @see ../README.md#boundary-owned-ipc-example for a narrow end-to-end example.
 */
function encodeErrorGraph(
  root: unknown,
  options: { readonly maxDepth?: number } = {},
  ancestors: ReadonlySet<Error> = new Set<Error>(),
): unknown {
  const active = new Set<Error>(ancestors);
  function visit(value: unknown, depth: number): unknown {
    checkDepth(depth, options.maxDepth);
    if (!(value instanceof Error)) return value;
    if (active.has(value)) throw new TypeError('Cyclic error graph');
    active.add(value);
    try {
      let json: SerializedErrorRecord;
      if (value instanceof AbstractError) {
        const result: unknown = value.toJSON(undefined, (cause) =>
          visit(cause, depth + 1),
        );
        if (
          !isRecord(result) ||
          typeof result.type !== 'string' ||
          !isRecord(result.data)
        ) {
          throw new TypeError('Invalid class-directed error representation');
        }
        json = { ...result, type: result.type, data: { ...result.data } };
      } else {
        json = {
          type: value.constructor.name,
          data: { message: value.message, stack: value.stack },
        };
        if ('cause' in value) json.data.cause = value.cause;
        if (value instanceof AggregateError) {
          json.data.errors = [...value.errors];
        }
        if (value instanceof SuppressedError) {
          json.data.error = value.error;
          json.data.suppressed = value.suppressed;
        }
      }
      const reserved = Object.hasOwn(nativeErrors, json.type)
        ? nativeErrors[json.type]
        : json.type === 'AggregateError'
          ? AggregateError
          : json.type === 'SuppressedError'
            ? SuppressedError
            : json.type === AbstractError.name
              ? AbstractError
              : undefined;
      if (reserved !== undefined && value.constructor !== reserved) {
        throw new TypeError(
          'Error representation conflicts with a reserved type',
        );
      }
      if (!(value instanceof AbstractError) && 'cause' in json.data) {
        json.data.cause = visit(json.data.cause, depth + 1);
      }
      if (value instanceof AggregateError) {
        if (!Array.isArray(json.data.errors)) {
          throw new TypeError('Invalid aggregate error representation');
        }
        json.data.errors = json.data.errors.map((item: unknown) =>
          visit(item, depth + 1),
        );
      }
      if (value instanceof SuppressedError) {
        json.data.error = visit(json.data.error, depth + 1);
        json.data.suppressed = visit(json.data.suppressed, depth + 1);
      }
      return json;
    } finally {
      active.delete(value);
    }
  }
  return visit(root, 0);
}

/**
 * Decode an error graph from serialized error records. Each recognized record
 * becomes an error using a registered decoder or a supported native constructor;
 * causes, ordered aggregate members, and suppression relationships are decoded
 * recursively. Unknown records and arbitrary non-error values pass through
 * unchanged. A plain value shaped like a recognized record is ambiguous: a
 * boundary requiring an unambiguous format must add its own tagging or policy.
 *
 * Cyclic recognized records throw; repeated records are reconstructed separately,
 * not identity-preserved. The optional depth limit applies to traversed
 * relationships, not arbitrary data. Registered decoders must use the supplied
 * cause decoder to share depth and cycle tracking. Decoders and property reads
 * can execute or throw.
 *
 * The decoders option adds application decoders; it does not restrict the native
 * types or the base class. Before decoding untrusted IPC, the application must
 * enforce transport byte limits before parsing, validate its envelope and every
 * permitted error record and value, and apply its own unknown-type and disclosure
 * policy. Only then should it invoke this helper with trusted decoders.
 * Authentication, framing and remote provenance remain transport responsibilities.
 *
 * @example
 * // This literal is trusted; network input needs the boundary checks above.
 * const parsed = JSON.parse('{"type":"TypeError","data":{"message":"invalid"}}');
 * const decoded = errorsUtils.decodeErrorGraph(parsed);
 * // decoded is a TypeError with message 'invalid'.
 *
 * @see ../README.md#boundary-owned-ipc-example for a narrow end-to-end example.
 */
function decodeErrorGraph(
  root: unknown,
  options: GraphErrorDecoderOptions = {},
): unknown {
  const decoders = new Map<
    string,
    NonNullable<GraphErrorDecoderOptions['decoders']>[number]
  >();
  decoders.set(AbstractError.name, AbstractError);
  for (const errorClass of options.decoders ?? []) {
    if (errorClass === AbstractError) continue;
    if (
      typeof errorClass.name !== 'string' ||
      errorClass.name.length === 0 ||
      typeof errorClass.fromJSON !== 'function' ||
      decoders.has(errorClass.name) ||
      Object.hasOwn(nativeErrors, errorClass.name) ||
      errorClass.name === 'AggregateError' ||
      errorClass.name === 'SuppressedError'
    ) {
      throw new TypeError('Duplicate or reserved error class name');
    }
    decoders.set(errorClass.name, errorClass);
  }
  const active = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    checkDepth(depth, options.maxDepth);
    if (
      value instanceof Error ||
      !isRecord(value) ||
      typeof value.type !== 'string' ||
      !isRecord(value.data)
    ) {
      return value;
    }
    const errorClass = decoders.get(value.type);
    const Native = Object.hasOwn(nativeErrors, value.type)
      ? nativeErrors[value.type]
      : undefined;
    const isAggregate = value.type === 'AggregateError';
    const isSuppressed = value.type === 'SuppressedError';
    if (errorClass == null && Native == null && !isAggregate && !isSuppressed) {
      return value;
    }
    if (active.has(value)) throw new TypeError('Cyclic encoded error graph');
    active.add(value);
    try {
      const data = { ...value.data };
      if (errorClass != null) {
        return errorClass.fromJSON({ ...value, data }, (cause) =>
          visit(cause, depth + 1),
        );
      }
      if ('cause' in data) data.cause = visit(data.cause, depth + 1);
      if (
        typeof data.message !== 'string' ||
        (data.stack !== undefined && typeof data.stack !== 'string')
      ) {
        throw new TypeError('Invalid native error representation');
      }
      const cause = 'cause' in data ? { cause: data.cause } : undefined;
      let error: Error;
      if (isAggregate) {
        if (!Array.isArray(data.errors)) {
          throw new TypeError('Invalid aggregate error representation');
        }
        error = new AggregateError(
          data.errors.map((item: unknown) => visit(item, depth + 1)),
          data.message,
          cause,
        );
      } else if (isSuppressed) {
        if (!('error' in data) || !('suppressed' in data)) {
          throw new TypeError('Invalid suppressed error representation');
        }
        error = new SuppressedError(
          visit(data.error, depth + 1),
          visit(data.suppressed, depth + 1),
          data.message,
        );
        if (cause != null) error.cause = cause.cause;
      } else {
        error = new Native!(data.message, cause);
      }
      error.stack = data.stack;
      return error;
    } finally {
      active.delete(value);
    }
  }
  return visit(root, 0);
}

export { walkErrorGraph, encodeErrorGraph, decodeErrorGraph };
