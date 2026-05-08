# Module 4: Memory — Ownership, Allocation, and the Cost of Getting It Wrong

## The Craft of Systems Programming — Teaching Material

---

> *"Memory safety bugs — use-after-free, double-free, buffer overflows — account for more than 65% of critical security vulnerabilities in major software systems. Not because programmers are careless. Because memory is genuinely hard to reason about without the right mental model."*

---

## Before You Begin

Module 3 showed you the virtual address space from the outside — how the OS creates it, how the loader populates it, how `strace` reveals what's happening. This module goes inside. You are now going to understand memory the way a systems programmer must: not as an abstraction that "just works," but as a resource you are responsible for acquiring, tracking, and releasing.

This is the module where Zig's design philosophy becomes most visible. Every design decision in Zig's memory model — explicit allocators, no global malloc, errors as values, `defer` for cleanup — exists because getting memory wrong in production systems is catastrophic. You will understand not just how to use Zig's memory tools, but *why* they exist and what bugs they prevent.

By the end of this module you will be able to write Zig code that manages heap memory correctly, choose the right allocator for any situation, reason about ownership without a garbage collector, and diagnose the full class of memory bugs that cause most security vulnerabilities in C and C++ programs.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain the difference between stack and heap memory with precision: lifetime, cost, size limits, and appropriate use cases
- Use `std.heap.DebugAllocator` to detect memory leaks, use-after-free, and double-free bugs
- Use `std.heap.ArenaAllocator` for request-scoped allocations and understand when it is the right choice
- Use `std.heap.FixedBufferAllocator` for allocation without touching the heap
- Implement a data structure that manages its own memory correctly using the allocator interface
- Explain what memory ownership means and identify which component owns a given allocation in any piece of code
- Diagnose and explain use-after-free, double-free, memory leak, and buffer overflow at the machine level
- Implement a working slab allocator and explain how it reduces fragmentation compared to a general-purpose allocator
- Measure the performance difference between different allocator strategies on a representative workload

---

## Part 1: Stack vs Heap — A Precise Comparison

### 1.1 The Stack: Automatic, Fast, Limited

You have used the stack in every program you have ever written, even if you did not call it that. Every local variable, every function argument, every return address lives on the stack. The stack is managed by the processor itself — it is not a software construct, it is a hardware-supported region of memory with a dedicated register (`rsp`) pointing to its top.

The stack's defining characteristic is **automatic lifetime**: variables live exactly as long as the scope that created them. When a function returns, its entire stack frame is discarded — all its local variables vanish — by a single instruction (`add rsp, N` or `pop rbp`). This is both its greatest strength and its primary limitation.

**Advantages of the stack:**
- Zero-cost allocation: incrementing `rsp` is one instruction
- Zero-cost deallocation: decrementing `rsp` is one instruction
- Perfect cache locality: the stack is almost always in L1 cache
- No fragmentation possible
- No bookkeeping overhead

**Limitations of the stack:**
- Fixed maximum size (typically 8 MB per thread on Linux)
- Lifetime is bound to the enclosing scope
- Size must be known at compile time (in the general case)

The size limit is real and consequential. Allocating a 10 MB array as a local variable will overflow the stack silently on most systems:

```zig
fn bad_idea() void {
    var huge: [10 * 1024 * 1024]u8 = undefined; // 10 MB on the stack!
    // On Linux with 8 MB stack limit, this crashes with SIGSEGV
    _ = huge;
}
```

The correct approach for large data is always the heap.

### 1.2 The Heap: Flexible, Manual, Slower

The heap is the region of memory used for allocations whose size or lifetime cannot be determined at compile time. Unlike the stack, heap memory has no implicit lifetime — it persists until explicitly freed, regardless of which function allocated it or what the call stack looks like when it is freed.

This flexibility comes at a cost:

**Advantages of the heap:**
- Arbitrary size (limited only by available virtual memory)
- Arbitrary lifetime: data persists until explicitly freed
- Size can be determined at runtime

**Costs of the heap:**
- Allocation requires searching for a free block (O(1) to O(n) depending on allocator)
- Bookkeeping metadata must be stored alongside each allocation
- Potential for fragmentation over time
- Manual lifetime management — the programmer is responsible for freeing

The cost difference between stack and heap allocation is not academic. A stack allocation is a single register increment taking less than 1 nanosecond. A heap allocation requires the allocator to find a suitable free block, update its internal data structures, and return a pointer — typically 50-500 nanoseconds under normal conditions, potentially much longer under fragmentation or contention.

### 1.3 A Side-by-Side Comparison

```zig
const std = @import("std");

pub fn main() !void {
    // Stack allocation: compile-time known size, automatic cleanup
    var stack_array: [100]u8 = undefined;
    stack_array[0] = 42;
    // stack_array is freed automatically when main() returns

    // Heap allocation: requires allocator, explicit cleanup
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const heap_array = try allocator.alloc(u8, 100);
    defer allocator.free(heap_array); // MUST free explicitly
    heap_array[0] = 42;

    // Stack allocation: runtime size NOT possible in Zig
    // (unlike C's VLAs, which Zig deliberately omits)
    // const n = get_size_from_user();
    // var dynamic: [n]u8 = undefined; // COMPILE ERROR in Zig

    // Heap allocation: runtime size is fine
    const n: usize = 100;
    const dynamic = try allocator.alloc(u8, n); // n determined at runtime
    defer allocator.free(dynamic);
    _ = dynamic;

    std.debug.print("stack addr:  0x{X}\n", .{@intFromPtr(&stack_array)});
    std.debug.print("heap addr:   0x{X}\n", .{@intFromPtr(heap_array.ptr)});
}
```

