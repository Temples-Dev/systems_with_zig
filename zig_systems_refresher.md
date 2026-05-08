# Zig for Systems Programmers
## A Complete Language Reference — 0.13.0 Base, 0.13→0.16 Migration Guide

---

> *"Zig does not hide control flow, does not hide memory allocations, does not hide errors. Every line of Zig code that does something looks like it does something."*

---

## How to Use This Document

This is a practitioner's reference, not a tutorial. It teaches every significant Zig feature through the lens of systems programming — the patterns that appear across the 18-module curriculum. Every example is grounded in something you would actually write: a network parser, a memory allocator, a concurrent data structure, a kernel interface.

**Version strategy:** All code is correct for Zig **0.13.0** — the curriculum's base version. Wherever the language or standard library changed between 0.13.0 and 0.16.0 in ways that will confuse students searching online, a clearly marked callout explains the difference. This immunizes you against the most common sources of confusion.

**Version callout format:**
> 🔄 **0.13→0.16 Change:** Description of what changed, what the old code looks like, what the new code looks like.

Install 0.13.0: https://ziglang.org/download/

```bash
zig version   # should print: 0.13.0
```

---

## Chapter 1: Variables, Types, and Values

### 1.1 Variables

```zig
const x: u32 = 42;      // immutable: cannot be reassigned
var   y: u32 = 0;        // mutable: can be reassigned
y += 1;
```

`const` is a correctness guarantee enforced by the compiler. Prefer it everywhere. Use `var` only when mutation is required. In most systems code — parsers, state machines, protocol handlers — the majority of bindings are `const`.

**Unused variables are compile errors.** Suppress explicitly with `_ = variable`:

```zig
const n = syscall_result();
_ = n; // intentionally discarding — communicates intent to reader
```

**Type inference:** Zig infers types when unambiguous:

```zig
const x = 42;            // comptime_int (no fixed size at compile time)
const y: u32 = 42;       // explicitly u32
const z = @as(u32, 42);  // explicit cast to u32
```

### 1.2 Integer Types

Zig integers are sized by bit width:

```zig
const a: u8   = 255;          // unsigned 8-bit
const b: u16  = 65_535;       // underscores for readability
const c: u32  = 4_294_967_295;
const d: u64  = 18_446_744_073_709_551_615;
const e: u128 = 0;
const f: u1   = 1;            // single bit — valid Zig type

const g: i8   = -128;         // signed (two's complement)
const h: i16  = -32_768;
const i_: i32 = -2_147_483_648;
const j: i64  = 0;

const k: usize = 0;           // pointer-sized unsigned (64-bit on x86_64)
const l: isize = -1;          // pointer-sized signed
```

**Overflow behavior — explicit in Zig:**

```zig
// Debug / ReleaseSafe builds: overflow causes a detectable panic
// ReleaseFast / ReleaseSmall builds: no checks (wraps for unsigned,
//   undefined behavior for signed — same as C)

// Explicit wrapping arithmetic: always wraps regardless of build mode
var x: u8 = 255;
x +%= 1;    // x == 0    (wrapping add)
x -%= 1;    // x == 255  (wrapping sub)
x *%= 2;    // x == 254  (wrapping mul)

// Explicit saturating arithmetic: clamps to max/min value
var y: u8 = 200;
y +|= 100;  // y == 255  (saturating add — does not overflow)
y -|= 1;    // y == 254  (saturating sub)
```

Explicit overflow operators matter for systems programming. When parsing a binary protocol or implementing a ring buffer index, you know you want wrapping. Using `+%=` instead of `+=` makes this intent visible in the code and correct in every build mode.

### 1.3 Floats, Bool, and Void

```zig
const a: f32  = 3.14;    // single precision
const b: f64  = 3.14;    // double precision (default for most math)
const c: f128 = 3.14;    // quad precision
const d: f16  = 3.14;    // half precision (GPU / embedded)

const t: bool = true;
const f_: bool = false;

fn nothing() void {}     // void return type
const v: void = {};      // void value (used in hashmaps as empty value)
```

### 1.4 Explicit Casts — The Full Table

Zig has no implicit numeric conversions. Every conversion is a visible operation at the call site:

```zig
const a: u32 = 100;

// Widening — always safe
const b: u64 = @as(u64, a);         // explicit type coercion
const c: u64 = a;                    // also valid: widening is implicit

// Narrowing — checked at runtime in safe builds
const d: u8  = @intCast(a);          // panics if a > 255 in safe builds
const e: u8  = @truncate(a);         // silently discards high bits, never panics

// Between numeric kinds
const f_: f64 = @floatFromInt(a);    // integer → float
const g: u32  = @intFromFloat(3.9);  // float → integer (truncates toward zero → 3)

// Pointer ↔ integer
const h: usize = @intFromPtr(&a);    // pointer → integer
const i_: *u32 = @ptrFromInt(h);     // integer → pointer (unsafe — you assert validity)

// Bit reinterpretation — no conversion, just reread the bits
const j: i32  = @bitCast(a);         // reinterpret u32 bits as i32
const k: [4]u8 = @bitCast(a);        // reinterpret u32 as 4 bytes

// Enum ↔ integer
const Color = enum(u8) { red = 0, green = 1, blue = 2 };
const col: Color = @enumFromInt(1);  // 1 → Color.green
const raw: u8    = @intFromEnum(col); // Color.green → 1

// Pointer type reinterpretation
const ptr: *u8    = @ptrCast(&a);    // *u32 → *u8 (reinterpret pointer type)
const aptr: *align(1) u32 = @alignCast(some_ptr); // assert + adjust alignment
```

> 🔄 **0.13→0.16 Change (0.16.0):** Small integer types (e.g. `u24`) can now coerce implicitly to `f32` without `@floatFromInt`. Larger types (e.g. `u25` and above) still require the explicit call. If you see code written for 0.16.0 that omits `@floatFromInt` for small ints, that is why.

### 1.5 The `undefined` Value

`undefined` allocates memory without initializing it:

```zig
var buf: [4096]u8 = undefined;  // space allocated, contents unpredictable
// In Debug builds: filled with 0xAA to help catch use-before-init
// Must write before read — the compiler will not catch this for you
```

Used everywhere performance matters: read buffers, temporary arrays, output parameters. Always document that the caller is responsible for initialization.

---

## Chapter 2: Control Flow

### 2.1 if / else

`if` is an expression — it returns a value:

```zig
const status = if (n > 0) "positive" else "non-positive";
```

**Unwrapping optionals:**

```zig
const maybe: ?u32 = get_optional();
if (maybe) |value| {
    use(value); // value: u32, unwrapped
} else {
    handle_null();
}
```

**Unwrapping error unions:**

```zig
if (try_operation()) |result| {
    use(result);
} else |err| {
    log_error(err);
}
```

### 2.2 switch — Exhaustive by Default

```zig
const score: u32 = get_score();
const grade = switch (score) {
    90...100 => "A",           // inclusive range
    80...89  => "B",
    70...79  => "C",
    0...69   => "D",
    else     => unreachable,   // compiler knows score is u32, else covers remaining
};
```

**Exhaustive enum switch — the backbone of state machines:**

