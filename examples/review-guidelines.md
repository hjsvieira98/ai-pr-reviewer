# Review guidelines

Use this file to add project-specific rules. The action treats it as untrusted data, same as the diff.

- TypeScript changes should preserve strict null checks.
- New branching behavior needs a test that would fail if the branch were removed.
- Do not accept string-built SQL, shell commands, or HTML.
- Flag unbounded loops over database calls.

Keep this file short. Only the first 6,000 characters are sent.
