/**
 * Plain data dictionary
 */
type POJO = { [key: string]: any };

type Class<T> = new (...args: any[]) => T;

/**
 * A relationship from an error to a thrown value. Aggregate indices preserve
 * member order; suppression relationships are not necessarily causal.
 */
type GraphErrorRelation =
  | { readonly kind: 'cause' }
  | { readonly kind: 'aggregate'; readonly index: number }
  | { readonly kind: 'error' }
  | { readonly kind: 'suppressed' };

/** One root or relationship encountered by the lazy error graph walker. */
type GraphErrorEntry = {
  readonly value: unknown;
  readonly parent: Error | undefined;
  readonly relation: GraphErrorRelation | undefined;
  readonly depth: number;
  /** The object was encountered earlier in this traversal. */
  readonly repeated: boolean;
  /** The object is already on the current path. */
  readonly circular: boolean;
};

/** Optional limits for one graph walk; omitted limits are unbounded. */
type GraphErrorWalkOptions = {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
};

/**
 * An application-provided decoder for one encoded error record.
 *
 * The graph decoder selects it when the record's type matches name. An error
 * class with a compatible static fromJSON method can be supplied directly; a
 * trusted adapter object can also implement this contract. The optional
 * callback reconstructs the record's cause graph within the caller's traversal
 * state. Implementations that decode a cause should use it, rather than start a
 * separate unbounded traversal. The method returns a reconstructed Error and may
 * throw. A name is an identifier, not authorization to trust remote input.
 *
 * @example
 * class ErrorRequest extends AbstractError<unknown> {}
 * const failure = errorsUtils.decodeErrorGraph(encoded, {
 *   decoders: [ErrorRequest],
 * });
 */
type GraphErrorDecoder = {
  readonly name: string;
  fromJSON(value: any, decodeCause?: (value: unknown) => unknown): Error;
};

/** Options for reconstructing a JSON-compatible error graph. */
type GraphErrorDecoderOptions = {
  /**
   * Additional trusted decoders. Supported native errors and AbstractError are
   * also recognized; this list is not a complete input or disclosure allowlist.
   */
  readonly decoders?: ReadonlyArray<GraphErrorDecoder>;
  /** Maximum visited relationship depth; omitted means no explicit limit. */
  readonly maxDepth?: number;
};

/**
 * Object-form representation of one error between graph encoding and decoding.
 * The encoder uses this internal shape; the decoder accepts unknown input and
 * recognizes records at runtime. The record can be stringified and parsed as
 * JSON if its fields contain compatible values. Its data fields depend on the
 * error type and are not validated as JSON values by this type.
 */
type SerializedErrorRecord = { type: string; data: Record<string, any> };

/** Constructor signature shared by the supported ordinary native error types. */
type NativeErrorClass = new (message?: string, options?: ErrorOptions) => Error;

export type {
  POJO,
  Class,
  GraphErrorRelation,
  GraphErrorEntry,
  GraphErrorWalkOptions,
  GraphErrorDecoder,
  GraphErrorDecoderOptions,
  SerializedErrorRecord,
  NativeErrorClass,
};
