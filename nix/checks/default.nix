{
  pkgs,
  nodejs,
  system,
  gitignore,
  npmDependencies,
}:
let
  src = gitignore.gitignoreSource ../..;
  inherit (npmDependencies) npmDeps npmConfigHook;
  runtimeInputs = {
    inherit
      pkgs
      nodejs
      system
      src
      npmDeps
      npmConfigHook
      ;
  };
  integration-browser = import ./integration-browser.nix runtimeInputs;
  verify = pkgs.buildNpmPackage {
    pname = "errors-verify";
    version = "0.1.0";
    inherit
      src
      nodejs
      npmDeps
      npmConfigHook
      ;
    nativeBuildInputs = [
      pkgs.nixfmt
    ];
    dontNpmBuild = true;
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      npm run check
      runHook postCheck
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/artifacts"
      cp -R tmp/junit "$out/artifacts/junit"
      cp -R tmp/package-candidate "$out/artifacts/package"
      cat > "$out/report.json" <<EOF
      {
        "schemaVersion": 1,
        "name": "verify",
        "kind": "conformance",
        "status": "passed",
        "system": "${system}",
        "summary": "Types, Jest/SWC unit tests, lint, emitted package, and portable browser bundle passed",
        "artifacts": {
          "junit": "artifacts/junit",
          "package": "artifacts/package/report.json"
        }
      }
      EOF
      runHook postInstall
    '';
  };
in
{
  inherit verify;
  inherit integration-browser;
  runtime = pkgs.runCommand "errors-check-runtime" { } ''
    mkdir -p "$out/artifacts"
    ln -s ${integration-browser} "$out/artifacts/integration-browser"
    cat > "$out/report.json" <<EOF
    {
      "schemaVersion": 1,
      "name": "runtime",
      "kind": "aggregate",
      "status": "passed",
      "system": "${system}",
      "summary": "Chromium document and dedicated-worker integration passed; not deployed-platform evidence",
      "artifacts": {
        "browser": "artifacts/integration-browser/report.json"
      }
    }
    EOF
  '';
  default = pkgs.runCommand "errors-check-default" { } ''
    mkdir -p "$out/artifacts"
    ln -s ${verify} "$out/artifacts/verify"
    cat > "$out/report.json" <<EOF
    {
      "schemaVersion": 1,
      "name": "default",
      "kind": "aggregate",
      "status": "passed",
      "system": "${system}",
      "summary": "Routine errors verification passed",
      "artifacts": { "verify": "artifacts/verify/report.json" }
    }
    EOF
  '';
}
