// Lenient parser + normalizer for feature-flag config files.
//
// The parser accepts a superset of JSON, because real flag files that get
// hand-edited over time accumulate: // and /* */ comments, trailing commas,
// unquoted keys, and single-quoted strings. Strict JSON.parse rejects all
// of that, so we tokenize and parse it ourselves.

type Token =
  | { type: "brace-open" | "brace-close" | "bracket-open" | "bracket-close" | "colon" | "comma" | "eof" }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "ident"; value: string };

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$-]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const peekChar = (offset = 0) => source[i + offset];

  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "/" && peekChar(1) === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && peekChar(1) === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && peekChar(1) === "/")) i++;
      if (i >= source.length) throw new Error("unterminated block comment");
      i += 2;
      continue;
    }

    if (ch === "{") { tokens.push({ type: "brace-open" }); i++; continue; }
    if (ch === "}") { tokens.push({ type: "brace-close" }); i++; continue; }
    if (ch === "[") { tokens.push({ type: "bracket-open" }); i++; continue; }
    if (ch === "]") { tokens.push({ type: "bracket-close" }); i++; continue; }
    if (ch === ":") { tokens.push({ type: "colon" }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma" }); i++; continue; }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = "";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          const next = source[i + 1];
          const escapes: Record<string, string> = {
            n: "\n", t: "\t", r: "\r", '"': '"', "'": "'", "\\": "\\", "/": "/",
          };
          value += next in escapes ? escapes[next] : next;
          i += 2;
        } else {
          value += source[i];
          i++;
        }
      }
      if (i >= source.length) throw new Error("unterminated string literal");
      i++;
      tokens.push({ type: "string", value });
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "-") i++;
      while (i < source.length && /[0-9.eE+-]/.test(source[i])) i++;
      const text = source.slice(start, i);
      const value = Number(text);
      if (Number.isNaN(value)) throw new Error(`invalid number literal "${text}"`);
      tokens.push({ type: "number", value });
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i;
      while (i < source.length && IDENT_PART.test(source[i])) i++;
      tokens.push({ type: "ident", value: source.slice(start, i) });
      continue;
    }

    throw new Error(`unexpected character "${ch}" at position ${i}`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  parse(): unknown {
    const value = this.parseValue();
    if (this.peek().type !== "eof") {
      throw new Error("unexpected trailing content after top-level value");
    }
    return value;
  }

  private parseValue(): unknown {
    const token = this.peek();
    switch (token.type) {
      case "brace-open": return this.parseObject();
      case "bracket-open": return this.parseArray();
      case "string": this.next(); return token.value;
      case "number": this.next(); return token.value;
      case "ident":
        this.next();
        if (token.value === "true") return true;
        if (token.value === "false") return false;
        if (token.value === "null") return null;
        throw new Error(`unexpected identifier "${token.value}"`);
      default:
        throw new Error(`unexpected token while reading a value`);
    }
  }

  private parseObject(): Record<string, unknown> {
    this.next(); // consume {
    const result: Record<string, unknown> = {};
    if (this.peek().type === "brace-close") {
      this.next();
      return result;
    }
    while (true) {
      const keyToken = this.next();
      let key: string;
      if (keyToken.type === "string" || keyToken.type === "ident") {
        key = keyToken.value;
      } else {
        throw new Error("expected object key");
      }
      const colon = this.next();
      if (colon.type !== "colon") throw new Error('expected ":" after object key');
      result[key] = this.parseValue();

      const after = this.peek();
      if (after.type === "comma") {
        this.next();
        if (this.peek().type === "brace-close") {
          this.next();
          break;
        }
        continue;
      }
      if (after.type === "brace-close") {
        this.next();
        break;
      }
      throw new Error('expected "," or "}" in object');
    }
    return result;
  }

  private parseArray(): unknown[] {
    this.next(); // consume [
    const result: unknown[] = [];
    if (this.peek().type === "bracket-close") {
      this.next();
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      const after = this.peek();
      if (after.type === "comma") {
        this.next();
        if (this.peek().type === "bracket-close") {
          this.next();
          break;
        }
        continue;
      }
      if (after.type === "bracket-close") {
        this.next();
        break;
      }
      throw new Error('expected "," or "]" in array');
    }
    return result;
  }
}

export function parseLenient(source: string): unknown {
  return new Parser(tokenize(source)).parse();
}

// "NewCheckout" / "some_key" / "SOME-KEY" all become "new-checkout" style
// keys, so a flag isn't scattered under three different spellings.
export function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");
}

const TRUE_STRINGS = new Set(["true", "yes", "on", "1"]);
const FALSE_STRINGS = new Set(["false", "no", "off", "0"]);

// Only coerces values that unambiguously spell out a boolean. Anything else
// (percentages, variant names, nested config) passes through untouched,
// because a formatter shouldn't guess at flag semantics.
export function coerceBooleanish(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (TRUE_STRINGS.has(lowered)) return true;
    if (FALSE_STRINGS.has(lowered)) return false;
  }
  return value;
}

export interface NormalizeResult {
  flags: Record<string, unknown>;
  warnings: string[];
}

export function normalizeFlags(parsed: unknown): NormalizeResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("flags file must contain a top-level object of flag-name -> value");
  }

  const warnings: string[] = [];
  const byNormalizedKey = new Map<string, { originalKey: string; value: unknown }>();

  for (const [originalKey, rawValue] of Object.entries(parsed)) {
    const key = normalizeKey(originalKey);
    if (byNormalizedKey.has(key)) {
      const previous = byNormalizedKey.get(key)!;
      warnings.push(
        `"${previous.originalKey}" and "${originalKey}" both normalize to "${key}"; keeping the later value`
      );
    }
    byNormalizedKey.set(key, { originalKey, value: coerceBooleanish(rawValue) });
  }

  const flags: Record<string, unknown> = {};
  for (const key of [...byNormalizedKey.keys()].sort()) {
    flags[key] = byNormalizedKey.get(key)!.value;
  }

  return { flags, warnings };
}

export function formatCanonical(flags: Record<string, unknown>): string {
  return JSON.stringify(flags, null, 2) + "\n";
}