```zig
const State = enum { idle, connecting, connected, error_state };
const s: State = .idle;

switch (s) {
    .idle        => start_connect(),
    .connecting  => check_progress(),
    .connected   => handle_data(),
    .error_state => recover(),
    // No `else` needed — all variants listed
    // Add a new variant to State → COMPILE ERROR here until handled
}
```

This is why the curriculum uses exhaustive switch as the foundation of every state machine. The compiler is your audit tool: every new state must be handled everywhere.

**Switch on tagged unions:**

```zig
const RespValue = union(enum) {
    simple_string: []const u8,
    error_msg:     []const u8,
    integer:       i64,
    bulk_string:   ?[]const u8,
    array:         ?[]RespValue,
};

const v: RespValue = .{ .integer = 42 };
switch (v) {
    .simple_string => |s| print("+{s}\r\n", .{s}),
    .error_msg     => |e| print("-{s}\r\n", .{e}),
    .integer       => |n| print(":{d}\r\n", .{n}),
    .bulk_string   => |b| if (b) |s| print("${d}\r\n{s}\r\n",
                              .{s.len, s}) else print("$-1\r\n", .{}),
    .array         => |_| print("*...\r\n", .{}),
}
```

**Mutable capture (pointer to payload):**

```zig
var v = RespValue{ .integer = 0 };
switch (v) {
    .integer => |*n| n.* += 1,  // modify payload in place
    else     => {},
}
```

> 🔄 **0.13→0.16 Change (0.14.0):** Labeled switch was introduced. You can now `continue` a switch expression with a new value, allowing switch to act as a dispatch loop — useful for state machines and bytecode interpreters:
> ```zig
> // 0.14.0+ only — does not compile on 0.13.0
> const result = sw: switch (initial_state) {
>     .start => continue :sw .processing,
>     .processing => continue :sw .done,
>     .done => "finished",
> };
> ```
> On 0.13.0: use `while (true)` + `switch` + explicit state variable to achieve the same effect.

### 2.3 while

```zig
// Basic — with continue expression (runs after each iteration, including continue)
var i: usize = 0;
while (i < 10) : (i += 1) {
    process(i);
}

// Optional — loop until null
while (iterator.next()) |item| {
    process(item);
}

// Labeled break/continue — escape nested loops
outer: while (true) {
    inner: while (true) {
        if (done) break :outer;
        if (skip) continue :outer;
    }
}
```

### 2.4 for

```zig
const data = [_]u8{ 10, 20, 30, 40 };

// Elements only
for (data) |byte| process(byte);

// Elements with index
for (data, 0..) |byte, i| print("[{d}]={d}", .{i, byte});

// Numeric range
for (0..256) |i| lut[i] = compute(@intCast(i));

// Multiple slices simultaneously (must have equal length)
for (keys, values) |k, v| map.put(k, v);

// Mutable element access
var buf = [_]u8{0} ** 16;
for (&buf) |*b| b.* = 0xFF;
```

### 2.5 defer and errdefer

`defer` executes a statement when the enclosing scope exits — by any means:

```zig
fn open_and_process(path: []const u8) !void {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close(); // runs at every exit point: return, error, panic

    const data = try file.readToEndAlloc(allocator, 1024 * 1024);
    defer allocator.free(data); // runs even if something below errors

    try process(data);
}
```

`errdefer` executes only when the scope exits with an error:

```zig
fn create_connection(allocator: std.mem.Allocator) !*Connection {
    const conn = try allocator.create(Connection);
    errdefer allocator.destroy(conn);  // only if we return an error

    try conn.init();                    // if this fails → errdefer fires
    try conn.connect();                 // if this fails → errdefer fires

    return conn;                        // success → errdefer does NOT fire
}
```

**The discipline:** Every `allocator.create` or `allocator.alloc` should be immediately followed by `errdefer allocator.destroy/free`. This is the correct ownership model. If you forget, use-after-free or leaks follow.

---

## Chapter 3: Arrays, Slices, and Pointers

### 3.1 Arrays

Fixed-size, compile-time-known:

```zig
const a: [5]u8 = .{ 1, 2, 3, 4, 5 };
const b = [_]u8{ 1, 2, 3, 4, 5 };   // [_] infers size
const c = [_]u8{0} ** 1024;          // 1024 zeros (** = repeat at comptime)
```

### 3.2 Slices

A slice is a fat pointer: data pointer + length. `[]T` is the most common type in Zig programs:

```zig
const arr = [_]u8{ 1, 2, 3, 4, 5 };
const s: []const u8 = arr[0..];     // entire array as slice
const t: []const u8 = arr[1..4];    // elements 1,2,3 (end is exclusive)
const u_ = arr[2..];                // from index 2 to end

// Slice metadata
const ptr = s.ptr;   // [*]const u8: raw pointer to first element
const len = s.len;   // usize: number of elements

// Strings are slices of bytes
const greeting: []const u8 = "hello, world";
```

**Sentinel-terminated slices** — for C interop and null-terminated strings:

```zig
const cstr: [*:0]const u8 = "hello"; // C-style: pointer, no length, null at end
const zstr: [:0]const u8  = "hello"; // Zig-style: pointer + length + null at end
```

### 3.3 Pointers

```zig
// Single-item pointer: *T
var x: u32 = 42;
const ptr: *u32 = &x;   // take address
ptr.* = 100;              // dereference and write
const val = ptr.*;        // dereference and read

// Many-item pointer: [*]T (C-style, no bounds)
const arr = [_]u8{ 1, 2, 3 };
const p: [*]const u8 = &arr;
const first = p[0];
const slice = p[0..3];   // you supply the length

// Optional pointer: ?*T
const maybe: ?*u32 = null;
if (maybe) |ptr2| ptr2.* = 42; // only dereferences if non-null
```

**`@sizeOf`, `@alignOf`, `@offsetOf`** — the three intrinsics that make `extern struct` correct:

```zig
const IpHeader = extern struct {
    version_ihl: u8,
    tos:         u8,
    total_len:   u16,
    id:          u16,
    flags_frag:  u16,
    ttl:         u8,
    protocol:    u8,
    checksum:    u16,
    src:         u32,
    dst:         u32,
    comptime { std.debug.assert(@sizeOf(IpHeader) == 20); }
};

_ = @sizeOf(IpHeader);            // 20
_ = @alignOf(IpHeader);           // 1 (no alignment requirement beyond byte)
_ = @offsetOf(IpHeader, "dst");   // 16
```

---

## Chapter 4: Structs, Enums, Unions, and Optionals

### 4.1 Structs

```zig
const Point = struct {
    x: f64,
    y: f64,

    pub fn distance(self: Point, other: Point) f64 {
        const dx = self.x - other.x;
        const dy = self.y - other.y;
        return @sqrt(dx * dx + dy * dy);
    }
};

const p = Point{ .x = 0.0, .y = 0.0 };
const q = Point{ .x = 3.0, .y = 4.0 };
const d = p.distance(q); // 5.0
```

**Default field values:**

```zig
const Config = struct {
    port:    u16  = 6380,
    timeout: u32  = 30_000,
    debug:   bool = false,
};

const cfg  = Config{};                 // all defaults
const cfg2 = Config{ .port = 9090 };   // one override
```

**`extern struct`** — C-compatible memory layout, fields in declaration order, no reordering:

