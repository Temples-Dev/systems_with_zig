import type { LanguageFn } from "highlight.js";

// highlight.js language definition for Zig
const zig: LanguageFn = (_hljs) => ({
  name: "Zig",
  aliases: ["zig"],
  keywords: {
    keyword:
      "const var fn pub if else while for return try catch defer errdefer " +
      "struct enum union switch comptime inline extern export usingnamespace test " +
      "async await suspend resume break continue error packed align allowzero volatile callconv " +
      "and or orelse",
    type:
      "void bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 usize isize " +
      "f16 f32 f64 f128 anyerror anytype noreturn type comptime_int comptime_float",
    literal: "null undefined true false unreachable",
  },
  contains: [
    // Line comments
    { className: "comment", begin: /\/\//, end: /$/ },
    // Block comments
    { className: "comment", begin: /\/\*/, end: /\*\// },
    // Strings
    { className: "string", begin: /"/, end: /"/, contains: [{ begin: /\\[nrt0"\\]/ }] },
    // Multi-line strings
    { className: "string", begin: /\\\\/, end: /$/ },
    // Char literals
    { className: "string", begin: /'/, end: /'/ },
    // Builtins like @import, @sizeOf
    { className: "built_in", begin: /@[a-zA-Z_]\w*/ },
    // Numbers: hex, binary, octal, decimal, float
    {
      className: "number",
      variants: [
        { begin: /\b0x[0-9a-fA-F_]+/ },
        { begin: /\b0b[01_]+/ },
        { begin: /\b0o[0-7_]+/ },
        { begin: /\b\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?/ },
      ],
    },
    // Labels like `blk:`
    { className: "symbol", begin: /\b[a-zA-Z_]\w*(?=\s*:)/ },
  ],
});

export default zig;
