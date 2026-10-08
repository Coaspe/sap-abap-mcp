# Maintained security backports

These private source distributions preserve this project's SAP SDK 4.9.1 and ADT 8.4.1 support while upstream security releases are unavailable. They retain the upstream licenses and use distinct `@coaspe/*-security-backport` names. They are not official upstream releases.

- node-forge: the 1.4.0 registry source receives the nested DigestAlgorithm count and empty NULL checks reviewed in upstream PR 1157, commit `683ab3344899cc08a581e4d5675a33e87aff7b04`. Its RSA, PSS, native signature and PKCS12 behavior is regression tested. The full upstream unit suite passes 837 tests, with four upstream pending tests.
- sprintf-js: the 1.1.3 source clamps numeric e/f/g precision to the ECMAScript-supported range. Normal SAP URI `%s` substitution and valid numeric formats retain their behavior.
- Mermaid: retain the 11.16.1 core ESM runtime and declarations, depend on official KaTeX 0.18.2, and rebuild `assets/mermaid.min.js`. Old browser bundles containing KaTeX 0.16.x are excluded. The single reviewed browser asset is also included in the standalone MCPB bundle.

`security-backports.json` records registry tarball integrity, the changed runtime hashes and patch scope. Parent SDK/ADT packages and their patched descendants are bundled so fresh consumer installations use the same code even with `--ignore-scripts`. No npm override, audit exception, postinstall patch or fabricated upstream version is used.

The registry audit does not independently review private forks. A zero audit count alone does not prove these fixes: unpatched upstream fixtures must fail the regression and the installed consumer must pass both the behavioral tests and `npm run verify:backports`.

To rebuild the browser asset after a reviewed dependency update:

```sh
npx --yes esbuild@0.27.2 vendor/mermaid/dist/mermaid.core.mjs --bundle --minify --platform=browser --format=iife --global-name=__sapMermaid --footer:js='globalThis.mermaid=__sapMermaid.default;' --metafile=vendor/mermaid/browser-build-inputs.json --outfile=assets/mermaid.min.js
```

Review source integrity and licenses, rerun regressions, regenerate reviewed hashes, pack and install into an empty consumer, and verify the runtime resolution from jks-js and abap-adt-api. Remove a backport only when the corresponding official dependency release and browser bundle have been verified against the same regressions. Updating a private fork without these checks is not a security fix.

Primary references: [RSA advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [upstream RSA review](https://github.com/digitalbazaar/forge/pull/1157), [sprintf advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), [KaTeX fix](https://github.com/KaTeX/KaTeX/commit/0adf7e77db6915d991803b29699f82b1ccf8d4f4).

`npm run audit:backports` also queries OSV for the original registry source versions. A new advisory or a change to a reviewed advisory fails the release gate, so private package names cannot hide future upstream findings. Reviewed IDs correspond to patched behavior and exact review timestamps, not unmitigated exceptions.