```zig
// Used for: network headers, file format structures, hardware registers
const EthernetHeader = extern struct {
    dst_mac:    [6]u8,
    src_mac:    [6]u8,
    ether_type: u16,      // big-endian on the wire
    comptime { std.debug.assert(@sizeOf(EthernetHeader) == 14); }
};
```

**`packed struct`** — bit-level layout, no padding, fields packed into specified backing integer:

```zig
const Flags = packed struct(u8) {
    carry:     bool,  // bit 0
    zero:      bool,  // bit 1
    sign:      bool,  // bit 2
    overflow:  bool,  // bit 3
    _reserved: u4,    // bits 4-7
    comptime { std.debug.assert(@sizeOf(Flags) == 1); }
};
```

**`@This()`** — refer to the enclosing type, required for generic types:

```zig
fn Stack(comptime T: type) type {
    return struct {
        const Self = @This();  // Self is the anonymous struct type
        items: []T,
        top:   usize,

        pub fn push(self: *Self, item: T) void { ... }
        pub fn pop(self: *Self) ?T { ... }
    };
}
```

> 🔄 **0.13→0.16 Change (0.14.0):** Decl literals introduced. A `.name` syntax that previously could only refer to an enum variant can now refer to any `const` declaration on the target type:
> ```zig
> // 0.14.0+
> const Config = struct {
>     port: u16,
>     const default: Config = .{ .port = 8080 };
>     const init: Config = .{ .port = 0 };  // .init is now a decl literal
> };
> var c: Config = .default;  // calls Config.default
> var d: Config = .init;     // calls Config.init
> ```
> On 0.13.0: write `Config.default` or `Config{}` explicitly — the `.default` shorthand does not exist.

### 4.2 Enums

```zig
const Direction = enum { north, south, east, west };
const d: Direction = .north;

// Enum with explicit integer backing
const Opcode = enum(u8) {
    set   = 0x01,
    get   = 0x02,
    del   = 0x03,
    _,    // non-exhaustive: allows any u8 value
};
const op: Opcode = @enumFromInt(0xFF); // valid, even without a named variant
const raw: u8    = @intFromEnum(op);   // 255

// Methods on enums
const Color = enum {
    red, green, blue,
    pub fn is_primary(self: Color) bool {
        return self != .green; // (simplification)
    }
};
```

The `_` field creates a **non-exhaustive enum** — essential when parsing untrusted network data where unknown values must be handled gracefully rather than panicking.

### 4.3 Tagged Unions

```zig
// Inferred tag enum (most common)
const Token = union(enum) {
    integer:  i64,
    float:    f64,
    string:   []const u8,
    boolean:  bool,
    null_val: void,      // void: no payload needed
};

const t = Token{ .integer = 42 };

// Switch — exhaustive, payload-capturing
switch (t) {
    .integer  => |n| print("int:{d}", .{n}),
    .float    => |f| print("f64:{d}", .{f}),
    .string   => |s| print("str:{s}", .{s}),
    .boolean  => |b| print("bool:{}", .{b}),
    .null_val =>     print("null", .{}),
}

// Mutable payload via pointer capture
var t2 = Token{ .integer = 0 };
switch (t2) {
    .integer => |*n| n.* += 100,
    else     => {},
}

// Explicit tag enum (when you need to use the enum separately)
const ValueTag = enum { int, float, nil };
const Value = union(ValueTag) {
    int:   i64,
    float: f64,
    nil:   void,
};
```

### 4.4 Optionals

`?T` is either a value of type `T` or `null`:

```zig
const maybe: ?u32 = get_port();  // might be null

// Unwrap safely
if (maybe) |port| {
    connect(port);
}

// Unwrap with default
const port = maybe orelse 8080;

// Unwrap asserting non-null (panics in safe builds if null)
const port2 = maybe.?;

// Optional pointer: distinct from null pointer, zero overhead
const ptr: ?*Connection = find_connection(fd);
if (ptr) |conn| conn.send(data);
```

---

## Chapter 5: Error Handling

### 5.1 Error Sets and Error Unions

```zig
// Define an error set
const ParseError = error{
    InvalidMagic,
    TruncatedHeader,
    BodyTooLarge,
};

// Error union: !T means "ParseError or T"
fn parse_frame(buf: []const u8) !Frame {
    if (buf.len < 16) return error.TruncatedHeader;
    if (buf[0] != 0x5A) return error.InvalidMagic;
    // ...
    return frame;
}

// anyerror!T: accepts any error (common shorthand)
fn process(data: []const u8) !void {
    const frame = try parse_frame(data);
    _ = frame;
}
```

### 5.2 try, catch, and Error Propagation

**`try`** — propagate immediately on error:

```zig
fn load_config(path: []const u8) !Config {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();
    const data = try file.readToEndAlloc(allocator, 65536);
    defer allocator.free(data);
    return try parse_config(data);
}
```

`try expr` is exactly `expr catch |err| return err`. It makes the error path explicit at every step.

**`catch`** — handle inline:

```zig
// With a default value
const port = parse_port(arg) catch 8080;

// With a block
const value = operation() catch |err| {
    log.err("failed: {}", .{err});
    return default;
};

// Assert infallible (panics in safe builds if wrong)
const v = must_succeed() catch unreachable;

// Per-error handling
const result = read() catch |err| switch (err) {
    error.EndOfStream  => break,
    error.AccessDenied => return err,
    else               => return err,
};
```

**`errdefer`** with error capture:

```zig
fn init_subsystem() !*System {
    const sys = try allocator.create(System);
    errdefer |err| {
        log.err("init failed: {}", .{err});
        allocator.destroy(sys);
    }
    try sys.setup();
    return sys;
}
```

### 5.3 Error Return Traces

In Debug mode, Zig builds a trace of where errors were created and propagated:

```
error: FileNotFound
/src/config.zig:15:5: 0x... in load_config (main)
/src/main.zig:8:28: 0x... in main (main)
```

This is not a stack trace — it is an error return trace. It shows the path the error took through `try` calls. Invaluable for debugging deep error propagation.

---

## Chapter 6: Memory and Allocators

### 6.1 The Allocator Interface

Zig has no global allocator. Every function that allocates takes an explicit `std.mem.Allocator`. This is not inconvenient — it is the feature. You can see every allocation site, control memory strategy per-subsystem, and swap allocators for testing.

```zig
// The allocator interface — what callers receive
const allocator: std.mem.Allocator = ...;

// Allocate a slice
const buf = try allocator.alloc(u8, 4096);
defer allocator.free(buf);

// Allocate a single item (returns a pointer)
const item = try allocator.create(MyStruct);
defer allocator.destroy(item);

// Resize in place (returns false if not possible)
const grew = allocator.resize(buf, 8192);

// Duplicate a slice (alloc + memcpy)
const copy = try allocator.dupe(u8, original);
defer allocator.free(copy);

// Duplicate and null-terminate
const cstr = try allocator.dupeZ(u8, original);
defer allocator.free(cstr);
```

### 6.2 Allocators in the Standard Library

**`std.heap.page_allocator`** — goes directly to the OS. Allocates entire pages (typically 4KB minimum). Use for large, long-lived allocations. Slow per-call but zero overhead when you need a big slab.

```zig
const buf = try std.heap.page_allocator.alloc(u8, 64 * 1024 * 1024);
defer std.heap.page_allocator.free(buf);
```

**`std.heap.GeneralPurposeAllocator`** — the safety allocator. Detects double-free, use-after-free, and memory leaks. Use in Debug and ReleaseSafe builds:

