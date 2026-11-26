# js-errors

Exception system with typed causes, extensible JSON encoding/decoding, and
cycle-safe traversal of error and aggregate-error graphs.

## Installation

```sh
npm install --save @matrixai/errors
```

```ts
import { AbstractError, utils as errorsUtils } from '@matrixai/errors';

class RequestError<T = unknown> extends AbstractError<T> {
  public static description = 'Request failed';
}

const cause = new TypeError('Invalid input');
const error = new RequestError('Could not process request', { cause });
let containsCause = false;
for (const entry of errorsUtils.walkErrorGraph(error)) {
  if (entry.value === cause) {
    containsCause = true;
    break;
  }
}
```

Subclasses inherit the static description, message, stack, data, cause, and
timestamp contracts. JSON reconstruction is class-directed: call the matching
class's `fromJSON`. Custom fields remain the subclass's responsibility.

## Error relationships and JSON

For relation-aware inspection, `utils.walkErrorGraph` yields the root and each
cause, ordered aggregate member, suppression error, and suppressed prior
failure. Each entry identifies its parent and relation, and distinguishes a
repeated object from a cycle on the current path. Repeated objects are not
expanded again; arbitrary thrown values are leaves. The walk is lazy, has
optional depth and entry limits, and propagates errors from relation access. It
uses local-realm error identity and is subject to the JavaScript call stack.

The previous `utils.checkError` export has been removed. Migrate matching code
to the graph iterator and test entry values; stop the iteration early when a
match is found. This is a breaking change: traversal now includes suppression,
visits causes before aggregate members, and does not synthesize absent causes.
It does not accept a caller-provided visited set.

Graph inspection and conversion require the `SuppressedError` constructor.
Applications targeting a runtime without it must install a compatible polyfill
before using these utilities and before transformed code creates the errors.
Transpiling syntax alone does not necessarily install a global constructor;
helper-local fallbacks may not produce instances recognized by these utilities.

```ts
for (const entry of errorsUtils.walkErrorGraph(error, { maxEntries: 100 })) {
  console.log(entry.relation, entry.value);
}
```

The class methods and JSON helpers use the same class-directed representation.
The default class methods encode and decode supported causes, including native
errors. The matching class and the package base class are recognized by the
default class decoder; supply a decoder configured with other application
classes when they can occur as causes. The generic decoder accepts an explicit
list of additional decoders, including compatible classes or trusted adapter
objects. This list does not disable recognition of native errors or the base
class and is not an input allowlist.

```ts
const encoded = errorsUtils.encodeErrorGraph(error);
const json = JSON.stringify(encoded);
const reconstructed = errorsUtils.decodeErrorGraph(JSON.parse(json), {
  decoders: [RequestError],
});
```

`toJSON` accepts an optional cause encoder, and `fromJSON` accepts an optional
cause decoder. These callbacks default to the package graph conversion. An
override of `toJSON` must forward the encoder to `super.toJSON`; an override of
`fromJSON` must use the supplied decoder on its cause. Otherwise it can bypass
graph conversion and the caller's depth and cycle protections. Existing
overrides must be migrated to this callback contract. Hooks remain responsible
for their custom fields and constructors, and can provide boundary-specific
conversion instead of the default.

Use the defaults when the package representation and its included fields suit a
trusted local round-trip. Supply a cause callback when an existing protocol
needs a different representation, arbitrary values need application-specific
tags, or class decoding must recognize other application classes. The callback
only converts the cause; it does not validate or redact the outer error record.
A replacement callback must provide any cycle and depth protections it needs.

```ts
import type { Class } from '@matrixai/errors';

class ErrorCode extends AbstractError<unknown> {
  public constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }

  public toJSON(key?: string, encodeCause?: (value: unknown) => unknown) {
    const json = super.toJSON(key, encodeCause);
    json.data.code = this.code;
    return json;
  }

  public static fromJSON<T extends Class<any>>(
    this: T,
    json: any,
    decodeCause: (value: unknown) => unknown = errorsUtils.decodeErrorGraph,
  ): InstanceType<T> {
    const error = new this(json.data.code, json.data.message);
    error.cause = decodeCause(json.data.cause);
    return error;
  }
}
```