Run this and observe the addresses. Stack addresses are high (near `0x7fff...`). Heap addresses are lower (typically starting around `0x55...` or wherever `mmap` places them).

### 1.4 When to Use Each

A clear decision rule:

**Use the stack when:**
- The size is known at compile time
- The data only needs to live within the current function (or a callee)
- The data is small enough to fit comfortably (a few kilobytes at most)

**Use the heap when:**
- The size is not known until runtime
- The data needs to outlive the function that creates it
- The data is large (more than a few kilobytes)
- You need a dynamically-growing collection

In Zig, there are no surprise heap allocations. If a function allocates from the heap, it takes an `Allocator` parameter — making the allocation visible and explicit at every call site.

---

## Part 2: Zig's Allocator Model

### 2.1 No Global Allocator — By Design

C's `malloc` and `free` are global functions. Any code can call `malloc` at any time without declaring that it does so. This creates invisible coupling: a function that "doesn't allocate" might call a function that does, which calls another that does. In a complex system, tracking heap ownership becomes an archaeology project.

Zig has no global allocator. There is no `malloc`. Every function that needs to allocate memory takes an `std.mem.Allocator` parameter explicitly. This one design decision:

- Makes allocating functions visible at their call sites
- Allows callers to control allocation strategy (debug, arena, fixed buffer, etc.)
- Makes testing trivial: pass `std.testing.allocator` to detect leaks
- Allows the same code to work in environments where heap allocation is impossible (kernels, embedded systems)

The `std.mem.Allocator` is an interface — a struct containing function pointers and a context pointer. Different allocator implementations satisfy this interface. The caller never needs to know which allocator is behind the interface.

### 2.2 The Allocator Interface

The core allocator operations:

```zig
// Allocate a slice of n items of type T
fn alloc(allocator: Allocator, comptime T: type, n: usize) ![]T

// Free a previously allocated slice
fn free(allocator: Allocator, slice: anytype) void

// Allocate a single item of type T (returns a pointer, not a slice)
fn create(allocator: Allocator, comptime T: type) !*T

// Free a single item allocated with create()
fn destroy(allocator: Allocator, ptr: anytype) void

// Resize a previously allocated slice
fn realloc(allocator: Allocator, old_mem: anytype, new_n: usize) ![]ElementType
```

The difference between `alloc`/`free` (for slices) and `create`/`destroy` (for single items):

```zig
// Allocating a slice (multiple items)
const buf = try allocator.alloc(u8, 1024);  // []u8 of length 1024
defer allocator.free(buf);

// Allocating a single item
const value = try allocator.create(u64);    // *u64
defer allocator.destroy(value);
value.* = 42;
```

### 2.3 DebugAllocator — Your Development Companion

`std.heap.DebugAllocator` (renamed from `GeneralPurposeAllocator` in Zig 0.16.0) is the allocator you use during development. It wraps an underlying allocator (typically `page_allocator`) with a layer of debugging instrumentation:

**In Debug builds:**
- Tracks every allocation and every free
- Detects memory leaks on `deinit()` — reports every allocation that was not freed, with the stack trace of where it was allocated
- Detects use-after-free — accessing freed memory triggers a panic with a helpful error message
- Detects double-free — freeing the same pointer twice triggers a panic
- Fills freed memory with a poison pattern (0xaa by default) to make use-after-free more likely to cause immediate crashes rather than silent corruption

**The leak report:**

```zig
const std = @import("std");

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer {
        const result = gpa.deinit();
        if (result == .leak) @panic("memory leak detected");
    }
    const allocator = gpa.allocator();

    // Deliberately leak memory
    _ = try allocator.alloc(u8, 100); // no defer allocator.free(...)
    // When deinit() runs, it reports the leak with the allocation stack trace
}
```

Run this and examine the output. The `DebugAllocator` will print something like:

```
error(gpa): memory address 0x7f... leaked:
/path/to/main.zig:9:38: 0x...
    _ = try allocator.alloc(u8, 100);
```

The stack trace points exactly to the allocation that was not freed. In a large codebase, this is invaluable.

**Initialization syntax in 0.16.0:**

```zig
// Correct initialization in Zig 0.16.0:
var gpa: std.heap.DebugAllocator(.{}) = .init;

// The .{} is the configuration struct (with all defaults)
// .init is the designated initializer
// gpa must be var (not const) because deinit() modifies its state
```

### 2.4 ArenaAllocator — Many Allocations, One Free

The `ArenaAllocator` is the right tool when you have a group of allocations that all share the same lifetime — they should all be freed together when some bounded operation completes.

Classic examples: parsing a configuration file, processing an HTTP request, compiling a function, loading a level in a game. These all involve many allocations whose lifetime is "as long as this operation takes."

```zig
const std = @import("std");

fn parse_request(backing_allocator: std.mem.Allocator,
                 raw: []const u8) !void {
    // Create an arena for all allocations during this request
    var arena = std.heap.ArenaAllocator.init(backing_allocator);
    defer arena.deinit(); // ONE call frees everything allocated during parsing

    const allocator = arena.allocator();

    // Now allocate freely — no need to track individual frees
    const headers = try allocator.alloc(u8, 512);
    const body = try allocator.alloc(u8, raw.len);
    const parsed_fields = try allocator.alloc([]const u8, 16);

    // Process the request using headers, body, parsed_fields...
    _ = headers;
    _ = body;
    _ = parsed_fields;
    _ = raw;

    // When arena.deinit() runs (via defer), ALL allocations are freed
    // No need to track and free headers, body, parsed_fields individually
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();

    const raw_request = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
    try parse_request(gpa.allocator(), raw_request);
}
```