```zig
// 0.13.0 API
var gpa = std.heap.GeneralPurposeAllocator(.{}){};
defer {
    const result = gpa.deinit();
    if (result == .leak) @panic("memory leaked");
}
const allocator = gpa.allocator();
```

> 🔄 **0.13→0.16 Change (0.14.0):** `GeneralPurposeAllocator` was renamed to `DebugAllocator`. The old name is removed. If you see 0.14.0+ code with `DebugAllocator`, this is the same type. The variable is still conventionally called `gpa` for historical reasons:
> ```zig
> // 0.14.0+ API
> var gpa: std.heap.DebugAllocator(.{}) = .init;
> defer _ = gpa.deinit();
> const allocator = gpa.allocator();
> ```
> The `.init` decl literal syntax is also new in 0.14.0 — on 0.13.0 write `= std.heap.DebugAllocator(.{}){}` (but on 0.13.0 the type was still called `GeneralPurposeAllocator`).

> 🔄 **0.13→0.16 Change (0.14.0):** `std.heap.SmpAllocator` and `std.heap.smp_allocator` were introduced. This is a high-performance, multi-threaded allocator designed for ReleaseFast. It does not exist in 0.13.0:
> ```zig
> // 0.14.0+ only — not available in 0.13.0
> const allocator = std.heap.smp_allocator;
> const buf = try allocator.alloc(u8, 1024);
> defer allocator.free(buf);
> ```
> On 0.13.0: use `page_allocator` or `c_allocator` for performance-critical paths, or link libc and use `std.heap.c_allocator`.

**`std.heap.ArenaAllocator`** — allocate freely, free everything at once. Perfect for request-scoped allocations (parse a request, build a response, free all memory together):

```zig
var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
defer arena.deinit(); // frees everything allocated through this arena

const allocator = arena.allocator();

// All allocations through `allocator` are freed by arena.deinit()
const a = try allocator.alloc(u8, 100);
const b = try allocator.alloc(u8, 200);
const c = try allocator.create(MyType);
// No individual frees needed — arena handles it all
_ = .{a, b, c};
```

**`std.heap.FixedBufferAllocator`** — allocates from a fixed buffer. Zero heap usage. Perfect for temporary calculations and embedded systems:

```zig
var backing_buf: [4096]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&backing_buf);
const allocator = fba.allocator();

const temp = try allocator.alloc(u8, 100); // from the stack buffer
```

**`std.heap.c_allocator`** — wraps `malloc`/`free`. Requires linking libc (`-lc`). Useful when interoperating with C libraries that free memory you allocate or vice versa.

**`std.testing.allocator`** — use in tests. Identical to `GeneralPurposeAllocator` but reports leaks as test failures automatically. Never use in production code.

```zig
test "my allocation" {
    const allocator = std.testing.allocator; // reports leaks automatically
    const buf = try allocator.alloc(u8, 100);
    defer allocator.free(buf);
    // ...
}
```

### 6.3 std.ArrayList

A dynamic array that grows as needed:

```zig
var list = std.ArrayList(u32).init(allocator);
defer list.deinit();

try list.append(1);
try list.append(2);
try list.append(3);

for (list.items) |item| print("{d}\n", .{item});
```

> 🔄 **0.13→0.16 Change (0.14.0 deprecated, 0.15.1 renamed):** `std.ArrayList` was deprecated in 0.14.0 and renamed to `std.array_list.Managed` in 0.15.1. The preferred replacement is `std.ArrayListUnmanaged`, which does not store the allocator internally — you pass it at each operation instead. This is the "unmanaged" pattern used throughout modern Zig:
> ```zig
> // 0.14.0+ preferred pattern
> var list: std.ArrayListUnmanaged(u32) = .{};
> defer list.deinit(allocator);
>
> try list.append(allocator, 1);
> try list.append(allocator, 2);
> ```
> On 0.13.0: `std.ArrayList` is the correct API and works fine.

### 6.4 std.StringHashMap and std.AutoHashMap

```zig
// Key: []const u8 (string)
var map = std.StringHashMap(u64).init(allocator);
defer map.deinit();

try map.put("connections", 0);
const val = map.get("connections"); // ?u64
if (map.remove("connections")) {
    // key was present and removed
}

// Key: any type with default hash/eql
var auto = std.AutoHashMap(u32, []const u8).init(allocator);
defer auto.deinit();
try auto.put(42, "forty-two");
```

> 🔄 **0.13→0.16 Change (0.14.0):** `std.ArrayHashMap` deprecated; `std.ArrayHashMapUnmanaged` becomes the preferred variant (same pattern as ArrayList above). Plain `std.HashMap` / `std.StringHashMap` / `std.AutoHashMap` are not deprecated in this cycle.

---

## Chapter 7: Comptime and Generics

### 7.1 What Comptime Means

`comptime` is Zig's single mechanism for compile-time computation, generics, conditional compilation, and code generation. There is no separate template system, no preprocessor macros, no separate metaprogramming language. Comptime runs the same Zig code at compile time.

```zig
// Comptime expression: evaluated at compile time, result is a constant
const PAGE_SIZE = comptime blk: {
    // Any Zig code can run here
    const base = 4096;
    break :blk base * 2;
};  // PAGE_SIZE = 8192, known at compile time
```

### 7.2 Comptime Parameters — Generics

Pass `type` as a comptime parameter to create generic functions:

```zig
// Generic max function — works for any comparable type
fn max(comptime T: type, a: T, b: T) T {
    return if (a > b) a else b;
}

const x = max(u32, 10, 20);    // T=u32 → specialized at compile time
const y = max(f64, 1.5, 2.5);  // T=f64 → different specialization
```

**Generic data structures — functions that return a type:**

```zig
// Convention: capitalized name signals "returns a type"
fn Pool(comptime T: type) type {
    return struct {
        const Self = @This();
        const Node = struct { value: T, next: ?*Node };

        free_list: ?*Node = null,
        allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator) Self {
            return .{ .allocator = allocator };
        }

        pub fn acquire(self: *Self) !*T {
            if (self.free_list) |node| {
                self.free_list = node.next;
                return &node.value;
            }
            const node = try self.allocator.create(Node);
            return &node.value;
        }

        pub fn release(self: *Self, value: *T) void {
            const node: *Node = @fieldParentPtr("value", value);
            node.next = self.free_list;
            self.free_list = node;
        }
    };
}

// Usage
var conn_pool = Pool(Connection).init(allocator);
const conn = try conn_pool.acquire();
defer conn_pool.release(conn);
```

### 7.3 anytype — Untyped Parameters

`anytype` accepts any type, resolved at compile time:

```zig
// The writer parameter accepts any type with a `writeAll` method
fn write_frame(writer: anytype, header: FrameHeader) !void {
    try writer.writeAll(std.mem.asBytes(&header));
}

// Works with any writer: file, buffer, socket wrapper, test mock
try write_frame(file.writer(), hdr);
try write_frame(buf_writer, hdr);
```

### 7.4 Type Reflection — @typeInfo and @Type

Inspect types at compile time with `@typeInfo`:

