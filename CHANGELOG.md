# Changelog

## Unreleased

## 0.4.0 - 2026-06-15

### Added

- Added folder database resource proxies so `db.users.find()` and
  `db.settings.get()` work alongside callable controls such as
  `db.collection('users')`, with `db._` as the explicit control namespace.
- Added `file.patch()` and `patchFile()` helpers for atomic in-place JSON file
  updates that preserve existing object key order.

## 0.3.0 - 2026-06-15

### Added

- Added stable JSON helpers: `stableStringify`, `parseJson`, `stableJson`, and
  `registerJson`.
- Added a vendored JSON5 parser flow so JSON5-compatible parsing ships without
  a runtime `json5` dependency.

## 0.2.0 - 2026-06-15

### Added

- Added standalone database identity support with `identity.fields`, `idField`
  compatibility, scalar keys for single-field resources, canonical object keys
  for compound resources, duplicate-key detection, declared local indexes, and
  RedisJSON key layout based on canonical identity objects.
- Added append-only collection policy support through `append()`, with
  update/delete/replace-all writes rejected for log resources.
- Added encoded bytes metadata and validation for `base64`, `base64url`, and
  `hex` strings.
- Added generated `@async/pipeline` preview, snapshot, publish, GitHub Packages
  mirror, and release-doctor jobs so releases publish through GitHub Actions.

## 0.1.0

- Initial package scaffold for JSON file/folder database APIs and RedisJSON store support.