This abbreviated smart constructor illustrates callback propagation, not a
complete validator. A real override must also validate its fields and preserve
any timestamp, stack, or other data promised by its class contract.

The helpers do not define a transport envelope, filter fields, or establish a
recipient's authority. Class serialization can expose messages, stacks, causes,
and data. Applications must apply their own disclosure policy and transport
limits, including a byte limit before parsing untrusted input. Never put secrets
in error objects merely because a later filter is expected to remove them.

Only the explicitly represented error relations are reconstructed. Unknown types
and arbitrary non-error values pass through unchanged. A plain value that has
the shape of a known error is ambiguous; applications needing unambiguous IPC
must use their own tagging or decoding policy. Class hooks, getters, and other
callbacks can execute or throw. Error cycles are rejected, shared errors are
duplicated, and JSON can discard undefined fields or reject unsupported values.
Optional depth limits do not bound arbitrary JSON data or replace transport
validation. Applications must ensure arbitrary thrown values, custom data, and
callback results satisfy their JSON contract; the encoder does not validate or
convert every value that JSON cannot represent.

### Application-owned JSON values

The default graph encoder handles error relationships, not arbitrary JavaScript
object graphs. A non-error thrown value is returned unchanged; errors nested
inside a plain object are not traversed as error relationships. Passing a value
through does not mean it can be serialized or reconstructed losslessly:

| Value                                                     | Default graph encoder              | Subsequent JSON behavior                                                                       |
| --------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| JSON-compatible string, boolean, number, object, or array | Passed through unchanged           | Serialized subject to normal JSON semantics                                                    |
| Bigint                                                    | Passed through unchanged           | Stringification throws unless the application converts it                                      |
| Undefined, symbol, or function                            | Passed through unchanged           | May be omitted, replaced with null in an array, or produce no JSON text                        |
| Cyclic plain object                                       | Passed through unchanged           | Stringification throws unless the application handles the cycle                                |
| Error nested inside a plain object                        | The plain object is passed through | JSON behavior depends on the nested value and its hooks; no error-graph round-trip is promised |

Non-finite numbers and negative zero can also lose information in JSON. The
application decides which values its boundary permits, how to tag or reject
others, and how to validate and reconstruct the result. These choices are
separate from the package's error-record format and relationship traversal.

JSON's replacer can implement an application-selected representation for values
that JSON does not otherwise support. This trusted local example permits a
bigint as the cause and explicitly reconstructs it through the class's cause
decoder:

```js
const failure = new RequestError('Request failed', { cause: 42n });
const encoded = errorsUtils.encodeErrorGraph(failure);
const json = JSON.stringify(encoded, (_key, value) =>
  typeof value === 'bigint'
    ? { kind: 'bigint', decimal: value.toString() }
    : value,
);
const parsed = JSON.parse(json);
const restored = RequestError.fromJSON(parsed, (cause) => {
  if (
    cause === null ||
    typeof cause !== 'object' ||
    Array.isArray(cause) ||
    Object.keys(cause).length !== 2 ||
    cause.kind !== 'bigint' ||
    typeof cause.decimal !== 'string' ||
    cause.decimal.length > 128 ||
    !/^-?(0|[1-9][0-9]*)$/.test(cause.decimal)
  ) {
    throw new TypeError('Invalid bigint cause');
  }
  return BigInt(cause.decimal);
});
```

This is a local example, not a general codec or an untrusted IPC validator. A
protocol must reserve or otherwise disambiguate tags, define supported values
and limits, validate the complete received representation, and test its own
reconstruction policy. A JSON reviver is another option when its scope and tag
rules are explicit. JSON serialization invokes applicable `toJSON` methods
before the replacer receives their results; graph encoding and its hooks have
already run in the example. A replacer cannot undo those effects or handle an
error cycle rejected by the graph encoder. It also does not by itself define a
policy for every cyclic object, unsupported value, or sensitive field.

### Boundary-owned IPC example