```zig
fn print_struct_fields(comptime T: type) void {
    const info = @typeInfo(T);
    switch (info) {
        .Struct => |s| {
            inline for (s.fields) |field| {
                std.debug.print("  field: {s}: {s}\n",
                    .{field.name, @typeName(field.type)});
            }
        },
        else => @compileError("expected a struct, got " ++ @typeName(T)),
    }
}
```

`inline for` unrolls the loop at compile time — necessary when iterating over comptime-known collections of types:

```zig
// Serialize a struct to bytes by iterating its fields at comptime
fn serialize(writer: anytype, value: anytype) !void {
    const T = @TypeOf(value);
    inline for (@typeInfo(T).Struct.fields) |field| {
        const field_val = @field(value, field.name);
        try writer.writeAll(std.mem.asBytes(&field_val));
    }
}
```

**Compile errors from comptime code:**

```zig
fn ensure_unsigned(comptime T: type) void {
    if (@typeInfo(T) != .Int or @typeInfo(T).Int.signedness != .unsigned) {
        @compileError("expected unsigned integer, got " ++ @typeName(T));
    }
}
```

### 7.5 comptime Blocks at File Scope

```zig
// Validate assumptions at compile time
comptime {
    std.debug.assert(@sizeOf(FrameHeader) == 16);
    std.debug.assert(@alignOf(FrameHeader) == 1);
}
```

This is how the curriculum's `extern struct` size assertions work: they run at compile time and produce compile errors if the struct layout is wrong.

---

## Chapter 8: The Standard Library — Essential APIs

### 8.1 std.mem — Memory Operations

```zig
const mem = std.mem;

// Copy bytes
mem.copyForwards(u8, dst, src);   // safe for overlapping (dst > src)
mem.copyBackwards(u8, dst, src);  // safe for overlapping (dst < src)

// Fill
@memset(buf, 0);                  // fill with single byte value
@memcpy(dst, src);                // copy non-overlapping regions

// Compare
const eq = mem.eql(u8, a, b);    // true if slices have same content
const order = mem.order(u8, a, b); // .lt / .eq / .gt

// Search
const idx = mem.indexOf(u8, haystack, needle);   // ?usize
const idx2 = mem.lastIndexOf(u8, haystack, needle);

// Byte-order conversion (network byte order = big-endian)
const be = mem.nativeToBig(u32, value);    // host → big-endian
const host = mem.bigToNative(u32, be_val); // big-endian → host
const le = mem.nativeToLittle(u32, value); // host → little-endian

// Read/write integers from byte slices
const n = mem.readInt(u32, buf[0..4], .big);   // big-endian u32 from 4 bytes
mem.writeInt(u32, buf[0..4], value, .little);   // write u32 little-endian

// Convert between slices and bytes
const bytes: []u8  = mem.asBytes(&my_struct);   // struct → byte slice
const typed: *MyStruct = @ptrCast(&bytes[0]);    // byte slice → struct pointer
```

### 8.2 Iterators — std.mem.split and tokenize

```zig
// splitScalar: split on a single delimiter byte
var it = std.mem.splitScalar(u8, "a,b,c", ',');
while (it.next()) |part| {
    print("{s}\n", .{part});
}
// prints: "a", "b", "c"

// tokenizeScalar: split on delimiter, skipping empty parts
var it2 = std.mem.tokenizeScalar(u8, "a,,b,,c", ',');
while (it2.next()) |part| {
    print("{s}\n", .{part});
}
// prints: "a", "b", "c" (empty parts skipped)

// splitSequence: split on a multi-byte delimiter
var it3 = std.mem.splitSequence(u8, "a\r\nb\r\nc", "\r\n");
```

> 🔄 **0.13→0.16 Change (0.14.0):** `std.mem.split` and `std.mem.tokenize` were renamed. The new names are `splitScalar` / `splitSequence` / `splitAny` and `tokenizeScalar` / `tokenizeSequence` / `tokenizeAny` — the suffix clarifies what the delimiter is. Old code using `std.mem.split(u8, str, ",")` will produce a compile error on 0.14.0+. The new API is more explicit and avoids ambiguity about whether the delimiter is a byte, a sequence, or a set.

### 8.3 std.fmt — Formatting

```zig
// Print to stderr (debug output)
std.debug.print("value={d} name={s}\n", .{42, "hello"});

// Format into a fixed buffer
var buf: [64]u8 = undefined;
const s = try std.fmt.bufPrint(&buf, "port={d}", .{8080});

// Format with heap allocation
const s2 = try std.fmt.allocPrint(allocator, "addr={s}:{d}", .{host, port});
defer allocator.free(s2);

// Parse integers
const n = try std.fmt.parseInt(u32, "12345", 10);
const hex = try std.fmt.parseInt(u32, "FF", 16);

// Parse floats
const f = try std.fmt.parseFloat(f64, "3.14");
```

**Format specifiers:**

| Specifier | Meaning |
|-----------|---------|
| `{d}` | decimal integer |
| `{x}` | lowercase hex |
| `{X}` | uppercase hex |
| `{b}` | binary |
| `{o}` | octal |
| `{s}` | string slice |
| `{c}` | single character |
| `{e}` | scientific notation float |
| `{}` | default formatting |
| `{any}` | print any type |
| `{d:>8}` | right-aligned in 8-wide field |
| `{d:0>8}` | zero-padded 8-wide field |

### 8.4 std.sort

```zig
var data = [_]u32{ 5, 2, 8, 1, 9, 3 };
std.mem.sort(u32, &data, {}, std.sort.asc(u32));
// data is now [1, 2, 3, 5, 8, 9]

std.mem.sort(u32, &data, {}, std.sort.desc(u32));
// data is now [9, 8, 5, 3, 2, 1]

// Custom comparator
std.mem.sort([]const u8, strings, {}, struct {
    fn lt(_: void, a: []const u8, b: []const u8) bool {
        return std.mem.lessThan(u8, a, b);
    }
}.lt);
```

### 8.5 std.posix — System Calls

`std.posix` exposes POSIX system calls directly. This is the correct interface in 0.12.0+:

```zig
const posix = std.posix;

// File operations
const fd = try posix.open("data.bin", .{ .ACCMODE = .RDWR }, 0);
defer posix.close(fd);
const n = try posix.read(fd, buf);
_ = try posix.write(fd, data);
try posix.fsync(fd);

// Memory mapping
const addr = try posix.mmap(null, size,
    posix.PROT.READ | posix.PROT.WRITE,
    .{ .TYPE = .SHARED }, fd, 0);
defer posix.munmap(@alignCast(addr), size);

// Networking
const sockfd = try posix.socket(posix.AF.INET, posix.SOCK.STREAM, 0);
try posix.bind(sockfd, &addr, @sizeOf(@TypeOf(addr)));
try posix.listen(sockfd, 128);
const client = try posix.accept(sockfd, null, null, 0);
```

> 🔄 **0.13→0.16 Note (pre-0.13.0):** The rename from `std.os` to `std.posix` happened in Zig 0.12.0, before 0.13.0. If you find tutorial code using `std.os.read()`, `std.os.write()`, `std.os.open()` — that is 0.11.0 or earlier code. It does not compile on 0.13.0 or later. Use `std.posix` for all POSIX system calls.

For raw Linux system calls (when you need syscalls not in `std.posix`), use `std.os.linux`:

```zig
const linux = std.os.linux;
const ret = linux.epoll_create1(linux.EPOLL_CLOEXEC);
```

---

