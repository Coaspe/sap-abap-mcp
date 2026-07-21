# v1/all Default and Windows Live Test Plan

1. Change contract tests so omitted API/toolsets mean v1/all; run the focused
   tests and confirm they fail against the old defaults.
2. Change only the API parser, tool-selection resolver, and server-factory
   fallback; make legacy tests request `apiVersion: "v0"` explicitly.
3. Update public migration/README/Windows guidance so normal registration uses
   only `serve --profile B4D`, while documenting the optional subset and legacy
   escapes.
4. Add a separate tracked Korean Windows prompt that builds a complete
   113-tool ledger and enforces create-receipt plus immediate-read-back
   ownership before every `$TMP` mutation.
5. Add deterministic documentation tests for the new default and prompt safety
   invariants, then run the complete build, test suite, stdio smoke, and exact
   surface counts.
6. Stage only the intended files, verify the two protected documents remain
   excluded, commit, and push the current branch.
