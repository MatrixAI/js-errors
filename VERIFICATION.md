# Verification

## Scope

The modernization retains the existing public error API, synchronous
construction, and one compiled ESM package. Unit regressions cover generated and
supplied timestamps, capability changes, restricted clocks, JSON reconstruction,
typed causes, and aggregate error graph traversal. No runtime adapter is
installed by the library.

## Commands and artifacts

- `npm run check` verifies types, unit tests, lint, and packed-package behavior.
- `npm run test:browser` verifies the packed package in Chromium document and
  dedicated-worker realms.
- `nix build '.#checks.x86_64-linux.default'` runs routine hermetic verification
  through `verify`.
- `nix build '.#checks.x86_64-linux.runtime'` selects the independent
  `integration-browser` environment adapter.
- `nix build '.#npm-package'` builds the verbatim prepared archive.
- `nix build '.#npm-package-unpacked'` builds its exact unpacked view.

Checkout artifacts live under `tmp/junit`, `tmp/coverage`,
`tmp/package-candidate`, and `tmp/integration-browser`. Check derivations retain
a root report and an artifacts directory. Failed runs are not successful
evidence; support claims must identify the commands and environments actually
executed.

## Execution evidence

### 2026-11-01 modernization

Executed on x86_64-linux with Node.js 24.15.0, TypeScript 5.9.3, MatrixAI lint
1.0.1, Playwright 1.59.1, and Nix-provided Chromium 147.0.7727.15:

| Surface                | Result                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development activation | Standards submodule initialized on master, profile-selected skills materialized, direnv authorized, integrated shell activated.                                                                                                                                                                       |
| Autofix                | `npm run lintfix` passed across JS/TS, Markdown, shell, and Nix.                                                                                                                                                                                                                                      |
| TypeScript             | `npm run typecheck` passed with aligned NodeNext configuration.                                                                                                                                                                                                                                       |
| Unit regressions       | `npm test -- --runInBand --coverage` passed 28 tests in two suites. V8 coverage of the emitted clock module was 100% statements and branches; overall emitted-module statement coverage was 97.16%.                                                                                                   |
| Packed package         | Canonical manifest bytes, root/submodule exports, declarations without Node ambient types, and browser bundling without aliases passed.                                                                                                                                                               |
| Browser realms         | Packed-package errors, timestamps, JSON reconstruction, inheritance, and cause-graph traversal passed in a Chromium document and dedicated worker.                                                                                                                                                    |
| Routine hermetic gate  | `nix build '.#checks.x86_64-linux.default'` passed with retained verification reports and artifacts.                                                                                                                                                                                                  |
| Runtime hermetic gate  | `nix build '.#checks.x86_64-linux.runtime'` passed with retained browser cases and bundle-input metadata.                                                                                                                                                                                             |
| Producer outputs       | Both prepared outputs built. Every archive file matched its unpacked counterpart, and the packed manifest matched the source byte-for-byte. Schema-v1 descriptors matched canonical runtime declarations and Node engines and reported dirty-checkout provenance without claiming a release revision. |

The prepared lint producer remained selected by Git tag v1.0.1 and resolved
commit `bae774a6617b20d688de550d36c4e481fb8f9f69`. Hermetic derivations used its
prepared archive through importNpmLock and the matching installation hook.
Installer behavior is not part of the errors test suite.

These are local Linux and Chromium results. No deployed Cloudflare, alternate
browser engine, Windows, or macOS evidence is implied. At that modernization
stage, no package was published or tagged. A later downstream integration run is
separate from these errors-package proof nodes.

## Downstream diagnostic, not a released integration

After the errors-only gates passed, an isolated copy of the container checkout
was tested against the prepared unpublished errors archive. The copied
dependency tree received the archive; only the copy had its browser clock alias
and shim fixture removed. The actual container checkout, Git index, manifests,
lockfile, and existing shim remained unchanged.

The isolated copy passed typechecking, 95 unit tests, packed-package checks, and
the container-source import boundary check. Full browser compatibility was not
established: all three browser cases stopped at bundling because the separate
timer dependency, version 2.1.1, still imports the Node performance module.
Removing the errors clock import does not make that transitive timer portable.

This diagnostic is not an installation test, a hermetic container proof, an
updated consumer pin, or evidence of a released errors version. The errors
manifest version remained 2.1.3 during that uncommitted modernization. That
diagnostic did not authorize a consumer update or release.

## Git-only release 3.0.0

The Node 24 minimum is released as a major version. The portable clock and
verbatim Nix archive contract are retained. The final 3.0.0 routine and browser
gates passed before release preparation. The archive and unpacked outputs also
built successfully. It is not published to npm. The legacy tag-triggered npm
publishing workflow is removed to keep Git-only releases from invoking registry
publication.