## Chapter 9: Concurrency

### 9.1 Threads

```zig
const std = @import("std");

fn worker(arg: u32) void {
    std.debug.print("thread: arg={d}\n", .{arg});
}

pub fn main() !void {
    const t1 = try std.Thread.spawn(.{}, worker, .{1});
    const t2 = try std.Thread.spawn(.{}, worker, .{2});
    t1.join();
    t2.join();
}
```

Thread function can return `void` or `!void`:

```zig
fn worker_that_can_fail(arg: u32) !void {
    if (arg == 0) return error.InvalidArg;
    std.debug.print("arg={d}\n", .{arg});
}

const t = try std.Thread.spawn(.{}, worker_that_can_fail, .{42});
t.join();
// Note: thread errors are not automatically propagated to the joining thread
// If you need the result, use shared state (atomic, mutex-protected, or channel)
```

### 9.2 Mutex and RwLock

```zig
const SafeCounter = struct {
    mu: std.Thread.Mutex = .{},
    value: u64 = 0,

    pub fn increment(self: *SafeCounter) void {
        self.mu.lock();
        defer self.mu.unlock();
        self.value += 1;
    }

    pub fn get(self: *SafeCounter) u64 {
        self.mu.lock();
        defer self.mu.unlock();
        return self.value;
    }
};
```

**Reader-writer lock — many concurrent readers or one exclusive writer:**

```zig
const Cache = struct {
    rw: std.Thread.RwLock = .{},
    data: std.StringHashMap([]const u8),

    pub fn read(self: *Cache, key: []const u8) ?[]const u8 {
        self.rw.lockShared();
        defer self.rw.unlockShared();
        return self.data.get(key);
    }

    pub fn write(self: *Cache, key: []const u8, value: []const u8) !void {
        self.rw.lock();
        defer self.rw.unlock();
        try self.data.put(key, value);
    }
};
```

**Condition variable:**

```zig
const Queue = struct {
    mu:   std.Thread.Mutex = .{},
    cond: std.Thread.Condition = .{},
    items: std.ArrayList(u32),

    pub fn push(self: *Queue, item: u32) !void {
        self.mu.lock();
        defer self.mu.unlock();
        try self.items.append(item);
        self.cond.signal();
    }

    pub fn pop(self: *Queue) u32 {
        self.mu.lock();
        defer self.mu.unlock();
        while (self.items.items.len == 0) {  // MUST be while, not if
            self.cond.wait(&self.mu);         // atomically releases lock and sleeps
        }
        return self.items.orderedRemove(0);
    }
};
```

**Semaphore:**

```zig
var sem = std.Thread.Semaphore{ .permits = 10 }; // allow 10 concurrent
sem.wait();   // decrement (blocks if 0)
defer sem.post(); // increment (wakes a waiter)
```

### 9.3 Atomics

```zig
const atomic = std.atomic;

// Declare an atomic value
var counter: atomic.Value(u64) = atomic.Value(u64).init(0);

// Operations
_ = counter.fetchAdd(1, .monotonic);    // returns old value
_ = counter.fetchSub(1, .monotonic);
counter.store(0, .release);
const v = counter.load(.acquire);

// Compare-and-swap: the foundation of lock-free algorithms
const old = counter.cmpxchgWeak(
    expected,   // expected current value
    new_value,  // desired new value
    .acq_rel,   // success ordering
    .monotonic  // failure ordering
); // returns null on success, actual value on failure
```

**Memory ordering guide:**

| Ordering | Use when |
|----------|----------|
| `.monotonic` | Counter/statistics — no ordering needed relative to other memory |
| `.acquire` | Load: all subsequent reads see stores by the thread that did the matching `.release` |
| `.release` | Store: all prior writes are visible to any thread that does a matching `.acquire` load |
| `.acq_rel` | Read-modify-write: combines acquire and release (for CAS, swap) |
| `.seq_cst` | Strongest: global total order across all seq_cst operations. Default when unsure |

**Rule:** Use `.seq_cst` when learning. Once you understand the happens-before relationships in your code, optimize with `.acquire`/`.release` pairs.

---

## Chapter 10: Low-Level Systems Features

### 10.1 Inline Assembly

Inline assembly in Zig uses `asm volatile` with explicit input/output/clobber constraints:

```zig
// Read the RDTSC counter (x86_64: timestamp counter)
fn rdtsc() u64 {
    var lo: u32 = undefined;
    var hi: u32 = undefined;
    asm volatile ("rdtsc"
        : [lo] "=a" (lo), // output: eax → lo
          [hi] "=d" (hi)  // output: edx → hi
        :                  // no inputs
        :                  // no clobbers
    );
    return (@as(u64, hi) << 32) | lo;
}

// Read and write control register (kernel context)
fn read_cr3() u64 {
    return asm volatile ("mov %%cr3, %[result]"
        : [result] "=r" (-> u64)
        :
        : "memory"
    );
}

// Syscall with explicit register assignments
fn syscall1(number: usize, arg1: usize) usize {
    return asm volatile ("syscall"
        : [ret] "={rax}" (-> usize)
        : [num] "{rax}" (number),
          [a1]  "{rdi}" (arg1)
        : "rcx", "r11", "memory"  // syscall clobbers these
    );
}
```

**Constraint syntax:**
- `"=r"` — output: any register
- `"={rax}"` — output: specifically rax
- `"r"` — input: any register
- `"{rdi}"` — input: specifically rdi
- `"m"` — memory operand
- `"i"` — immediate constant
- `"memory"` clobber — tells compiler memory may be read/written

### 10.2 volatile

`volatile` prevents the compiler from optimizing away accesses. Essential for memory-mapped I/O and spin loops:

```zig
// Memory-mapped I/O register — must not be cached or elided
const UART_STATUS: *volatile u32 = @ptrFromInt(0x10000005);
while (UART_STATUS.* & 0x20 == 0) {}  // spin until TX ready

// Signal to CPU to pause during spin-wait (reduces power, improves performance)
std.atomic.spinLoopHint();
```

### 10.3 Packed Integers and Bitwise Operations

```zig
// Bitwise operations
const a: u32 = 0xFF00_FF00;
const b: u32 = 0x0F0F_0F0F;
const and_ = a & b;      // 0x0F00_0F00
const or_  = a | b;      // 0xFF0F_FF0F
const xor  = a ^ b;      // 0xF00F_F00F
const not  = ~a;          // 0x00FF_00FF
const shl  = a << 4;     // 0xF00_FF000
const shr  = a >> 4;     // 0x0FF0_0FF0

// Extract bits with masks
const proto: u8 = @intCast((ip_header >> 8) & 0xFF);

// Bit counting builtins
const ones  = @popCount(a);    // number of set bits
const tz    = @ctz(a);         // count trailing zeros
const lz    = @clz(a);         // count leading zeros
const log2  = std.math.log2_int(u32, a); // floor(log2(a))
```

### 10.4 Build Modes

```bash
zig build-exe src/main.zig                    # Debug (default)
zig build-exe src/main.zig -O ReleaseSafe     # optimized + safety checks
zig build-exe src/main.zig -O ReleaseFast     # maximum performance, no safety
zig build-exe src/main.zig -O ReleaseSmall    # minimize binary size
```