This deliberately narrow example allows one application error and one projected
native cause. The provider error is a stand-in for a documented failure of the
specific operation; an unrelated `TypeError` is not classified as invalid input.
The caller of the receive function has already established that the
authenticated transport delivered a remote failure response. Authentication,
framing, and a byte limit before buffering remain the transport's
responsibility.

```js
import { AbstractError, utils as errorsUtils } from '@matrixai/errors';

class ProviderInvalidInput extends Error {}
class ErrorRequest extends AbstractError {}
class ErrorRemote extends AbstractError {}

function encodeApprovedFailure(failure) {
  // Use the real provider's documented class or guard at its own boundary.
  if (!(failure.cause instanceof ProviderInvalidInput)) {
    throw new TypeError('Failure is not approved for this response');
  }
  const cause = new TypeError('Invalid input');
  cause.stack = undefined;
  const projected = new ErrorRequest('Request failed', { cause });
  projected.stack = undefined;
  return JSON.stringify({
    version: 1,
    failure: errorsUtils.encodeErrorGraph(projected),
  });
}

function hasKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function receiveConfirmedRemoteFailure(payload) {
  const maxBytes = 1024;
  // This check is before parsing but after buffering: the transport must also
  // bound the input earlier. Check string length before allocating encoded bytes.
  if (
    payload.length > maxBytes ||
    new TextEncoder().encode(payload).byteLength > maxBytes
  ) {
    throw new TypeError('Response too large');
  }
  const envelope = JSON.parse(payload);
  if (!hasKeys(envelope, ['version', 'failure']) || envelope.version !== 1) {
    throw new TypeError('Invalid envelope');
  }
  const failure = envelope.failure;
  if (
    !hasKeys(failure, ['type', 'description', 'data']) ||
    failure.type !== ErrorRequest.name ||
    failure.description !== ''
  ) {
    throw new TypeError('Invalid failure');
  }
  const data = failure.data;
  if (
    !hasKeys(data, ['message', 'timestamp', 'data', 'cause']) ||
    data.message !== 'Request failed' ||
    typeof data.timestamp !== 'string' ||
    Number.isNaN(Date.parse(data.timestamp)) ||
    new Date(data.timestamp).toISOString() !== data.timestamp ||
    !hasKeys(data.data, [])
  ) {
    throw new TypeError('Invalid failure data');
  }
  const cause = data.cause;
  if (
    !hasKeys(cause, ['type', 'data']) ||
    cause.type !== 'TypeError' ||
    !hasKeys(cause.data, ['message']) ||
    cause.data.message !== 'Invalid input'
  ) {
    throw new TypeError('Invalid cause');
  }
  const decoded = errorsUtils.decodeErrorGraph(failure, {
    decoders: [ErrorRequest],
    maxDepth: 1,
  });
  return new ErrorRemote('Remote operation failed', { cause: decoded });
}

const privateFailure = new ErrorRequest('private', {
  cause: new ProviderInvalidInput('provider secret'),
});
const payload = encodeApprovedFailure(privateFailure);
const remote = receiveConfirmedRemoteFailure(payload);
```

The exact-field validation deliberately rejects unknown types, arbitrary causes,
stacks, and additional fields before reconstruction. It is an application
policy, not a general-purpose schema: another boundary may need different
classes, limits, redaction, and fallback behavior. Class names in this example
are not a stable public wire identifier. A real protocol must version and map
its identifiers and test its actual transport paths. Preserve the original
operational failure if projection or error reporting fails; do not silently
replace it with a codec failure.

## Portable timestamps

One ES2022 ESM distribution runs in modern Node and can be bundled for browser
documents and workers using ordinary npm-aware tooling. Runtime source does not
import Node builtins, require a browser shim, select a second build, or use
top-level await. Node 24 or newer is the development and declared Node engine
baseline, not a requirement to provide Node APIs in a web runtime.

Generated timestamps use the global Performance API's epoch origin plus its
relative clock when usable. Missing, restricted, incomplete, non-finite, or
out-of-range performance clocks fall back to `Date.now()`. The clock is sampled
synchronously when an error needs a generated timestamp, not at module import.
An invalid wall-clock result raises `RangeError`; a thrown wall-clock failure
propagates without advancing the generated clock state.