**How the ArenaAllocator works internally:**

The arena maintains a linked list of large buffers obtained from its child allocator. Each `alloc()` call bumps a pointer within the current buffer. When the buffer is full, a new larger buffer is obtained from the child allocator. `free()` on an individual allocation is a no-op — the memory is not actually freed until `deinit()` frees all buffers at once.

This makes arena allocation extremely fast: individual allocations are pointer-bump operations taking a few nanoseconds, with no free-list traversal.

**In Zig 0.16.0, ArenaAllocator is thread-safe and lock-free** — it can be shared across threads for concurrent allocation (though individual allocations are not atomic, so proper synchronization is still needed for shared state).

### 2.5 FixedBufferAllocator — No Heap Required

The `FixedBufferAllocator` allocates from a fixed-size buffer you provide. It does not call into the OS, does not use mmap, and does not touch the heap at all. It is the allocator for environments where heap allocation is forbidden or undesirable: kernels, embedded systems, real-time code, or anywhere where allocation latency must be zero and bounded.

```zig
const std = @import("std");

pub fn main() !void {
    // Buffer on the stack — no heap involvement at all
    var stack_buffer: [4096]u8 = undefined;
    var fba = std.heap.FixedBufferAllocator.init(&stack_buffer);
    const allocator = fba.allocator();

    // Allocate from the stack buffer
    const a = try allocator.alloc(u8, 100);
    const b = try allocator.alloc(u32, 10);

    // When the buffer runs out, alloc() returns error.OutOfMemory
    // (not a crash — a recoverable error)
    const huge = allocator.alloc(u8, 8192) catch |err| {
        std.debug.print("allocation failed: {}\n", .{err});
        return;
    };
    _ = huge;

    _ = a;
    _ = b;
    // No need to free — buffer is on the stack, goes away with the frame
}
```

The `FixedBufferAllocator` can also be used with a heap-allocated buffer when you want predictable allocation behavior with a heap backing:

```zig
// 1 MB heap-backed fixed buffer
const buffer = try backing_allocator.alloc(u8, 1024 * 1024);
defer backing_allocator.free(buffer);
var fba = std.heap.FixedBufferAllocator.init(buffer);
```

**The `reset()` method:** Unlike other allocators, `FixedBufferAllocator` can be reset to its initial state, allowing the buffer to be reused:

```zig
// Process many small requests using the same buffer, one at a time
for (requests) |req| {
    fba.reset(); // reset the allocator to the start of the buffer
    const allocator = fba.allocator();
    try process_request(allocator, req);
    // all allocations from this request are now gone after reset()
}
```

### 2.6 SmpAllocator — Production Performance

For production code where performance matters and debugging overhead is not needed, `std.heap.smp_allocator` is available in Zig 0.16.0. It is a high-performance, thread-safe, general-purpose allocator designed for multi-threaded applications:

```zig
// No initialization needed — it's a global singleton
const allocator = std.heap.smp_allocator;
const buf = try allocator.alloc(u8, 1024);
defer allocator.free(buf);
```

**Typical pattern in production code:**

```zig
pub fn main() !void {
    // Debug builds: use DebugAllocator for leak/corruption detection
    // Release builds: use smp_allocator for performance
    var debug_allocator: std.heap.DebugAllocator(.{}) = .init;
    const allocator, const is_debug = if (@import("builtin").mode == .Debug)
        .{ debug_allocator.allocator(), true }
    else
        .{ std.heap.smp_allocator, false };

    defer if (is_debug) {
        _ = debug_allocator.deinit();
    };

    // Use allocator throughout the program
    _ = allocator;
}
```

### 2.7 Choosing the Right Allocator

| Situation | Allocator |
|-----------|-----------|
| Development/debugging | `DebugAllocator` |
| Request-scoped work (parsing, processing) | `ArenaAllocator` |
| Kernel/embedded/no-heap environments | `FixedBufferAllocator` |
| Production general-purpose | `smp_allocator` |
| Testing | `std.testing.allocator` |
| Wrapping an existing C allocator | `std.heap.c_allocator` |

---

> **Exercise 4.1: Allocator Benchmarking**
>
> Write a benchmark that measures the time to perform 10,000 allocations of 128 bytes each followed by 10,000 frees, using:
> 1. `DebugAllocator`
> 2. `ArenaAllocator` (backed by `page_allocator`)
> 3. `FixedBufferAllocator` (with a 2 MB stack buffer)
>
> For the Arena, measure the time including the final `deinit()`.
> Report the time per allocation+free cycle for each.
>
> Expected result: `FixedBufferAllocator` is fastest (no OS involvement), `ArenaAllocator` is close, `DebugAllocator` is slowest (tracking overhead).

---

## Part 3: Ownership — The Central Concept

### 3.1 What Ownership Means

**Ownership** is the responsibility to free an allocation exactly once, at the right time, by the right code path.

Every heap allocation has exactly one owner. The owner is responsible for calling `free()` (or `deinit()`, `destroy()`, etc.) on that allocation. If no one frees it — memory leak. If two components both try to free it — double-free. If the owner frees it but other code still holds a pointer to it — use-after-free.

Zig does not enforce ownership at compile time (unlike Rust). The programmer is responsible for ensuring it. But Zig's `DebugAllocator` detects violations at runtime in Debug builds, catching mistakes before they reach production.