| Mode | Safety checks | Optimizations | Use for |
|------|--------------|---------------|---------|
| Debug | Yes (panic on UB) | None | Development, debugging |
| ReleaseSafe | Yes (panic on UB) | Yes | Production where correctness matters |
| ReleaseFast | No (UB is UB) | Aggressive | Maximum-throughput systems code |
| ReleaseSmall | No | For size | Embedded, kernel modules |

**Detecting build mode at compile time:**

```zig
const builtin = @import("builtin");

if (builtin.mode == .Debug) {
    // debug-only validation
    validate_invariants(self);
}
```

### 10.5 C Interop

Call C functions without a binding layer:

```zig
// Link libc, then call functions directly
const c = @cImport({
    @cInclude("string.h");
    @cInclude("stdio.h");
});

const len = c.strlen("hello");
_ = c.printf("len=%zu\n", len);
```

Declare external C functions manually:

```zig
extern fn malloc(size: usize) ?*anyopaque;
extern fn free(ptr: ?*anyopaque) void;
extern "c" fn memcpy(dst: ?*anyopaque, src: ?*const anyopaque, n: usize) ?*anyopaque;
```

---

## Chapter 11: Testing

### 11.1 Test Blocks

```zig
const std = @import("std");
const testing = std.testing;

fn add(a: u32, b: u32) u32 {
    return a + b;
}

test "add: basic" {
    try testing.expectEqual(5, add(2, 3));
    try testing.expectEqual(0, add(0, 0));
}

test "add: no overflow on max" {
    const result = add(std.math.maxInt(u32), 0);
    try testing.expectEqual(std.math.maxInt(u32), result);
}
```

Run tests:

```bash
zig test src/main.zig                    # run all tests in file
zig test src/main.zig --test-filter "add" # run only tests matching "add"
zig build test                           # run via build system
```

### 11.2 Testing Assertions

```zig
try testing.expect(condition);                        // true or fail
try testing.expectEqual(expected, actual);            // values equal
try testing.expectEqualSlices(u8, expected, actual);  // byte slices equal
try testing.expectEqualStrings(expected, actual);     // strings equal
try testing.expectError(error.NotFound, result);      // specific error
try testing.expectApproxEqAbs(expected, actual, tolerance); // floats
```

### 11.3 Testing with Allocators

`testing.allocator` detects memory leaks automatically:

```zig
test "no leaks" {
    const allocator = testing.allocator;
    const buf = try allocator.alloc(u8, 100);
    defer allocator.free(buf); // if you forget this, the test fails with "leak"
}
```

### 11.4 Comptime Tests

```zig
test "comptime struct size" {
    comptime {
        std.debug.assert(@sizeOf(IpHeader) == 20);
        std.debug.assert(@offsetOf(IpHeader, "dst") == 16);
    }
}
```

---

## Chapter 12: The Build System

### 12.1 build.zig Basics

```zig
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target   = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Build an executable
    const exe = b.addExecutable(.{
        .name = "zigkv",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(exe);

    // Run target: `zig build run`
    const run_cmd = b.addRunArtifact(exe);
    const run_step = b.step("run", "Run the server");
    run_step.dependOn(&run_cmd.step);

    // Test target: `zig build test`
    const tests = b.addTest(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_tests.step);
}
```

Common build commands:

```bash
zig build                    # build default artifact
zig build run                # build and run
zig build test               # build and run tests
zig build -Doptimize=ReleaseFast  # set optimization level
zig build -Dtarget=x86_64-linux-musl  # cross-compile
```

---

## Chapter 13: Version Migration Reference — 0.13.0 → 0.16.0

This chapter consolidates all the breaking changes in one place. Use it as a checklist when you encounter code written for a different version, or when upgrading your project.

### 13.1 Allocators (0.14.0)

| 0.13.0 | 0.14.0+ | Notes |
|--------|---------|-------|
| `std.heap.GeneralPurposeAllocator(.{}){}` | `std.heap.DebugAllocator(.{}) = .init` | Renamed for clarity: it's a debug tool, not a general purpose allocator |
| Does not exist | `std.heap.smp_allocator` | New high-performance multithreaded allocator for ReleaseFast; singleton global state |
| Does not exist | `std.heap.SmpAllocator` | The type backing `smp_allocator` |

**Migration pattern for allocator selection by build mode (0.14.0+):**

```zig
// The idiomatic pattern introduced in 0.14.0 — not available on 0.13.0
var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
const allocator = switch (builtin.mode) {
    .Debug, .ReleaseSafe => debug_allocator.allocator(),
    .ReleaseFast, .ReleaseSmall => std.heap.smp_allocator,
};
defer if (builtin.mode == .Debug or builtin.mode == .ReleaseSafe) {
    _ = debug_allocator.deinit();
};
```

### 13.2 Collections (0.14.0→0.15.1)

| 0.13.0 | 0.14.0 deprecated | 0.15.1+ renamed | Notes |
|--------|-------------------|-----------------|-------|
| `std.ArrayList(T)` | Deprecated | `std.array_list.Managed(T)` | Use `ArrayListUnmanaged(T)` instead |
| `std.ArrayHashMap` | Deprecated | Removed | Use `ArrayHashMapUnmanaged` |
| `std.ArrayHashMapWithAllocator` | Deprecated | Removed | Use `ArrayHashMap` (unmanaged is now default) |

**Preferred pattern (0.14.0+):**

```zig
// Unmanaged: pass allocator at each call site
var list: std.ArrayListUnmanaged(u32) = .{};
defer list.deinit(allocator);
try list.append(allocator, 42);
try list.ensureTotalCapacity(allocator, 1000);
```

### 13.3 std.mem Iterators (0.14.0)

| 0.13.0 | 0.14.0+ | Notes |
|--------|---------|-------|
| `std.mem.split(u8, str, sep)` | `std.mem.splitScalar(u8, str, sep)` | Single-byte delimiter |
| `std.mem.split(u8, str, "sep")` | `std.mem.splitSequence(u8, str, "sep")` | Multi-byte delimiter |
| `std.mem.tokenize(u8, str, sep)` | `std.mem.tokenizeScalar(u8, str, sep)` | Single-byte delimiter |
| `std.mem.tokenize(u8, str, chars)` | `std.mem.tokenizeAny(u8, str, chars)` | Any char in set |

The new names are unambiguous about what kind of delimiter is used.

### 13.4 Labeled Switch (0.14.0)

Labeled switch (`switch (x) :label { ... }` with `continue :label new_val`) was introduced in 0.14.0. This enables elegant state machine dispatch and bytecode interpreters without a separate outer loop:

```zig
// 0.14.0+ — not available on 0.13.0
const result = dispatch: switch (initial) {
    .a => continue :dispatch .b,
    .b => continue :dispatch .c,
    .c => "done",
};
```

On 0.13.0, the equivalent pattern:

```zig
var state = initial;
const result = while (true) {
    switch (state) {
        .a => state = .b,
        .b => state = .c,
        .c => break "done",
    }
};
```

### 13.5 Decl Literals (0.14.0)

Enum literal syntax (`.name`) extended to refer to any `const` declaration on the result type:

```zig
// 0.14.0+ — does not compile on 0.13.0
const Config = struct {
    port: u16,
    const default: Config = .{ .port = 8080 };
};
var c: Config = .default;  // sugar for: var c: Config = Config.default
```

Common pattern for zero-value initialization:

