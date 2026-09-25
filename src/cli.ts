#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseLenient, normalizeFlags, formatCanonical } from "./index.js";

function printUsage(): void {
  process.stdout.write(
    [
      "usage: flagfmt [--check | --write] [file | dir | glob ...]",
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
      "A directory or a glob pattern (using * and ?) expands to every",
      "matching .json file. Directories are searched recursively:",
      "",
      "  flagfmt --check config/flags/",
      "  flagfmt --check 'config/flags/*.json'",
      "",
      "Normalizing more than one file at a time isn't supported yet, so",
      "directory and glob arguments only work together with --check.",
      "",
      "--check reports whether the input is already in canonical form",
      "instead of printing it. It writes nothing to stdout and exits",
      "with status 1 if any input would change, 0 if none would:",
      "",
      "  flagfmt --check flags.json",
      "",
      "--write normalizes a single file in place instead of printing to",
      "stdout. It requires exactly one file argument (stdin can't be",
      "written back to):",
      "",
      "  flagfmt --write flags.json",
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

function isGlobPattern(path: string): boolean {
  return path.includes("*") || path.includes("?");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const ch of pattern) {
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(source + "$");
}

function expandGlob(pattern: string): string[] {
  const dir = dirname(pattern) || ".";
  if (!existsSync(dir)) return [];
  const filePattern = globToRegExp(basename(pattern));
  return readdirSync(dir)
    .filter((name) => filePattern.test(name))
    .map((name) => join(dir, name))
    .sort();
}

function listJsonFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files.sort();
}

// Expands directory and glob arguments into concrete file paths. Plain file
// paths (including ones that don't exist) pass through unchanged so the
// existing "no such file" error from readFileSync still surfaces normally.
function resolveInputs(args: string[]): string[] {
  const resolved: string[] = [];
  for (const arg of args) {
    if (isGlobPattern(arg)) {
      resolved.push(...expandGlob(arg));
      continue;
    }
    if (existsSync(arg) && statSync(arg).isDirectory()) {
      resolved.push(...listJsonFilesRecursive(arg));
      continue;
    }
    resolved.push(arg);
  }
  return resolved;
}

// Runs the parse -> normalize -> format pipeline on one file (or stdin).
// Returns the canonical output plus whether the source already matched it,
// or null if the file failed to parse/normalize (an error has already been
// printed to stderr).
function process_(path: string | undefined): { source: string; canonical: string } | null {
  const source = readInput(path);

  let parsed: unknown;
  try {
    parsed = parseLenient(source);
  } catch (err) {
    process.stderr.write(`flagfmt: ${path ?? "(stdin)"}: parse error: ${(err as Error).message}\n`);
    return null;
  }

  let result: ReturnType<typeof normalizeFlags>;
  try {
    result = normalizeFlags(parsed);
  } catch (err) {
    process.stderr.write(`flagfmt: ${path ?? "(stdin)"}: ${(err as Error).message}\n`);
    return null;
  }

  for (const warning of result.warnings) {
    process.stderr.write(`flagfmt: ${path ?? "(stdin)"}: warning: ${warning}\n`);
  }

  return { source, canonical: formatCanonical(result.flags) };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const check = args.includes("--check");
  const write = args.includes("--write");
  const positional = args.filter((a) => a !== "--check" && a !== "--write");
  const files = positional.length > 0 ? resolveInputs(positional) : [];

  if (check && write) {
    process.stderr.write("flagfmt: --check and --write can't be used together\n");
    process.exitCode = 1;
    return;
  }

  if (positional.length > 0 && files.length === 0) {
    process.stderr.write(`flagfmt: no files matched ${positional.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  if (write && files.length !== 1) {
    process.stderr.write("flagfmt: --write requires exactly one file argument\n");
    process.exitCode = 1;
    return;
  }

  if (files.length > 1 && !check) {
    process.stderr.write(
      "flagfmt: multiple input files given; only --check supports more than one file right now\n"
    );
    process.exitCode = 1;
    return;
  }

  if (files.length > 1) {
    let anyChanged = false;
    for (const file of files) {
      const outcome = process_(file);
      if (outcome === null) {
        anyChanged = true;
        continue;
      }
      if (outcome.source !== outcome.canonical) {
        process.stderr.write(`flagfmt: ${file} is not canonical\n`);
        anyChanged = true;
      }
    }
    process.exitCode = anyChanged ? 1 : 0;
    return;
  }

  const path = files[0];
  const outcome = process_(path);
  if (outcome === null) {
    process.exitCode = 1;
    return;
  }

  if (check) {
    if (outcome.source !== outcome.canonical) {
      process.stderr.write(`flagfmt: ${path ?? "(stdin)"} is not canonical\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (write) {
    if (outcome.source !== outcome.canonical) {
      writeFileSync(path!, outcome.canonical);
    }
    return;
  }

  process.stdout.write(outcome.canonical);
}

main();