### 3.2 Ownership Patterns

**Pattern 1: Caller Owns**

The function allocates and returns to the caller, who is responsible for freeing:

```zig
/// Caller owns the returned slice and must free it.
fn load_file(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();

    const size = (try file.stat()).size;
    const buf = try allocator.alloc(u8, size);
    // NOTE: if readAll fails, we have a leak! Must handle errors carefully:
    errdefer allocator.free(buf); // free on error path
    _ = try file.readAll(buf);
    return buf; // caller now owns buf
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const contents = try load_file(allocator, "/etc/hostname");
    defer allocator.free(contents); // caller frees
    std.debug.print("{s}\n", .{contents});
}
```

The `errdefer` is critical: if `readAll` fails after `alloc` succeeds, `errdefer` ensures the allocation is freed on the error path. Without it, a failed read would leak the buffer.

**Pattern 2: Self-Owning Data Structures**

A data structure allocates in `init()` and frees in `deinit()`:

```zig
const StringBuffer = struct {
    data: []u8,
    len: usize,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, capacity: usize) !StringBuffer {
        const data = try allocator.alloc(u8, capacity);
        return .{ .data = data, .len = 0, .allocator = allocator };
    }

    pub fn deinit(self: *StringBuffer) void {
        self.allocator.free(self.data); // self frees its own allocation
    }

    pub fn append(self: *StringBuffer, s: []const u8) !void {
        if (self.len + s.len > self.data.len) return error.BufferFull;
        @memcpy(self.data[self.len..][0..s.len], s);
        self.len += s.len;
    }

    pub fn slice(self: StringBuffer) []const u8 {
        return self.data[0..self.len];
    }
};

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();

    var buf = try StringBuffer.init(gpa.allocator(), 256);
    defer buf.deinit(); // symmetric: init allocates, deinit frees

    try buf.append("Hello, ");
    try buf.append("World!");
    std.debug.print("{s}\n", .{buf.slice()});
}
```

The `init`/`deinit` pattern is idiomatic Zig. The allocator is stored in the struct so `deinit()` can free without needing the allocator passed again. This is the pattern used by `std.ArrayList`, `std.HashMap`, and most other standard library data structures.

**Pattern 3: Arena-Owned (No Individual Frees)**

When all allocations share the lifetime of an arena, nothing needs to track or free individual allocations:

```zig
const ParsedConfig = struct {
    host: []const u8,
    port: u16,
    keys: [][]const u8,
};

fn parse_config(allocator: std.mem.Allocator,
                input: []const u8) !ParsedConfig {
    // All allocations here are owned by the arena passed in
    // No need for any deinit() calls within this function
    const host = try allocator.dupe(u8, "localhost");
    const keys = try allocator.alloc([]const u8, 4);
    keys[0] = try allocator.dupe(u8, "key1");
    keys[1] = try allocator.dupe(u8, "key2");
    _ = input;

    return .{ .host = host, .port = 8080, .keys = keys[0..2] };
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();

    var arena = std.heap.ArenaAllocator.init(gpa.allocator());
    defer arena.deinit(); // frees everything from parse_config

    const config = try parse_config(arena.allocator(), "...");
    std.debug.print("host: {s}, port: {d}\n", .{config.host, config.port});
    // config.host and config.keys are freed when arena.deinit() runs
}
```

### 3.3 The `defer` and `errdefer` Pattern

Zig's `defer` and `errdefer` are the primary tools for ensuring allocations are freed:

- `defer stmt` — runs `stmt` when the current block exits, regardless of how (normal return, error return, or early return)
- `errdefer stmt` — runs `stmt` only when the block exits via an error

The golden rule: **every `alloc()` or `create()` should be immediately followed by a `defer free()` or `defer destroy()`**, unless the function is intentionally returning the allocation to the caller (in which case, use `errdefer` for the error path).

```zig
fn do_work(allocator: std.mem.Allocator) !void {
    // Allocate A
    const a = try allocator.alloc(u8, 100);
    defer allocator.free(a); // A freed on any exit from this function

    // Allocate B — if this fails, A is freed by its defer
    const b = try allocator.alloc(u8, 200);
    defer allocator.free(b); // B freed on any exit from this function

    // Use a and b...
    _ = a;
    _ = b;
} // Both a and b freed here (in reverse order of declaration)
```

---

> **Exercise 4.2: Ownership Transfer**
>
> The following function has a bug in its error handling. Find it and fix it:
>
> ```zig
> fn create_pair(allocator: std.mem.Allocator) !struct { a: []u8, b: []u8 } {
>     const a = try allocator.alloc(u8, 100);
>     const b = try allocator.alloc(u8, 200); // if this fails, what happens to a?
>     return .{ .a = a, .b = b };
> }
> ```
>
> After fixing it, write a caller that uses `create_pair` correctly, ensuring both allocations are freed.

---

> **Answer 4.2**
>
> The bug: if `allocator.alloc(u8, 200)` fails (returning `error.OutOfMemory`), the function returns an error — but `a` was already allocated and is now leaked.
>
> Fix using `errdefer`:
>
> ```zig
> fn create_pair(allocator: std.mem.Allocator) !struct { a: []u8, b: []u8 } {
>     const a = try allocator.alloc(u8, 100);
>     errdefer allocator.free(a); // free a if anything below fails
>
>     const b = try allocator.alloc(u8, 200);
>     // No errdefer for b here — if we get here, we return successfully
>     // and the caller owns both a and b
>
>     return .{ .a = a, .b = b };
> }
>
> pub fn main() !void {
>     var gpa: std.heap.DebugAllocator(.{}) = .init;
>     defer _ = gpa.deinit();
>     const allocator = gpa.allocator();
>
>     const pair = try create_pair(allocator);
>     defer allocator.free(pair.a); // caller owns both
>     defer allocator.free(pair.b);
>
>     std.debug.print("a.len={d}, b.len={d}\n", .{pair.a.len, pair.b.len});
> }
> ```

