# Public-boundary check

`scripts/check-public-boundary.mjs` is a dependency-free pre-commit and pre-release guard. It inspects tracked and non-ignored files when Git is available; before repository initialization it scans the intended public tree while excluding known local-only planning and generated paths.

It fails on:

- forbidden tracked paths and secret-bearing file types;
- source/data fields that could represent raw OAuth or session secrets;
- common credential and private-key signatures;
- email, phone, private account-ID, and personal home-path patterns;
- text files too large for the bounded scanner.

## Usage

```sh
node scripts/check-public-boundary.mjs --self-test
node scripts/check-public-boundary.mjs
```

The first command verifies that all four detector classes catch seeded unsafe examples while accepting a safe synthetic fixture. The second scans the current public candidate set and exits non-zero if it finds a violation.

## Limits

The check is intentionally conservative but pattern-based. Binary files are listed for manual metadata/licence review rather than parsed. Before release, also run a full-history secret scanner, an independent personal-information scan, dependency and licence review, and a human review of every tracked file and asset.