```zig
// 0.14.0+
var list: std.ArrayListUnmanaged(u32) = .{};   // .{} as decl literal for empty struct
var map: std.StringHashMapUnmanaged(u32) = .{};
```

On 0.13.0 the struct literal syntax `= .{}` already works for the zero-initialization case (it's an anonymous struct literal, not a decl literal). The decl literal extension (`.default`, `.init`, named decls) is the new part.

### 13.6 usingnamespace (removed in 0.15.1)

`usingnamespace` pulled all declarations from a type into the current scope:

```zig
// 0.13.0 — compiles
const S = struct {
    usingnamespace @import("std");
};
S.debug.print("hello\n", .{});
```

This was removed in 0.15.1 because it undermined Zig's traceability guarantee (every symbol should be traceable to where it was defined). If you see `usingnamespace` in code targeting 0.15.1+, replace it with explicit imports or `const name = other_module.name`.

### 13.7 ucontext_t (removed in 0.16.0)

The `ucontext_t` bindings (`getcontext`, `makecontext`, `swapcontext`) were removed from `std.posix` in 0.16.0. These were used for implementing coroutines and green threads in user space. Zig's own async/await (which was removed in 0.12.0) was its previous use. If you need context-switching coroutines on 0.16.0+, use the platform-specific assembly directly or a third-party library.

### 13.8 std.Io (0.16.0)

A new async I/O interface (`std.Io`, `std.Io.Threaded`, `std.Io.Evented`) was introduced in 0.16.0. This replaces the pattern of directly using `std.posix` for I/O in high-level application code. The 0.13.0 approach (direct `std.posix` calls) continues to work and is appropriate for systems-level code. For new application-level I/O in 0.16.0+, the `std.Io` interface is preferred.

### 13.9 Small Integer to Float Coercion (0.16.0)

In 0.16.0, integers with fewer bits than the float's significand can now coerce to float implicitly:

```zig
// 0.16.0+: implicit coercion (u24 fits in f32's 23-bit significand)
var x: u24 = 100;
var f: f32 = x;  // no @floatFromInt needed

// Still requires explicit conversion (u25 doesn't fit in f32's significand)
var y: u25 = 100;
var g: f32 = @floatFromInt(y);
```

On 0.13.0: always use `@floatFromInt` for integer-to-float conversions.

### 13.10 Summary Table

| Change | Version | Impact |
|--------|---------|--------|
| `std.os` → `std.posix` | 0.12.0 (pre-0.13.0) | High — `std.os.read()` etc. all gone |
| Explicit cast builtins (`@intFromEnum` etc.) | 0.11.0 (pre-0.13.0) | High — old `@enumToInt` gone |
| `GeneralPurposeAllocator` → `DebugAllocator` | 0.14.0 | Medium — compile error on rename |
| `SmpAllocator` introduced | 0.14.0 | Low — new API, nothing removed |
| `std.mem.split/tokenize` renamed | 0.14.0 | Medium — compile error on use |
| `std.ArrayList` deprecated | 0.14.0 | Low — warning, still works |
| Labeled switch | 0.14.0 | Low — new feature, nothing removed |
| Decl literals | 0.14.0 | Low — new feature, nothing removed |
| `std.ArrayList` renamed | 0.15.1 | High — compile error if used |
| `usingnamespace` removed | 0.15.1 | High if used — compile error |
| `ucontext_t` bindings removed | 0.16.0 | Low — niche use case |
| `std.Io` introduced | 0.16.0 | Low — new API, old patterns still work |
| Small int → float implicit coercion | 0.16.0 | Low — relaxes restrictions |

---

## Appendix: Quick Reference Cards

### Built-in Functions — Systems Programming Subset

```zig
// Type operations
@sizeOf(T)            // size in bytes
@alignOf(T)           // alignment requirement
@offsetOf(T, "field") // byte offset of field in struct
@typeInfo(T)          // std.builtin.Type tagged union
@TypeOf(expr)         // type of expression
@typeName(T)          // []const u8 type name
@This()               // enclosing struct/union/enum type
@Type(info)           // create type from @typeInfo

// Casts
@as(T, val)           // type coercion (safe widening)
@intCast(val)         // narrowing integer cast (checked)
@truncate(val)        // narrowing integer (unchecked)
@bitCast(val)         // reinterpret bits
@ptrCast(ptr)         // reinterpret pointer type
@alignCast(ptr)       // assert and adjust alignment
@intFromPtr(ptr)      // pointer → usize
@ptrFromInt(addr)     // usize → pointer
@floatFromInt(val)    // integer → float
@intFromFloat(val)    // float → integer (truncates)
@intFromEnum(val)     // enum → integer
@enumFromInt(val)     // integer → enum
@intFromBool(b)       // bool → 0 or 1

// Memory
@memcpy(dst, src)     // copy non-overlapping slices
@memset(dst, val)     // fill slice with value

// Bit operations
@popCount(val)        // count set bits
@clz(val)             // count leading zeros
@ctz(val)             // count trailing zeros
@bitReverse(val)      // reverse bit order

// Compile-time
@compileLog(vals...)  // print at compile time (debugging)
@compileError("msg")  // emit compile error
@import("file.zig")   // import module
@cImport({...})       // import C headers
@embedFile("file")    // embed file contents as []const u8
@field(val, "name")   // access field by runtime-known name
@hasField(T, "name")  // check if type has field
@fieldParentPtr("field", ptr) // get container from field pointer
```

### Allocator Cheatsheet

```zig
// 0.13.0 — development/debug
var gpa = std.heap.GeneralPurposeAllocator(.{}){};
defer _ = gpa.deinit();
const allocator = gpa.allocator();

// 0.14.0+ — development/debug
var gpa: std.heap.DebugAllocator(.{}) = .init;
defer _ = gpa.deinit();
const allocator = gpa.allocator();

// 0.14.0+ — production multithreaded
const allocator = std.heap.smp_allocator;

// Any version — arena (bulk-free)
var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
defer arena.deinit();
const allocator = arena.allocator();

// Any version — fixed buffer (stack memory)
var buf: [N]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&buf);
const allocator = fba.allocator();

// Tests — any version
const allocator = std.testing.allocator; // leak detection built in
```

### Common Patterns

```zig
// Read-to-end with ownership
const data = try file.readToEndAlloc(allocator, max_size);
defer allocator.free(data);

// Format with allocation
const s = try std.fmt.allocPrint(allocator, "{s}:{d}", .{host, port});
defer allocator.free(s);

// Convert int ↔ bytes
const bytes: [4]u8 = @bitCast(some_u32);
const val: u32 = @bitCast(some_bytes);

// Network byte order
const be = std.mem.nativeToBig(u16, port);
const host_port = std.mem.bigToNative(u16, be);

// Write int into buffer at offset
std.mem.writeInt(u32, buf[offset..][0..4], value, .big);
const n = std.mem.readInt(u32, buf[offset..][0..4], .big);

// Optional unwrap with default
const port = maybe_port orelse 8080;
const val = maybe_val orelse return error.Missing;

// Error propagation
const result = try risky_operation();
const result2 = risky_operation() catch |err| {
    log(err);
    return err;
};
```

---

*This document covers Zig 0.13.0 as the base with explicit migration notes for all breaking changes through 0.16.0. The curriculum modules are written against 0.13.0 patterns except where noted.*
