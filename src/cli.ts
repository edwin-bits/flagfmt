#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseLenient, normalizeFlags, formatCanonical } from "./index.js";

function printUsage(): void {
  process.stdout.write(
    [
      "usage: flagfmt [file]",
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
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    printUsage();
    return;
  }

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

  process.stdout.write(formatCanonical(result.flags));
}

main();