---

## Part 4: Memory Bugs — Understanding What Goes Wrong

### 4.1 The Class of Memory Bugs

The four fundamental memory bugs in systems programming:

1. **Memory leak** — allocate, never free
2. **Use-after-free** — free, then access
3. **Double-free** — free the same allocation twice
4. **Buffer overflow/underflow** — access beyond the allocated range

Use-after-free, double-free, and heap buffer overflows collectively account for the majority of critical security vulnerabilities in C and C++ software. They are not exotic edge cases — they are the natural consequence of manual memory management without adequate tooling or discipline.

Zig's `DebugAllocator` catches the first three at runtime. Zig's bounds checking (in Debug mode) catches the fourth. Understanding what each bug looks like at the machine level helps you recognize them and design code that avoids them.

### 4.2 Memory Leak — Silent Exhaustion

A leak occurs when an allocation is never freed. In a short-lived program, leaks are harmless — the OS reclaims all memory when the process exits. In a long-running server or daemon, leaks cause the process to slowly consume more and more memory until it is killed by the OS or becomes unresponsive.

```zig
const std = @import("std");

// BUGGY: leaks on every call
fn leaky_function(allocator: std.mem.Allocator) ![]u8 {
    const buf = try allocator.alloc(u8, 1024);
    // ... does some work with buf ...
    const result = try allocator.alloc(u8, 32);
    @memcpy(result[0..5], "hello");
    // BUG: buf is never freed — leaks 1024 bytes per call
    return result;
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer {
        const status = gpa.deinit();
        std.debug.print("leak status: {}\n", .{status});
    }
    const allocator = gpa.allocator();

    const result = try leaky_function(allocator);
    defer allocator.free(result);

    std.debug.print("{s}\n", .{result});
}
// Output: "leak status: leak"
// And DebugAllocator prints where the leaked allocation occurred
```

### 4.3 Use-After-Free — Silent Corruption

Use-after-free is one of the most dangerous bugs in systems programming. After a block of memory is freed, the allocator may reuse it for another allocation. A pointer that still refers to the freed region now points to whatever was placed there by the new allocation — or to the allocator's internal metadata.

Reading from freed memory returns garbage data. Writing to it corrupts whatever the allocator stored there, which typically manifests as a crash far from the actual bug — because the corrupted data is the allocator's bookkeeping, which breaks on the next allocation or free.

```zig
const std = @import("std");

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const buf = try allocator.alloc(u8, 16);
    buf[0] = 42;

    allocator.free(buf); // buf is now freed

    // BUG: accessing freed memory
    // DebugAllocator fills freed memory with 0xaa (in Debug mode)
    // so we read 0xaa instead of 42
    std.debug.print("value after free: {d}\n", .{buf[0]});
    // In Debug mode: panics with "use after free"
    // In ReleaseFast: returns garbage — silent corruption
}
```

The `DebugAllocator`'s poison pattern (0xaa) is deliberately chosen because 0xaaaa... is an obviously invalid value for most data types — a pointer to 0xaaaaaaaaaaaaaa is unmapped, an integer value of 0xaa is suspicious, a float of 0xaaaa... is NaN. This increases the chance that use-after-free causes an immediate, visible crash in Debug mode rather than silent corruption.

### 4.4 Double-Free — Heap Corruption

Freeing the same allocation twice corrupts the allocator's internal free-list. After the first free, the allocator considers the block available and may insert a pointer to it in its free-list. The second free tries to insert it again, creating a cycle in the free-list. The next allocation may then receive a block that is already in-use — two parts of the program believe they own the same memory.

```zig
const std = @import("std");

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const buf = try allocator.alloc(u8, 64);

    allocator.free(buf); // correct free

    // BUG: freeing again
    // DebugAllocator: panics with "double free detected"
    // Without DebugAllocator: corrupts heap allocator metadata
    allocator.free(buf);
}
```

Double-free commonly occurs when ownership is ambiguous — two components both think they own an allocation and both call free. The fix is always clarity about ownership: one owner, one free.

### 4.5 Buffer Overflow — Writing Beyond Bounds

A buffer overflow writes past the end of an allocated region, corrupting whatever comes next in memory. On the stack, this might overwrite a return address (the classic stack smashing attack). On the heap, this overwrites adjacent heap metadata or another allocation's data.

```zig
const std = @import("std");

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const buf = try allocator.alloc(u8, 8);
    defer allocator.free(buf);

    // BUG: writing past the end of the allocation
    // In Debug mode: Zig's bounds check panics: "index out of bounds"
    // In ReleaseFast without safety: silently corrupts heap metadata
    for (0..16) |i| {
        buf[i] = @intCast(i); // panics at i=8 in Debug mode
    }
}
```

Zig's bounds checking in Debug and ReleaseSafe modes catches this immediately. In ReleaseFast mode (which disables safety checks for maximum performance), a bounds overflow is as silent and dangerous as in C. This is why you should always test in Debug mode and only switch to ReleaseFast once correctness is established.

### 4.6 Detecting Bugs with DebugAllocator

Here is a complete demonstration of how `DebugAllocator` catches all four bug types:

```zig
const std = @import("std");

pub fn demonstrate_leak(allocator: std.mem.Allocator) !void {
    _ = try allocator.alloc(u8, 100);
    // deliberately not freed
}

pub fn demonstrate_use_after_free(allocator: std.mem.Allocator) !void {
    const buf = try allocator.alloc(u8, 16);
    allocator.free(buf);
    _ = buf[0]; // DebugAllocator detects this
}

pub fn demonstrate_double_free(allocator: std.mem.Allocator) !void {
    const buf = try allocator.alloc(u8, 16);
    allocator.free(buf);
    allocator.free(buf); // DebugAllocator detects this
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer {
        const result = gpa.deinit();
        if (result == .leak) {
            std.debug.print("leaks detected!\n", .{});
        }
    }
    const allocator = gpa.allocator();

    // Uncomment one at a time to see each detection:
    try demonstrate_leak(allocator);
    // try demonstrate_use_after_free(allocator);
    // try demonstrate_double_free(allocator);
}
```

---

## Part 5: How Allocators Work Internally

Understanding how allocators work internally helps you choose between them intelligently and helps you write better allocation patterns.

### 5.1 The Free List

The most fundamental allocator data structure is the **free list** — a linked list of available memory blocks. When you call `free()`, the block is added to the free list. When you call `alloc()`, the allocator searches the free list for a block large enough to satisfy the request.

The key insight: the free list is stored **inside the free blocks themselves**. When a block is free, the first few bytes of the block store a pointer to the next free block. When the block is allocated, those bytes are overwritten with the user's data. This means the allocator has zero per-block overhead for the free list — the metadata lives in the blocks themselves.

```
Free list structure:
┌─────────┐      ┌─────────┐      ┌─────────┐
│ next ───┼─────▶│ next ───┼─────▶│ next=0  │
│         │      │         │      │         │
│ [free]  │      │ [free]  │      │ [free]  │
└─────────┘      └─────────┘      └─────────┘

After allocating the first block:
┌─────────┐      ┌─────────┐      ┌─────────┐
│ user    │      │ next ───┼─────▶│ next=0  │
│ data    │      │         │      │         │
│ [used]  │      │ [free]  │      │ [free]  │
└─────────┘      └─────────┘      └─────────┘
```

This is why use-after-free is so dangerous: when you write to a freed block, you are overwriting the allocator's free list pointer. The next `alloc()` call will follow a corrupted pointer, potentially returning an address that is already in use.

### 5.2 Allocation Strategies

Different strategies for searching the free list produce different tradeoffs:

**First fit:** Return the first free block large enough. Fast but can create fragmentation at the front of the free list.

**Best fit:** Return the smallest free block that is large enough. Minimizes wasted space within blocks but requires scanning the entire free list.

**Next fit:** Like first fit but starts scanning from where the last allocation was found. Distributes allocations more evenly.

In practice, modern allocators use **size-class segregation**: separate free lists for each size class (8 bytes, 16 bytes, 32 bytes, 64 bytes, etc.). An allocation of 12 bytes goes to the 16-byte size class. This eliminates fragmentation within size classes and makes allocation O(1) instead of O(n).

### 5.3 Heap Fragmentation

**Internal fragmentation** occurs when an allocated block is larger than requested. Allocating 12 bytes from a 16-byte size class wastes 4 bytes per allocation.

**External fragmentation** occurs when there is enough total free memory to satisfy a request, but no single contiguous free block is large enough. A sequence of alternating allocate/free operations can produce a "Swiss cheese" heap — many small free holes but no large contiguous region.

```
External fragmentation example:
[A:1024][B:1024][C:1024][D:1024][E:1024]  (5 * 1KB allocated)
[A:free][B:1024][C:free][D:1024][E:free]  (alternating freed)
[A:free][B:1024][C:free][D:1024][E:free]

Total free: 3 KB
Request: alloc(2048) — FAILS (no 2KB contiguous block)
```

Arena allocators entirely eliminate external fragmentation because they never free individual blocks — all free space is always at the end of the arena, fully contiguous.

### 5.4 Implementing a Pool Allocator

A **pool allocator** (slab allocator) manages a collection of fixed-size blocks. It is optimal for allocating many objects of the same type: zero fragmentation, O(1) allocation and free.

```zig
const std = @import("std");

/// A pool allocator for fixed-size blocks.
/// Stores the free list inside free blocks themselves.
fn Pool(comptime T: type) type {
    // Each free block stores a pointer to the next free block
    // The block must be large enough to hold this pointer
    const block_size = @max(@sizeOf(T), @sizeOf(*anyopaque));
    _ = block_size;

    return struct {
        const Self = @This();

        // Free list: pointer to the first free block
        // When null, no free blocks available
        free_list: ?*Node,
        backing: []u8,
        allocator: std.mem.Allocator,

        const Node = struct {
            next: ?*Node,
        };

        pub fn init(allocator: std.mem.Allocator, capacity: usize) !Self {
            // Allocate a contiguous backing buffer
            const block_sz = @max(@sizeOf(T), @sizeOf(Node));
            const backing = try allocator.alloc(u8, block_sz * capacity);

            // Build the initial free list: each block points to the next
            var list: ?*Node = null;
            var i = capacity;
            while (i > 0) {
                i -= 1;
                const node: *Node = @ptrCast(@alignCast(
                    backing.ptr + i * block_sz));
                node.next = list;
                list = node;
            }

            return .{
                .free_list = list,
                .backing = backing,
                .allocator = allocator,
            };
        }

        pub fn deinit(self: *Self) void {
            self.allocator.free(self.backing);
        }

        /// Allocate one T from the pool. O(1).
        pub fn alloc(self: *Self) !*T {
            const node = self.free_list orelse return error.OutOfMemory;
            self.free_list = node.next; // pop from free list
            const ptr: *T = @ptrCast(@alignCast(node));
            return ptr;
        }

        /// Return one T to the pool. O(1).
        pub fn free(self: *Self, ptr: *T) void {
            const node: *Node = @ptrCast(@alignCast(ptr));
            node.next = self.free_list; // push to free list
            self.free_list = node;
        }
    };
}

const Point = struct { x: f32, y: f32 };

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();

    var pool = try Pool(Point).init(gpa.allocator(), 1000);
    defer pool.deinit();

    // Allocate some points
    const p1 = try pool.alloc();
    p1.* = .{ .x = 1.0, .y = 2.0 };

    const p2 = try pool.alloc();
    p2.* = .{ .x = 3.0, .y = 4.0 };

    std.debug.print("p1 = ({d}, {d})\n", .{p1.x, p1.y});
    std.debug.print("p2 = ({d}, {d})\n", .{p2.x, p2.y});

    // Free them back to the pool
    pool.free(p1);
    pool.free(p2);

    // The pool's backing memory is reused — no OS involvement
}
```