Generated timestamps are weakly nondecreasing within one loaded clock module
instance. Millisecond precision allows equality; a backwards clock adjustment
can hold timestamps constant until the clock catches up. This does not provide
unique IDs, accurate elapsed durations during fallback, cross-worker ordering,
cross-process ordering, or coordination between duplicate package copies.
Browser privacy-related clock precision restrictions still apply.

An explicitly supplied `Date` is preserved as-is and does not sample or advance
the generated clock. JSON reconstruction preserves the encoded timestamp rather
than replacing it with the current time.

## Development

The [flake](flake.nix) defines flake-parts with integrated devenv and direnv.
Review [`.envrc`](.envrc), then run `direnv allow .` or enter with
`nix develop`. Activation does not install dependencies, load credentials, or
change persistent shell options. Once activated, run `npm install` explicitly
through the serialized prepared-archive adapter, then run commands directly
without another direnv wrapper.

```sh
npm run lintfix
npm run build
npm test
nix build '.#checks.x86_64-linux.runtime'
```

Tests use compiled imports and run with Vitest. Local tests build incrementally;
hermetic unit checks use prebuilt output. Test flags and paths pass through
`npm test`. JUnit is written to `tmp/junit/junit.xml`; `npm test -- --coverage`
also writes Cobertura under `tmp/coverage`. `npm run lintfix` is the
active-development lint gate. `npm run lint` is reserved for non-mutating
CI/parity verification. Documentation is handwritten Markdown; there is no
TypeDoc dependency or generation command.

### Lint and formatting

MatrixAI lint comes from the selected public nixpkgs-matrixai package set, not
an npm dependency or a direct js-lint flake input. One configured tool
environment is shared by the development shell, flake formatter, and independent
hermetic lint check. The bundled CLI owns configuration; TypeScript remains a
consumer development dependency.

```sh
nix fmt
npm run lintfix
npm run lint
nix build '.#checks.x86_64-linux.lint'
```

The first two commands share the formatting authority across applicable domains,
including TypeScript, Markdown, shell, and Nix. The last two are non-mutating
verification; the Nix lint gate works without an activated development shell.

The standards submodule and profile-selected runtime skills are initialized
with:

```sh
git submodule update --init --depth 1
nix run './.matrixai/matrixai-standards#skills-materializer' -- --standards-root ./.matrixai/matrixai-standards
```

## Prepared npm archive

```sh
nix build '.#npm-package'
nix build '.#npm-package-unpacked'
nix build '.#checks.x86_64-linux.default'
nix build '.#checks.x86_64-linux.runtime'
```

The default package and `npm-package` are the archive file itself.
`npm-package-unpacked` exposes the exact contents at its root. The archive
contains compiled ESM, declarations, source maps, metadata, README, and license;
it does not bundle dependencies, a runtime, or Nix store paths into metadata.
Both the source and packed manifests retain the canonical dependency
declarations and lifecycle scripts. Ordinary npm preparation remains supported.

Evaluation-visible schema-v1 `npmPackage` and `npmDistribution` descriptors
report manifest identity, dependency metadata, source provenance, archive
output, and runtime provider candidates. The source snapshot hash is not an
archive checksum. No prepared runtime providers are advertised:
`ts-custom-error` is a normal registry dependency, while MatrixAI lint comes
from the package set.

Hermetic installs use the shared
[npm bridge](https://github.com/MatrixAI/nixpkgs-matrixai/tree/staging/lib/npm-bridge)
and its matching Node installation hook. The bridge supports reviewed runtime
Git providers, but this package needs no selected prepared archives. Lint has no
npm archive selection or consumer Git input. Source pins are not replaced with
local paths or published as Nix paths.

## Verification boundaries

The default hermetic gate aggregates the `unit-js` and independent `lint`
checks. The separate `runtime` aggregate selects `integration-browser`, which
uses the shared Playwright harness against the compiled browser bundle in a
Chromium document and dedicated worker, without builtin aliases or Node
compatibility flags. These are local browser checks, not deployed-platform or
all-browser support claims.

See [verification evidence](VERIFICATION.md) for executed results and remaining
limits. Publishing and tagging require explicit approval.
