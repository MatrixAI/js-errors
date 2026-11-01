# js-errors

Exception system with typed causes, extensible JSON encoding/decoding, and
cycle-safe traversal of error and aggregate-error graphs.

## Installation

```sh
npm install --save @matrixai/errors
```

```ts
import { AbstractError, utils } from '@matrixai/errors';

class RequestError<T = unknown> extends AbstractError<T> {
  public static description = 'Request failed';
}

const cause = new TypeError('Invalid input');
const error = new RequestError('Could not process request', { cause });
utils.checkError(error, (value) => value === cause);
```

Subclasses inherit the static description, message, stack, data, cause, and
timestamp contracts. JSON reconstruction is class-directed: call the matching
class's `fromJSON`. Custom fields or recursive cause decoding remain the
subclass/application's responsibility; arbitrary objects are not automatically
reconstructed as exception classes.

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
`nix develop`. Activation installs dependencies through a serialized
prepared-archive adapter; it does not load credentials or change persistent
shell options. Once activated, run commands directly without another direnv
wrapper.

```sh
npm run lintfix
npm run build
npm run typecheck
npm test -- --runInBand
npm run check:package
npm run test:browser
npm run check
```

Tests build first, use compiled imports, and run Jest/SWC in ESM mode. Test
flags and paths pass through `npm test`. JUnit is written to
`tmp/junit/junit.xml`; `npm test -- --runInBand --coverage` also writes
Cobertura under `tmp/coverage`. `npm run lintfix` is the active-development lint
gate. `npm run lint` is reserved for non-mutating CI/parity verification.
Documentation is handwritten Markdown; there is no TypeDoc dependency or
generation command.

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
`ts-custom-error` is a normal registry dependency, while MatrixAI lint is
development-only.

The [dependency adapter](nix/npm-sources.nix) selects lint's exact locked Git
revision and validates producer metadata before using its prepared archive.
Hermetic installs use importNpmLock and its matching Node installation hook.
Local installs use the same selected archive and restore canonical manifests
after temporary install-only overrides, including failure recovery. Source pins
are not replaced with local paths or published as Nix paths.

## Verification boundaries

The default hermetic gate aggregates routine `verify` checks. A separate
`runtime` aggregate selects the independent `integration-browser` check. Each
retains a machine-readable report and artifacts. Verification runs types,
build-first unit tests, non-mutating lint, and packed-package checks. Browser
integration executes the packed package in a real Chromium document and
dedicated worker, without builtin aliases or Node compatibility flags. These are
local browser checks, not deployed-platform or all-browser support claims.

The [package checker](scripts/check-package.mjs) compares the packed manifest
byte-for-byte, checks exports and declarations without Node ambient types, and
bundles for the browser without aliases. Its consumer reconstructs the declared
runtime dependency from the lockfile-installed dependency tree. This is not
evidence of a fresh recursive application installation.

See [verification evidence](VERIFICATION.md) for executed results and remaining
limits. Publishing and tagging require explicit approval.