Pool allocators are used heavily in systems that create and destroy many objects of the same type rapidly: network packet buffers, database connection pools, game entity systems.

---

> **Exercise 4.3: Dynamic Array**
>
> Implement a generic dynamic array (like `std.ArrayList`) from scratch:
>
> ```zig
> fn DynArray(comptime T: type) type {
>     return struct {
>         items: []T,
>         capacity: usize,
>         allocator: std.mem.Allocator,
>
>         pub fn init(allocator: std.mem.Allocator) DynArray(T) { ... }
>         pub fn deinit(self: *DynArray(T)) void { ... }
>         pub fn append(self: *DynArray(T), item: T) !void { ... }
>         pub fn pop(self: *DynArray(T)) ?T { ... }
>     };
> }
> ```
>
> Requirements:
> - Start with capacity 8
> - When capacity is exceeded, double it (reallocate with `allocator.realloc`)
> - `deinit()` must free the backing slice
> - `append()` returns `error.OutOfMemory` if realloc fails
>
> Test with 1000 appends and verify no memory leaks using `DebugAllocator`.
>
> Measure the total number of reallocations for 1000 elements. With doubling strategy, this should be approximately log₂(1000) ≈ 10 reallocations.

---

## Part 6: Memory Safety in Practice

### 6.1 The Poisoned Pattern

The `DebugAllocator` fills freed memory with `0xaa` bytes. This means:
- A pointer read from freed memory will be `0xaaaaaaaaaaaaaaaa` — immediately segfaulting when dereferenced (this address is in the upper half of the canonical address space, which is unmapped)
- An integer read from freed memory will be `0xaa` or `0xaaaa...` — obviously wrong
- A bool read from freed memory will be `0xaa` — not a valid bool value, triggering safety checks

This "fail loud" behavior is the goal. Silent corruption — where a bug only manifests much later as incorrect behavior in an unrelated part of the program — is the hardest class of bug to diagnose. Loud, immediate crashes with clear error messages pointing to the source of the bug are far preferable.

### 6.2 Valgrind for C/C++ Comparison

If you ever work with C or C++ code, `Valgrind` (specifically its `memcheck` tool) plays a similar role to Zig's `DebugAllocator`:

```bash
# Compile C program without optimization (for readable output)
gcc -g -O0 program.c -o program

# Run under Valgrind
valgrind --leak-check=full --track-origins=yes ./program
```

Valgrind intercepts all `malloc`/`free` calls and tracks heap state. It is slower than Zig's `DebugAllocator` (typically 10-50x slowdown) because it instruments every memory access, not just allocations. But it catches the same classes of bugs: leaks, use-after-free, double-free, and some buffer overflows.

Understanding how `DebugAllocator` works conceptually prepares you to use Valgrind when working with C code — they are solving the same problem with different mechanisms.

### 6.3 Address Sanitizer

For performance-sensitive testing where Valgrind is too slow, AddressSanitizer (ASan) is a compiler instrumentation tool:

```bash
# Compile with ASan
zig build-exe src/main.zig -fsanitize=address

# Or with Clang for C:
clang -fsanitize=address -g program.c -o program
```

ASan instruments the compiler output to insert checks before every memory access. It uses "shadow memory" — a parallel memory region where each byte represents the validity of 8 bytes in the real memory — to track which memory is accessible. Overhead is typically 2-3x, much better than Valgrind.

Zig's `DebugAllocator` is comparable to a simplified version of ASan for heap operations specifically.

---

## Part 7: The Module Project — A Memory-Safe Dynamic String Library

The module project builds a practical, production-quality string library in Zig that demonstrates correct ownership, proper error handling, and efficient memory use.

### Project Specification

Build `zstr` — a dynamic string library with the following API:

```zig
const Str = struct {
    // Create an empty string with the given initial capacity
    pub fn init(allocator: Allocator, capacity: usize) !Str

    // Create from a slice (allocates and copies)
    pub fn from_slice(allocator: Allocator, s: []const u8) !Str

    // Free the string's memory
    pub fn deinit(self: *Str) void

    // Append a slice to the string, growing if necessary
    pub fn append(self: *Str, s: []const u8) !void

    // Append a formatted string
    pub fn append_fmt(self: *Str, comptime fmt: []const u8, args: anytype) !void

    // Return a view of the string content (does not allocate)
    pub fn as_slice(self: Str) []const u8

    // Trim whitespace from both ends (modifies in place, no allocation)
    pub fn trim(self: *Str) void

    // Split by delimiter, returning owned slices (caller frees each)
    pub fn split(self: Str, allocator: Allocator, delim: u8) ![][]u8

    // Find a substring, returning the index or null
    pub fn find(self: Str, needle: []const u8) ?usize

    // Convert to uppercase in place (no allocation)
    pub fn to_upper(self: *Str) void
};
```

### Implementation Notes

**Growth strategy:** When `append` needs more capacity, double the current capacity (matching the strategy you implemented in Exercise 4.3). This amortizes reallocation cost to O(1) per append.

**Error handling:** Every function that allocates must return errors correctly. `errdefer` must be used to prevent leaks on error paths within functions that make multiple allocations.

**The `split` function** is interesting because it returns `[][]u8` — a slice of slices. Each inner slice is a copy of the substring. The outer slice and all inner slices must be freed by the caller. Document this clearly in the function's comment.

**The `append_fmt` function** uses Zig's `std.fmt.allocPrint` internally to format into a temporary allocation, then appends to the string:

```zig
pub fn append_fmt(self: *Str, comptime fmt: []const u8, args: anytype) !void {
    const formatted = try std.fmt.allocPrint(self.allocator, fmt, args);
    defer self.allocator.free(formatted);
    try self.append(formatted);
}
```

### Verification

Test your implementation with `DebugAllocator` to verify:
1. No leaks under normal use
2. No leaks when `append` fails mid-way (simulate `OutOfMemory` using `FixedBufferAllocator` with a small buffer)
3. `split` correctly frees all sub-slices when the caller frees them

### Extension Challenges

1. **Small string optimization:** For strings shorter than 24 bytes, store the content inline in the struct (no heap allocation). This is a real optimization used by most production string implementations (C++ `std::string`, Rust's `SmallVec`).

2. **Copy-on-write:** Implement reference counting so that string copies share backing memory until one is modified.

3. **Thread-safe string builder:** Use a mutex to allow multiple threads to append to the same string concurrently.

---

## Summary

Memory management is the core responsibility of systems programming. This module has given you the full picture.

**Stack vs. heap:** The stack is automatic and fast but limited in size and lifetime. The heap is flexible but requires explicit management. Use the stack when size and lifetime fit; use the heap otherwise.

**Zig's allocator model** forces allocation to be explicit. Every function that allocates takes an `Allocator` parameter. This makes allocations visible, testable, and replaceable. The `DebugAllocator` catches leaks, use-after-free, and double-free in development. `ArenaAllocator` eliminates individual free tracking for request-scoped work. `FixedBufferAllocator` eliminates heap use entirely.

**Ownership** is the responsibility to free an allocation exactly once. The `defer`/`errdefer` pattern is the primary tool for ensuring cleanup happens on all code paths. The `init`/`deinit` pattern encapsulates ownership in self-managing data structures.

**Memory bugs** — leaks, use-after-free, double-free, buffer overflow — are the source of the majority of critical security vulnerabilities in C and C++ software. Understanding them at the machine level means you can both prevent them and recognize them when they occur. Zig's `DebugAllocator` detects the first three in Debug builds; bounds checking catches the fourth.

**Allocator internals** — free lists, size classes, fragmentation — explain why different allocators have different performance profiles and when to choose each.

---

## What's Next

Module 5 — State and the State Machine Model — shifts from memory management to program structure. You now have a complete picture of how data is stored and managed. Module 5 teaches how to model the *behavior* of systems over time — the foundational pattern that underlies protocol parsers, schedulers, network stacks, and virtually every significant piece of systems software.

---

## Reference: Zig Memory Operations

```zig
// DebugAllocator (development/testing)
var gpa: std.heap.DebugAllocator(.{}) = .init;
defer _ = gpa.deinit();
const allocator = gpa.allocator();

// ArenaAllocator (request/operation scoped)
var arena = std.heap.ArenaAllocator.init(backing_allocator);
defer arena.deinit();
const aa = arena.allocator();

// FixedBufferAllocator (no heap)
var buf: [N]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&buf);
const fa = fba.allocator();
fba.reset(); // reuse buffer

// Production allocator
const pa = std.heap.smp_allocator;

// Allocate a slice
const slice = try allocator.alloc(T, n);
defer allocator.free(slice);

// Allocate a single item
const ptr = try allocator.create(T);
defer allocator.destroy(ptr);

// Resize
const new_slice = try allocator.realloc(old_slice, new_n);

// Duplicate a slice (alloc + copy)
const copy = try allocator.dupe(u8, original);
defer allocator.free(copy);

// Formatted string allocation
const s = try std.fmt.allocPrint(allocator, "value: {d}", .{42});
defer allocator.free(s);
```

## Reference: Common Ownership Mistakes and Fixes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Forgot `defer free()` | Leak reported at `deinit()` | Add `defer allocator.free(x)` immediately after `alloc()` |
| No `errdefer` before second alloc | Leak on `OutOfMemory` | Add `errdefer allocator.free(a)` before allocating `b` |
| Double free | Panic: "double free" | Identify the two owners; designate exactly one |
| Return pointer to local var | Garbage data or crash | Allocate on heap, caller frees |
| Use freed memory | Panic or corruption | Move `defer free()` after last use |
| Alloc in loop, free never | Leak grows with iterations | Free inside loop or use Arena |

---

*End of Module 4*
