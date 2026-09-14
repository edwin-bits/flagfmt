#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseLenient, normalizeFlags, formatCanonical } from "./index.js";

function printUsage(): void {
  process.stdout.write(
    [
      "usage: flagfmt [--check] [file]",
      "",
      "Reads a feature-flag definition file and writes a canonical,",
      "alphabetically-sorted JSON version of it to stdout.",
      "",
      "The input may be plain JSON or a looser dialect commonly found in",
      "hand-edited flag files: // and /* */ comments, trailing commas,",
      "unquoted keys, and single-quoted strings are all accepted.",
      "",
      "If no file is given, input is read from stdin:",
      "",
      "  flagfmt flags.json > flags.normalized.json",
      "  cat flags.json | flagfmt",
      "",
      "--check reports whether the input is already in canonical form",
      "instead of printing it. It writes nothing to stdout and exits",
      "with status 1 if the input would change, 0 if it wouldn't:",
      "",
      "  flagfmt --check flags.json",
      "",
    ].join("\n")
  );
}

function readInput(path: string | undefined): string {
  if (path) return readFileSync(path, "utf8");
  if (process.stdin.isTTY) {
    process.stderr.write("flagfmt: no input file given and stdin is a terminal\n");
    process.exit(1);
  }
  return readFileSync(0, "utf8");
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const check = args.includes("--check");
  const arg = args.find((a) => a !== "--check");

  const source = readInput(arg);

  let parsed: unknown;
  try {
    parsed = parseLenient(source);
  } catch (err) {
    process.stderr.write(`flagfmt: parse error: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  let result: ReturnType<typeof normalizeFlags>;
  try {
    result = normalizeFlags(parsed);
  } catch (err) {
    process.stderr.write(`flagfmt: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  for (const warning of result.warnings) {
    process.stderr.write(`flagfmt: warning: ${warning}\n`);
  }

  const canonical = formatCanonical(result.flags);

  if (check) {
    if (source !== canonical) {
      process.stderr.write(`flagfmt: ${arg ?? "(stdin)"} is not canonical\n`);
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(canonical);
}

main();
