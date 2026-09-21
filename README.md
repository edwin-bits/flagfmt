# flagfmt

Feature-flag files rot. They get hand-edited by different people over a
couple of years and end up with three different casings for the same flag
(`newCheckout`, `new_checkout`, `NEW-CHECKOUT`), booleans spelled as `"yes"`
or `1` instead of `true`, trailing commas, stray comments explaining why a
flag exists, and keys in whatever order they were typed. None of that is
wrong, exactly, but it makes diffs noisy and makes it easy to accidentally
define the same flag twice under two different names.

`flagfmt` reads a flag file and writes back a canonical version: keys
normalized to `lower-kebab-case`, obviously-boolean values coerced to real
booleans, keys sorted alphabetically, consistent indentation. It's meant to
run as a pre-commit check or CI step so flag files stay diffable.

## Example

Input (`flags.json`):

```jsonc
{
  // rollout for the new checkout flow
  "NewCheckout": "true",
  'beta_search': "yes",
  ENABLE_DARK_MODE: 1,
  "old-flag": false,
}
```

```
$ flagfmt flags.json
{
  "beta-search": true,
  "enable-dark-mode": true,
  "new-checkout": true,
  "old-flag": false
}
```

Comments, trailing commas, unquoted keys, and single-quoted strings are all
accepted on the way in; none of them survive on the way out, since the
output is strict JSON.

Values that aren't unambiguously boolean (percentages, variant names,
nested objects) are left exactly as they were - flagfmt normalizes shape,
it doesn't guess at what a flag's value means.

## Usage

```
flagfmt flags.json > flags.json.tmp && mv flags.json.tmp flags.json
cat flags.json | flagfmt
```

With no file argument, `flagfmt` reads from stdin. That's the primary way
it's meant to be used in a pipeline, e.g. piping a flag file fetched from a
remote config store straight through the formatter before diffing it
against what's checked in.

Use `--check` to verify a file is already canonical without printing
anything. It exits 1 if formatting the file would change it (wrong key
order, non-boolean-typed booleans, comments, whatever), 0 if it wouldn't.
Useful as a CI step or pre-commit hook:

```
flagfmt --check flags.json
```

`--check` also accepts a directory or a glob pattern, to sweep a whole repo
of flag files in one CI step. Directories are searched recursively for
`.json` files; globs support `*` and `?`:

```
flagfmt --check config/flags/
flagfmt --check 'config/flags/*.json'
```

It exits 1 if any matched file isn't canonical, printing which ones to
stderr. Normalizing (rather than just checking) more than one file at a
time isn't supported yet - that needs an in-place write mode, which is next
on the list.

If two keys normalize to the same name (`newCheckout` and `new_checkout` in
the same file, say), flagfmt keeps the later one and prints a warning to
stderr rather than failing outright.

## Building

There's no build output checked in. Compile with any TypeScript compiler:

```
tsc
node dist/cli.js flags.json
```

## Status

Early. The normalization rules above are the ones implemented so far; see
the issues for what's planned next.
