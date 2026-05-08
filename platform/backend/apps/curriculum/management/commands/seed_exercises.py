from django.core.management.base import BaseCommand
from apps.curriculum.models import Module, Exercise

EXERCISES = {
    1: [
        {
            "title": "Bit Manipulation Toolkit",
            "description": (
                "Implement four low-level bit operations without using any libraries:\n\n"
                "- `set_bit(n, pos)` — set bit at position `pos` to 1\n"
                "- `clear_bit(n, pos)` — clear bit at position `pos` to 0\n"
                "- `toggle_bit(n, pos)` — flip bit at position `pos`\n"
                "- `count_bits(n)` — return the number of set bits (popcount)\n\n"
                "All functions operate on `u32` values."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn set_bit(n: u32, pos: u5) u32 {\n"
                "    // TODO: return n with bit `pos` set to 1\n"
                "    _ = pos;\n"
                "    return n;\n"
                "}\n\n"
                "pub fn clear_bit(n: u32, pos: u5) u32 {\n"
                "    // TODO: return n with bit `pos` cleared to 0\n"
                "    _ = pos;\n"
                "    return n;\n"
                "}\n\n"
                "pub fn toggle_bit(n: u32, pos: u5) u32 {\n"
                "    // TODO: return n with bit `pos` flipped\n"
                "    _ = pos;\n"
                "    return n;\n"
                "}\n\n"
                "pub fn count_bits(n: u32) u32 {\n"
                "    // TODO: return the number of 1 bits in n\n"
                "    _ = n;\n"
                "    return 0;\n"
                "}\n\n"
                "pub fn main() void {\n"
                "    std.debug.print(\"set_bit(0b0000, 2)   = {b:0>4}\\n\", .{set_bit(0, 2)});\n"
                "    std.debug.print(\"clear_bit(0b1111, 1) = {b:0>4}\\n\", .{clear_bit(0b1111, 1)});\n"
                "    std.debug.print(\"toggle_bit(0b1010, 0)= {b:0>4}\\n\", .{toggle_bit(0b1010, 0)});\n"
                "    std.debug.print(\"count_bits(0b10110111) = {}\\n\", .{count_bits(0b10110111)});\n"
                "}\n\n"
                "test \"bit operations\" {\n"
                "    try std.testing.expectEqual(@as(u32, 0b0100), set_bit(0, 2));\n"
                "    try std.testing.expectEqual(@as(u32, 0b1101), clear_bit(0b1111, 1));\n"
                "    try std.testing.expectEqual(@as(u32, 0b1011), toggle_bit(0b1010, 0));\n"
                "    try std.testing.expectEqual(@as(u32, 5), count_bits(0b10110111));\n"
                "}\n"
            ),
        },
        {
            "title": "Two's Complement Overflow",
            "description": (
                "Observe how Zig handles integer overflow.\n\n"
                "Run the program in **debug** mode and in **release-safe** mode by modifying the `optimize` field in `build.zig`.\n\n"
                "- What happens when you add 1 to `std.math.maxInt(u8)`?\n"
                "- Use `@addWithOverflow` to detect overflow without a panic.\n"
                "- Use the wrapping operator `+%` to wrap silently.\n\n"
                "Document your observations as `std.debug.print` statements."
            ),
            "exercise_type": "observation",
            "order": 2,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn main() void {\n"
                "    const max_u8: u8 = std.math.maxInt(u8);\n"
                "    std.debug.print(\"max u8 = {}\\n\", .{max_u8});\n\n"
                "    // TODO: use @addWithOverflow to safely add 1\n"
                "    const result = @addWithOverflow(max_u8, 1);\n"
                "    std.debug.print(\"addWithOverflow: value={}, overflow={}\\n\", .{ result[0], result[1] });\n\n"
                "    // TODO: use wrapping addition (+%) and observe the result\n"
                "    const wrapped = max_u8 +% 1;\n"
                "    std.debug.print(\"wrapped: {}\\n\", .{wrapped});\n\n"
                "    // TODO: try the same with i8 — what is -128 - 1 with -%?\n"
                "}\n"
            ),
        },
        {
            "title": "Float Comparison with Epsilon",
            "description": (
                "IEEE 754 floats cannot be reliably compared with `==` after arithmetic.\n\n"
                "Implement `approx_eq(a: f64, b: f64, epsilon: f64) bool` that returns `true` when\n"
                "`|a - b| <= epsilon`.\n\n"
                "Then implement `approx_eq_relative` which scales epsilon by the magnitude of the\n"
                "larger operand — useful when values span many orders of magnitude."
            ),
            "exercise_type": "implementation",
            "order": 3,
            "is_required": False,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn approx_eq(a: f64, b: f64, epsilon: f64) bool {\n"
                "    // TODO\n"
                "    _ = a; _ = b; _ = epsilon;\n"
                "    return false;\n"
                "}\n\n"
                "pub fn approx_eq_relative(a: f64, b: f64, rel_tol: f64) bool {\n"
                "    // TODO: scale tolerance by max(|a|, |b|)\n"
                "    _ = a; _ = b; _ = rel_tol;\n"
                "    return false;\n"
                "}\n\n"
                "pub fn main() void {\n"
                "    const x: f64 = 0.1 + 0.2;\n"
                "    std.debug.print(\"0.1 + 0.2 == 0.3? {}\\n\", .{x == 0.3});\n"
                "    std.debug.print(\"approx_eq? {}\\n\", .{approx_eq(x, 0.3, 1e-10)});\n"
                "}\n\n"
                "test \"float comparison\" {\n"
                "    try std.testing.expect(approx_eq(0.1 + 0.2, 0.3, 1e-10));\n"
                "    try std.testing.expect(!approx_eq(1.0, 1.1, 1e-10));\n"
                "    try std.testing.expect(approx_eq_relative(1_000_000.0, 1_000_000.1, 1e-6));\n"
                "}\n"
            ),
        },
    ],
    2: [
        {
            "title": "Reading Compiler-Generated Assembly",
            "description": (
                "Compile a simple Zig function and inspect its x86-64 assembly output.\n\n"
                "1. Write a function `add(a: i32, b: i32) i32` that returns `a + b`.\n"
                "2. Run it to confirm it works.\n"
                "3. Then modify the build to emit assembly: add `.emit_asm = true` inside the module options.\n"
                "   The `.s` file will appear in `zig-out/`.\n\n"
                "Observe: how many registers does the function use? Is there a function prologue?"
            ),
            "exercise_type": "observation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn add(a: i32, b: i32) i32 {\n"
                "    return a + b;\n"
                "}\n\n"
                "pub fn multiply(a: i32, b: i32) i32 {\n"
                "    return a * b;\n"
                "}\n\n"
                "pub fn main() void {\n"
                "    std.debug.print(\"add(3, 4) = {}\\n\", .{add(3, 4)});\n"
                "    std.debug.print(\"multiply(3, 4) = {}\\n\", .{multiply(3, 4)});\n"
                "    // After running, add .emit_asm = true to the module in build.zig\n"
                "    // and look at the generated assembly file.\n"
                "}\n"
            ),
        },
        {
            "title": "Branch Prediction Cost",
            "description": (
                "Measure the performance impact of unpredictable branches.\n\n"
                "1. Create an array of 10,000 random `u8` values.\n"
                "2. Sum values > 128 in the unsorted array and measure time.\n"
                "3. Sort the array, then repeat the sum and measure again.\n\n"
                "Use `std.time.nanoTimestamp()` for timing. Print both results and\n"
                "the ratio. The sorted version should be measurably faster."
            ),
            "exercise_type": "implementation",
            "order": 2,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "const N = 10_000;\n\n"
                "pub fn sum_above_threshold(data: []const u8, threshold: u8) u64 {\n"
                "    var total: u64 = 0;\n"
                "    for (data) |v| {\n"
                "        if (v > threshold) total += v;\n"
                "    }\n"
                "    return total;\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const ally = gpa.allocator();\n\n"
                "    var data = try ally.alloc(u8, N);\n"
                "    defer ally.free(data);\n\n"
                "    // Fill with pseudo-random values\n"
                "    var rng = std.Random.DefaultPrng.init(42);\n"
                "    rng.random().bytes(data);\n\n"
                "    // TODO: time sum_above_threshold on unsorted data\n"
                "    const t1 = std.time.nanoTimestamp();\n"
                "    const sum_unsorted = sum_above_threshold(data, 128);\n"
                "    const t2 = std.time.nanoTimestamp();\n\n"
                "    // TODO: sort data, then time again\n"
                "    std.mem.sort(u8, data, {}, std.sort.asc(u8));\n"
                "    const t3 = std.time.nanoTimestamp();\n"
                "    const sum_sorted = sum_above_threshold(data, 128);\n"
                "    const t4 = std.time.nanoTimestamp();\n\n"
                "    std.debug.print(\"unsorted: sum={} time={}ns\\n\", .{ sum_unsorted, t2 - t1 });\n"
                "    std.debug.print(\"sorted:   sum={} time={}ns\\n\", .{ sum_sorted, t4 - t3 });\n"
                "}\n"
            ),
        },
    ],
    3: [
        {
            "title": "Direct Write Syscall",
            "description": (
                "Make a Linux write syscall without using `std.debug.print` or any I/O library.\n\n"
                "Use `std.os.linux.syscall3` with syscall number `1` (write), fd `1` (stdout),\n"
                "a pointer to your message, and the message length.\n\n"
                "Then implement `direct_exit(code: u8) noreturn` using syscall number `60`."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst linux = std.os.linux;\n\n"
                "pub fn direct_write(fd: usize, msg: []const u8) void {\n"
                "    // syscall number 1 = write(fd, buf, count)\n"
                "    _ = linux.syscall3(.write, fd, @intFromPtr(msg.ptr), msg.len);\n"
                "}\n\n"
                "pub fn direct_exit(code: u8) noreturn {\n"
                "    // TODO: syscall number 60 = exit(code)\n"
                "    _ = code;\n"
                "    unreachable;\n"
                "}\n\n"
                "pub fn main() void {\n"
                "    direct_write(1, \"Hello from a raw syscall!\\n\");\n"
                "    direct_exit(0);\n"
                "}\n"
            ),
        },
        {
            "title": "Static vs Dynamic Binary Size",
            "description": (
                "Compare the sizes of statically and dynamically linked Zig binaries.\n\n"
                "Build the same program twice using `build.zig`:\n"
                "1. Default (dynamic): `zig build -Doptimize=ReleaseFast`\n"
                "2. Static: add `.link_libc = false` and `.link_mode = .static` to the executable.\n\n"
                "Use `@sizeOf` and `@alignOf` to inspect struct layouts in your program.\n"
                "Print the sizes of at least three built-in types."
            ),
            "exercise_type": "observation",
            "order": 2,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "const Point = struct { x: f32, y: f32 };\n"
                "const Mixed = struct { a: u8, b: u32, c: u16 };\n"
                "const Packed = packed struct { a: u8, b: u32, c: u16 };\n\n"
                "pub fn main() void {\n"
                "    std.debug.print(\"bool:   size={} align={}\\n\", .{ @sizeOf(bool), @alignOf(bool) });\n"
                "    std.debug.print(\"u64:    size={} align={}\\n\", .{ @sizeOf(u64), @alignOf(u64) });\n"
                "    std.debug.print(\"Point:  size={} align={}\\n\", .{ @sizeOf(Point), @alignOf(Point) });\n"
                "    std.debug.print(\"Mixed:  size={} align={}\\n\", .{ @sizeOf(Mixed), @alignOf(Mixed) });\n"
                "    std.debug.print(\"Packed: size={} align={}\\n\", .{ @sizeOf(Packed), @alignOf(Packed) });\n"
                "    // Observe: Mixed has padding, Packed does not.\n"
                "    // What is the offset of each field in Mixed?\n"
                "    std.debug.print(\"Mixed.b offset: {}\\n\", .{@offsetOf(Mixed, \"b\")});\n"
                "}\n"
            ),
        },
    ],
    4: [
        {
            "title": "Dynamic Array",
            "description": (
                "Implement a generic growable array `ArrayList(T)` from scratch.\n\n"
                "Required operations:\n"
                "- `init(allocator)` / `deinit()`\n"
                "- `append(item)` — grows capacity by 2× when full\n"
                "- `get(index)` — returns `T`\n"
                "- `len` field\n\n"
                "Use `allocator.alloc` and `allocator.realloc`. Detect and report allocation failures."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst Allocator = std.mem.Allocator;\n\n"
                "pub fn ArrayList(comptime T: type) type {\n"
                "    return struct {\n"
                "        items: []T,\n"
                "        len: usize,\n"
                "        allocator: Allocator,\n\n"
                "        const Self = @This();\n\n"
                "        pub fn init(allocator: Allocator) Self {\n"
                "            return .{ .items = &.{}, .len = 0, .allocator = allocator };\n"
                "        }\n\n"
                "        pub fn deinit(self: *Self) void {\n"
                "            if (self.items.len > 0) self.allocator.free(self.items);\n"
                "        }\n\n"
                "        pub fn append(self: *Self, item: T) !void {\n"
                "            // TODO: grow if needed, then store item\n"
                "            _ = item;\n"
                "        }\n\n"
                "        pub fn get(self: *const Self, index: usize) T {\n"
                "            return self.items[index];\n"
                "        }\n"
                "    };\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    var list = ArrayList(i32).init(gpa.allocator());\n"
                "    defer list.deinit();\n"
                "    try list.append(10);\n"
                "    try list.append(20);\n"
                "    try list.append(30);\n"
                "    std.debug.print(\"len={}, [0]={}, [2]={}\\n\", .{ list.len, list.get(0), list.get(2) });\n"
                "}\n\n"
                "test \"ArrayList\" {\n"
                "    var list = ArrayList(i32).init(std.testing.allocator);\n"
                "    defer list.deinit();\n"
                "    for (0..10) |i| try list.append(@intCast(i));\n"
                "    try std.testing.expectEqual(@as(usize, 10), list.len);\n"
                "    try std.testing.expectEqual(@as(i32, 5), list.get(5));\n"
                "}\n"
            ),
        },
        {
            "title": "Arena Allocator Pattern",
            "description": (
                "Use `std.heap.ArenaAllocator` to bulk-allocate many small objects and free them all at once.\n\n"
                "1. Create a tree of `Node` structs (each with a value and two optional child pointers) using an arena.\n"
                "2. Recursively sum all values in the tree.\n"
                "3. Call `arena.deinit()` — observe that this frees everything in one shot.\n\n"
                "Compare this to freeing each node individually."
            ),
            "exercise_type": "implementation",
            "order": 2,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst Allocator = std.mem.Allocator;\n\n"
                "const Node = struct {\n"
                "    value: i32,\n"
                "    left: ?*Node = null,\n"
                "    right: ?*Node = null,\n"
                "};\n\n"
                "pub fn new_node(ally: Allocator, value: i32) !*Node {\n"
                "    const node = try ally.create(Node);\n"
                "    node.* = .{ .value = value };\n"
                "    return node;\n"
                "}\n\n"
                "pub fn sum(node: ?*const Node) i32 {\n"
                "    // TODO: recursively sum all values\n"
                "    _ = node;\n"
                "    return 0;\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);\n"
                "    defer arena.deinit(); // frees all nodes at once\n"
                "    const ally = arena.allocator();\n\n"
                "    const root = try new_node(ally, 1);\n"
                "    root.left = try new_node(ally, 2);\n"
                "    root.right = try new_node(ally, 3);\n"
                "    root.left.?.left = try new_node(ally, 4);\n\n"
                "    std.debug.print(\"sum = {}\\n\", .{sum(root)});\n"
                "}\n\n"
                "test \"arena sum\" {\n"
                "    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);\n"
                "    defer arena.deinit();\n"
                "    const ally = arena.allocator();\n"
                "    const root = try new_node(ally, 1);\n"
                "    root.left = try new_node(ally, 2);\n"
                "    root.right = try new_node(ally, 3);\n"
                "    try std.testing.expectEqual(@as(i32, 6), sum(root));\n"
                "}\n"
            ),
        },
    ],
    5: [
        {
            "title": "Process Fork and Wait",
            "description": (
                "Use `std.posix.fork()` to spawn a child process.\n\n"
                "1. Fork the process.\n"
                "2. In the child: print its PID, do some work (sum 1..100), then exit.\n"
                "3. In the parent: wait for the child using `std.posix.waitpid`, then print the child's exit status.\n\n"
                "Note: this exercise only works on Linux/macOS."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst posix = std.posix;\n\n"
                "pub fn main() !void {\n"
                "    const pid = try posix.fork();\n"
                "    if (pid == 0) {\n"
                "        // Child process\n"
                "        std.debug.print(\"child PID={}\\n\", .{std.os.linux.getpid()});\n"
                "        var sum: u64 = 0;\n"
                "        for (1..101) |i| sum += i;\n"
                "        std.debug.print(\"child sum={}\\n\", .{sum});\n"
                "        posix.exit(0);\n"
                "    } else {\n"
                "        // Parent process\n"
                "        std.debug.print(\"parent waiting for child PID={}\\n\", .{pid});\n"
                "        // TODO: call posix.waitpid(pid, 0) and print the exit status\n"
                "        const result = posix.waitpid(pid, 0);\n"
                "        std.debug.print(\"child exited with status={}\\n\", .{result.status});\n"
                "    }\n"
                "}\n"
            ),
        },
        {
            "title": "Signal Handling",
            "description": (
                "Handle `SIGINT` (Ctrl+C) gracefully in a long-running Zig program.\n\n"
                "1. Register a signal handler using `std.posix.sigaction`.\n"
                "2. The handler should set a global `running = false` flag.\n"
                "3. The main loop checks `running` and exits cleanly when it's false.\n"
                "4. Print a message when shutdown is triggered.\n\n"
                "Run the program and press Ctrl+C to test."
            ),
            "exercise_type": "implementation",
            "order": 2,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst posix = std.posix;\n\n"
                "var running: bool = true;\n\n"
                "fn handle_sigint(_: c_int) callconv(.C) void {\n"
                "    running = false;\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    // Register SIGINT handler\n"
                "    const sa = posix.Sigaction{\n"
                "        .handler = .{ .handler = handle_sigint },\n"
                "        .mask = posix.empty_sigset,\n"
                "        .flags = 0,\n"
                "    };\n"
                "    try posix.sigaction(posix.SIG.INT, &sa, null);\n\n"
                "    std.debug.print(\"Running... press Ctrl+C to stop\\n\", .{});\n"
                "    var i: u64 = 0;\n"
                "    while (running) {\n"
                "        i += 1;\n"
                "        std.time.sleep(100 * std.time.ns_per_ms);\n"
                "        if (i % 10 == 0) std.debug.print(\"tick {}\\n\", .{i});\n"
                "    }\n"
                "    std.debug.print(\"Shutdown gracefully after {} ticks\\n\", .{i});\n"
                "}\n"
            ),
        },
    ],
    6: [
        {
            "title": "Cache-Friendly Matrix Traversal",
            "description": (
                "Demonstrate the performance impact of memory access patterns.\n\n"
                "Allocate a 1000×1000 matrix of `f64`. Compute the sum:\n"
                "1. **Row-major** (inner loop over columns) — cache friendly\n"
                "2. **Column-major** (inner loop over rows) — cache hostile\n\n"
                "Time both with `std.time.nanoTimestamp()` and print the ratio.\n"
                "The row-major version should be significantly faster."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\nconst N = 1000;\n\n"
                "pub fn sum_row_major(matrix: []const f64) f64 {\n"
                "    var total: f64 = 0;\n"
                "    // TODO: iterate row by row (i outer, j inner)\n"
                "    _ = matrix;\n"
                "    return total;\n"
                "}\n\n"
                "pub fn sum_col_major(matrix: []const f64) f64 {\n"
                "    var total: f64 = 0;\n"
                "    // TODO: iterate column by column (j outer, i inner)\n"
                "    _ = matrix;\n"
                "    return total;\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const ally = gpa.allocator();\n"
                "    const matrix = try ally.alloc(f64, N * N);\n"
                "    defer ally.free(matrix);\n"
                "    for (matrix, 0..) |*v, i| v.* = @floatFromInt(i);\n\n"
                "    const t1 = std.time.nanoTimestamp();\n"
                "    const s1 = sum_row_major(matrix);\n"
                "    const t2 = std.time.nanoTimestamp();\n"
                "    const s2 = sum_col_major(matrix);\n"
                "    const t3 = std.time.nanoTimestamp();\n\n"
                "    std.debug.print(\"row-major: sum={:.0} time={}ns\\n\", .{ s1, t2 - t1 });\n"
                "    std.debug.print(\"col-major: sum={:.0} time={}ns\\n\", .{ s2, t3 - t2 });\n"
                "}\n"
            ),
        },
    ],
    7: [
        {
            "title": "Round Robin Scheduler",
            "description": (
                "Simulate a Round Robin CPU scheduler.\n\n"
                "Each `Process` has an `id`, `arrival_time`, and `burst_time` (total CPU needed).\n\n"
                "Implement `round_robin(processes, quantum)` that simulates scheduling with the given\n"
                "time quantum. Return a slice of `CompletionRecord` with `pid`, `finish_time`,\n"
                "`turnaround_time` (finish - arrival), and `waiting_time` (turnaround - burst).\n\n"
                "Print average turnaround and waiting times."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "const Process = struct { id: usize, arrival: u32, burst: u32 };\n"
                "const Record = struct { id: usize, finish: u32, turnaround: u32, waiting: u32 };\n\n"
                "pub fn round_robin(\n"
                "    ally: std.mem.Allocator,\n"
                "    processes: []const Process,\n"
                "    quantum: u32,\n"
                ") ![]Record {\n"
                "    // TODO: simulate RR scheduling\n"
                "    _ = ally; _ = processes; _ = quantum;\n"
                "    return &.{};\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const ally = gpa.allocator();\n\n"
                "    const procs = [_]Process{\n"
                "        .{ .id = 1, .arrival = 0, .burst = 6 },\n"
                "        .{ .id = 2, .arrival = 1, .burst = 4 },\n"
                "        .{ .id = 3, .arrival = 2, .burst = 2 },\n"
                "    };\n\n"
                "    const records = try round_robin(ally, &procs, 2);\n"
                "    defer ally.free(records);\n\n"
                "    var avg_ta: f64 = 0;\n"
                "    var avg_wt: f64 = 0;\n"
                "    for (records) |r| {\n"
                "        avg_ta += @floatFromInt(r.turnaround);\n"
                "        avg_wt += @floatFromInt(r.waiting);\n"
                "        std.debug.print(\"P{}: finish={} tat={} wait={}\\n\", .{ r.id, r.finish, r.turnaround, r.waiting });\n"
                "    }\n"
                "    const n: f64 = @floatFromInt(records.len);\n"
                "    std.debug.print(\"avg turnaround={d:.1} avg waiting={d:.1}\\n\", .{ avg_ta / n, avg_wt / n });\n"
                "}\n"
            ),
        },
    ],
    8: [
        {
            "title": "Race Condition and Mutex",
            "description": (
                "Demonstrate a race condition and fix it with a mutex.\n\n"
                "1. Start 10 threads each incrementing a shared counter 100,000 times **without** a mutex.\n"
                "   Observe that the final count is usually not 1,000,000.\n"
                "2. Add `std.Thread.Mutex` and repeat. The count should always be exactly 1,000,000."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "var counter: u64 = 0;\n"
                "var mutex = std.Thread.Mutex{};\n\n"
                "fn worker(_: void) void {\n"
                "    for (0..100_000) |_| {\n"
                "        // TODO: lock mutex, increment counter, unlock\n"
                "        counter += 1;\n"
                "    }\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var threads: [10]std.Thread = undefined;\n"
                "    for (&threads) |*t| t.* = try std.Thread.spawn(.{}, worker, .{{}});\n"
                "    for (threads) |t| t.join();\n"
                "    std.debug.print(\"counter = {} (expected 1000000)\\n\", .{counter});\n"
                "}\n\n"
                "test \"mutex correctness\" {\n"
                "    counter = 0;\n"
                "    var threads: [10]std.Thread = undefined;\n"
                "    for (&threads) |*t| t.* = try std.Thread.spawn(.{}, worker, .{{}});\n"
                "    for (threads) |t| t.join();\n"
                "    try std.testing.expectEqual(@as(u64, 1_000_000), counter);\n"
                "}\n"
            ),
        },
        {
            "title": "Thread-Safe Bounded Queue",
            "description": (
                "Implement a bounded FIFO queue safe for concurrent access by multiple producers and consumers.\n\n"
                "Use `std.Thread.Mutex` and `std.Thread.Condition` for synchronization.\n"
                "The queue must block when full (producers) or empty (consumers).\n\n"
                "Test with 4 producer threads and 4 consumer threads."
            ),
            "exercise_type": "implementation",
            "order": 2,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn BoundedQueue(comptime T: type, comptime capacity: usize) type {\n"
                "    return struct {\n"
                "        buf: [capacity]T = undefined,\n"
                "        head: usize = 0,\n"
                "        tail: usize = 0,\n"
                "        count: usize = 0,\n"
                "        mutex: std.Thread.Mutex = .{},\n"
                "        not_full: std.Thread.Condition = .{},\n"
                "        not_empty: std.Thread.Condition = .{},\n\n"
                "        const Self = @This();\n\n"
                "        pub fn push(self: *Self, item: T) void {\n"
                "            self.mutex.lock();\n"
                "            defer self.mutex.unlock();\n"
                "            while (self.count == capacity) self.not_full.wait(&self.mutex);\n"
                "            self.buf[self.tail] = item;\n"
                "            self.tail = (self.tail + 1) % capacity;\n"
                "            self.count += 1;\n"
                "            self.not_empty.signal();\n"
                "        }\n\n"
                "        pub fn pop(self: *Self) T {\n"
                "            // TODO: mirror push — wait while empty, then dequeue\n"
                "            _ = self;\n"
                "            unreachable;\n"
                "        }\n"
                "    };\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var q: BoundedQueue(u32, 8) = .{};\n"
                "    var produced: u32 = 0;\n"
                "    var consumed: u32 = 0;\n"
                "    _ = &produced; _ = &consumed;\n"
                "    // TODO: spawn producer and consumer threads, verify count matches\n"
                "    for (0..20) |i| q.push(@intCast(i));\n"
                "    for (0..20) |_| _ = q.pop();\n"
                "    std.debug.print(\"queue test passed\\n\", .{});\n"
                "}\n"
            ),
        },
    ],
    9: [
        {
            "title": "Write-Ahead Log",
            "description": (
                "Implement a minimal write-ahead log (WAL) for crash recovery.\n\n"
                "Each log entry: `[4-byte length][payload bytes][4-byte CRC32]`.\n\n"
                "Implement:\n"
                "- `append(file, payload)` — write entry and fsync\n"
                "- `recover(file)` — read entries, skip any with bad CRC, return valid payloads\n\n"
                "Use `std.hash.Crc32` for checksums."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst Crc32 = std.hash.Crc32;\n\n"
                "pub fn append(file: std.fs.File, payload: []const u8) !void {\n"
                "    const len: u32 = @intCast(payload.len);\n"
                "    const crc = Crc32.hash(payload);\n"
                "    var writer = file.writer();\n"
                "    try writer.writeInt(u32, len, .little);\n"
                "    try writer.writeAll(payload);\n"
                "    try writer.writeInt(u32, crc, .little);\n"
                "    try file.sync(); // fsync\n"
                "}\n\n"
                "pub fn recover(\n"
                "    ally: std.mem.Allocator,\n"
                "    file: std.fs.File,\n") + (
                ") ![][]u8 {\n"
                "    // TODO: read entries, verify CRC, return valid payloads\n"
                "    _ = ally;\n"
                "    _ = file;\n"
                "    return &.{};\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const ally = gpa.allocator();\n\n"
                "    const file = try std.fs.cwd().createFile(\"test.wal\", .{ .read = true, .truncate = true });\n"
                "    defer file.close();\n\n"
                "    try append(file, \"tx:set key1 value1\");\n"
                "    try append(file, \"tx:set key2 value2\");\n\n"
                "    try file.seekTo(0);\n"
                "    const entries = try recover(ally, file);\n"
                "    defer { for (entries) |e| ally.free(e); ally.free(entries); }\n\n"
                "    for (entries) |e| std.debug.print(\"recovered: {s}\\n\", .{e});\n"
                "}\n"
            ),
        },
    ],
    10: [
        {
            "title": "Microbenchmark Framework",
            "description": (
                "Write a proper microbenchmark with warmup and statistical averaging.\n\n"
                "Benchmark two implementations of string contains:\n"
                "1. Naive O(n·m) search\n"
                "2. `std.mem.indexOf`\n\n"
                "Run each 1000 times, discard the first 100 (warmup), report min/max/mean/p95.\n"
                "Use `std.time.nanoTimestamp()`."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn naive_contains(haystack: []const u8, needle: []const u8) bool {\n"
                "    if (needle.len > haystack.len) return false;\n"
                "    var i: usize = 0;\n"
                "    while (i <= haystack.len - needle.len) : (i += 1) {\n"
                "        if (std.mem.eql(u8, haystack[i..][0..needle.len], needle)) return true;\n"
                "    }\n"
                "    return false;\n"
                "}\n\n"
                "const RUNS = 1000;\nconst WARMUP = 100;\n\n"
                "pub fn bench(label: []const u8, f: fn ([]const u8, []const u8) bool, h: []const u8, n: []const u8) void {\n"
                "    var times: [RUNS]i64 = undefined;\n"
                "    for (0..RUNS) |i| {\n"
                "        const t1 = std.time.nanoTimestamp();\n"
                "        _ = f(h, n);\n"
                "        times[i] = std.time.nanoTimestamp() - t1;\n"
                "    }\n"
                "    // TODO: compute min/max/mean/p95 from times[WARMUP..]\n"
                "    var total: i64 = 0;\n"
                "    for (times[WARMUP..]) |t| total += t;\n"
                "    const mean = @divTrunc(total, RUNS - WARMUP);\n"
                "    std.debug.print(\"{s}: mean={}ns\\n\", .{ label, mean });\n"
                "}\n\n"
                "pub fn main() void {\n"
                "    const haystack = \"the quick brown fox jumps over the lazy dog\";\n"
                "    const needle = \"lazy\";\n"
                "    bench(\"naive\", naive_contains, haystack, needle);\n"
                "    bench(\"std.mem.indexOf\", struct {\n"
                "        fn f(h: []const u8, n: []const u8) bool { return std.mem.indexOf(u8, h, n) != null; }\n"
                "    }.f, haystack, needle);\n"
                "}\n"
            ),
        },
    ],
    11: [
        {
            "title": "Non-Blocking I/O with poll()",
            "description": (
                "Build a simple event loop using `poll()` (or `epoll` on Linux).\n\n"
                "1. Open a file and set it to non-blocking mode using `fcntl`.\n"
                "2. Use `std.posix.poll` to wait until it's readable.\n"
                "3. Read available data in a loop without blocking.\n\n"
                "This demonstrates the core pattern behind all event-driven servers."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst posix = std.posix;\n\n"
                "pub fn main() !void {\n"
                "    // Create a pipe to test non-blocking I/O\n"
                "    const pipe_fds = try posix.pipe();\n"
                "    const read_fd = pipe_fds[0];\n"
                "    const write_fd = pipe_fds[1];\n"
                "    defer posix.close(read_fd);\n"
                "    defer posix.close(write_fd);\n\n"
                "    // Write some test data\n"
                "    _ = try posix.write(write_fd, \"hello from pipe\\n\");\n"
                "    posix.close(write_fd);\n\n"
                "    // TODO: use poll() to wait for read_fd to become readable\n"
                "    var fds = [_]posix.pollfd{.{ .fd = read_fd, .events = posix.POLL.IN, .revents = 0 }};\n"
                "    const ready = try posix.poll(&fds, 1000); // 1s timeout\n"
                "    std.debug.print(\"poll returned {} ready fds\\n\", .{ready});\n\n"
                "    if (fds[0].revents & posix.POLL.IN != 0) {\n"
                "        var buf: [256]u8 = undefined;\n"
                "        const n = try posix.read(read_fd, &buf);\n"
                "        std.debug.print(\"read: {s}\", .{buf[0..n]});\n"
                "    }\n"
                "}\n"
            ),
        },
    ],
    12: [
        {
            "title": "TCP Echo Server",
            "description": (
                "Build a TCP echo server that handles one client at a time.\n\n"
                "1. Bind to `127.0.0.1:9000`.\n"
                "2. Accept a connection.\n"
                "3. Echo every line back to the client (prefix each line with `echo: `).\n"
                "4. Close when the client disconnects.\n\n"
                "Test with `nc 127.0.0.1 9000`."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\nconst net = std.net;\n\n"
                "pub fn main() !void {\n"
                "    const addr = try net.Address.parseIp4(\"127.0.0.1\", 9000);\n"
                "    var server = try addr.listen(.{ .reuse_address = true });\n"
                "    defer server.deinit();\n"
                "    std.debug.print(\"Listening on 127.0.0.1:9000\\n\", .{});\n\n"
                "    const conn = try server.accept();\n"
                "    defer conn.stream.close();\n"
                "    std.debug.print(\"Client connected\\n\", .{});\n\n"
                "    var buf: [1024]u8 = undefined;\n"
                "    var reader = conn.stream.reader();\n"
                "    var writer = conn.stream.writer();\n\n"
                "    while (true) {\n"
                "        const line = reader.readUntilDelimiter(&buf, '\\n') catch break;\n"
                "        // TODO: write \"echo: {line}\\n\" back to the client\n"
                "        try writer.print(\"echo: {s}\\n\", .{line});\n"
                "    }\n"
                "    std.debug.print(\"Client disconnected\\n\", .{});\n"
                "}\n"
            ),
        },
    ],
    13: [
        {
            "title": "IP Header Parser",
            "description": (
                "Parse a raw IPv4 header from a byte slice.\n\n"
                "An IPv4 header begins with:\n"
                "- bits [7:4] version (must be 4)\n"
                "- bits [3:0] IHL (header length in 32-bit words)\n"
                "- byte 1: DSCP/ECN\n"
                "- bytes 2-3: total length\n"
                "- bytes 8: TTL\n"
                "- byte 9: protocol\n"
                "- bytes 12-15: source IP\n"
                "- bytes 16-19: destination IP\n\n"
                "Return a `IpHeader` struct with these fields."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub const IpHeader = struct {\n"
                "    version: u4,\n"
                "    ihl: u4,\n"
                "    total_len: u16,\n"
                "    ttl: u8,\n"
                "    protocol: u8,\n"
                "    src: [4]u8,\n"
                "    dst: [4]u8,\n"
                "};\n\n"
                "pub fn parse_ip(raw: []const u8) !IpHeader {\n"
                "    if (raw.len < 20) return error.TooShort;\n"
                "    return .{\n"
                "        .version = @truncate(raw[0] >> 4),\n"
                "        .ihl = @truncate(raw[0] & 0x0f),\n"
                "        .total_len = std.mem.readInt(u16, raw[2..4], .big),\n"
                "        .ttl = raw[8],\n"
                "        .protocol = raw[9],\n"
                "        .src = raw[12..16][0..4].*,\n"
                "        .dst = raw[16..20][0..4].*,\n"
                "    };\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    // A real IPv4 header from a captured packet\n"
                "    const raw = [_]u8{ 0x45, 0x00, 0x00, 0x3c, 0x1c, 0x46, 0x40, 0x00,\n"
                "                       0x40, 0x06, 0x00, 0x00, 0xc0, 0xa8, 0x01, 0x01,\n"
                "                       0xc0, 0xa8, 0x01, 0x64 };\n"
                "    const hdr = try parse_ip(&raw);\n"
                "    std.debug.print(\"version={} ttl={} proto={}\\n\", .{ hdr.version, hdr.ttl, hdr.protocol });\n"
                "    std.debug.print(\"src={}.{}.{}.{}\\n\", .{ hdr.src[0], hdr.src[1], hdr.src[2], hdr.src[3] });\n"
                "    std.debug.print(\"dst={}.{}.{}.{}\\n\", .{ hdr.dst[0], hdr.dst[1], hdr.dst[2], hdr.dst[3] });\n"
                "}\n\n"
                "test \"parse ip header\" {\n"
                "    const raw = [_]u8{ 0x45, 0x00, 0x00, 0x3c, 0x1c, 0x46, 0x40, 0x00,\n"
                "                       0x40, 0x06, 0x00, 0x00, 0xc0, 0xa8, 0x01, 0x01,\n"
                "                       0xc0, 0xa8, 0x01, 0x64 };\n"
                "    const hdr = try parse_ip(&raw);\n"
                "    try std.testing.expectEqual(@as(u4, 4), hdr.version);\n"
                "    try std.testing.expectEqual(@as(u8, 64), hdr.ttl);\n"
                "    try std.testing.expectEqual([4]u8{ 192, 168, 1, 1 }, hdr.src);\n"
                "}\n"
            ),
        },
    ],
    14: [
        {
            "title": "Length-Prefixed Protocol",
            "description": (
                "Implement a simple binary framing protocol over a byte stream.\n\n"
                "Frame format: `[4-byte big-endian length][payload bytes]`\n\n"
                "Implement:\n"
                "- `send_frame(writer, payload)` — write a framed message\n"
                "- `recv_frame(ally, reader)` — read one complete frame, handling partial reads\n\n"
                "Test by writing 5 frames and reading them back."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub fn send_frame(writer: anytype, payload: []const u8) !void {\n"
                "    const len: u32 = @intCast(payload.len);\n"
                "    try writer.writeInt(u32, len, .big);\n"
                "    try writer.writeAll(payload);\n"
                "}\n\n"
                "pub fn recv_frame(ally: std.mem.Allocator, reader: anytype) ![]u8 {\n"
                "    const len = try reader.readInt(u32, .big);\n"
                "    const buf = try ally.alloc(u8, len);\n"
                "    // TODO: read exactly `len` bytes into buf\n"
                "    _ = buf;\n"
                "    return &.{};\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const ally = gpa.allocator();\n\n"
                "    var buf = std.ArrayList(u8).init(ally);\n"
                "    defer buf.deinit();\n"
                "    const writer = buf.writer();\n\n"
                "    const messages = [_][]const u8{ \"hello\", \"world\", \"zig is fast\", \"binary protocol\", \"frame 5\" };\n"
                "    for (messages) |msg| try send_frame(writer, msg);\n\n"
                "    var fbs = std.io.fixedBufferStream(buf.items);\n"
                "    const reader = fbs.reader();\n"
                "    for (messages) |expected| {\n"
                "        const frame = try recv_frame(ally, reader);\n"
                "        defer ally.free(frame);\n"
                "        std.debug.print(\"recv: {s}\\n\", .{frame});\n"
                "        std.debug.assert(std.mem.eql(u8, frame, expected));\n"
                "    }\n"
                "    std.debug.print(\"all frames OK\\n\", .{});\n"
                "}\n"
            ),
        },
    ],
    15: [
        {
            "title": "Heartbeat Failure Detector",
            "description": (
                "Implement a simple heartbeat-based failure detector.\n\n"
                "- A `Node` sends periodic heartbeats (simulated with timestamps).\n"
                "- A `Monitor` tracks the last heartbeat time per node.\n"
                "- `is_failed(node_id, timeout_ms)` returns true if no heartbeat was received within `timeout_ms`.\n\n"
                "Simulate a node stopping heartbeats and verify the detector catches it."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub const Monitor = struct {\n"
                "    last_heartbeat: std.AutoHashMap(u32, i64),\n\n"
                "    pub fn init(ally: std.mem.Allocator) Monitor {\n"
                "        return .{ .last_heartbeat = std.AutoHashMap(u32, i64).init(ally) };\n"
                "    }\n\n"
                "    pub fn deinit(self: *Monitor) void { self.last_heartbeat.deinit(); }\n\n"
                "    pub fn record(self: *Monitor, node_id: u32) !void {\n"
                "        try self.last_heartbeat.put(node_id, std.time.milliTimestamp());\n"
                "    }\n\n"
                "    pub fn is_failed(self: *const Monitor, node_id: u32, timeout_ms: i64) bool {\n"
                "        // TODO: return true if node hasn't sent a heartbeat within timeout_ms\n"
                "        _ = node_id; _ = timeout_ms;\n"
                "        return false;\n"
                "    }\n"
                "};\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    var mon = Monitor.init(gpa.allocator());\n"
                "    defer mon.deinit();\n\n"
                "    try mon.record(1);\n"
                "    try mon.record(2);\n"
                "    std.time.sleep(200 * std.time.ns_per_ms);\n"
                "    try mon.record(1); // node 1 still alive\n"
                "    // node 2 stopped sending\n"
                "    std.time.sleep(200 * std.time.ns_per_ms);\n\n"
                "    std.debug.print(\"node1 failed? {}\\n\", .{mon.is_failed(1, 300)});\n"
                "    std.debug.print(\"node2 failed? {}\\n\", .{mon.is_failed(2, 300)});\n"
                "}\n"
            ),
        },
    ],
    16: [
        {
            "title": "Raft Leader Election",
            "description": (
                "Implement the election half of Raft consensus.\n\n"
                "Each `RaftNode` has a `term`, `state` (follower/candidate/leader), and a `voted_for` field.\n\n"
                "Implement:\n"
                "- `start_election()` — increment term, transition to candidate, vote for self\n"
                "- `receive_vote_request(candidate_term, candidate_id)` — grant vote if candidate term > self term and haven't voted\n"
                "- `receive_votes(count, total)` — if majority, become leader\n\n"
                "Test a 3-node election where node 0 wins."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "const State = enum { follower, candidate, leader };\n\n"
                "pub const RaftNode = struct {\n"
                "    id: u32,\n"
                "    term: u64 = 0,\n"
                "    state: State = .follower,\n"
                "    voted_for: ?u32 = null,\n\n"
                "    pub fn start_election(self: *RaftNode) void {\n"
                "        // TODO: increment term, become candidate, vote for self\n"
                "        self.term += 1;\n"
                "        self.state = .candidate;\n"
                "        self.voted_for = self.id;\n"
                "    }\n\n"
                "    pub fn receive_vote_request(self: *RaftNode, candidate_term: u64, candidate_id: u32) bool {\n"
                "        // TODO: grant vote if candidate_term > self.term and haven't voted\n"
                "        if (candidate_term > self.term) {\n"
                "            self.term = candidate_term;\n"
                "            self.state = .follower;\n"
                "            self.voted_for = candidate_id;\n"
                "            return true;\n"
                "        }\n"
                "        if (candidate_term == self.term and self.voted_for == null) {\n"
                "            self.voted_for = candidate_id;\n"
                "            return true;\n"
                "        }\n"
                "        return false;\n"
                "    }\n\n"
                "    pub fn tally_votes(self: *RaftNode, votes: u32, total: u32) void {\n"
                "        // TODO: become leader if votes > total / 2\n"
                "        if (votes * 2 > total) self.state = .leader;\n"
                "    }\n"
                "};\n\n"
                "pub fn main() void {\n"
                "    var nodes = [_]RaftNode{\n"
                "        .{ .id = 0 }, .{ .id = 1 }, .{ .id = 2 },\n"
                "    };\n"
                "    nodes[0].start_election();\n"
                "    var votes: u32 = 1; // voted for self\n"
                "    for (nodes[1..]) |*n| {\n"
                "        if (n.receive_vote_request(nodes[0].term, nodes[0].id)) votes += 1;\n"
                "    }\n"
                "    nodes[0].tally_votes(votes, nodes.len);\n"
                "    std.debug.print(\"node0 state={s} term={}\\n\", .{ @tagName(nodes[0].state), nodes[0].term });\n"
                "}\n\n"
                "test \"leader election\" {\n"
                "    var nodes = [_]RaftNode{ .{ .id = 0 }, .{ .id = 1 }, .{ .id = 2 } };\n"
                "    nodes[0].start_election();\n"
                "    var votes: u32 = 1;\n"
                "    for (nodes[1..]) |*n| { if (n.receive_vote_request(nodes[0].term, 0)) votes += 1; }\n"
                "    nodes[0].tally_votes(votes, 3);\n"
                "    try std.testing.expectEqual(State.leader, nodes[0].state);\n"
                "    try std.testing.expectEqual(@as(u64, 1), nodes[0].term);\n"
                "}\n"
            ),
        },
    ],
    17: [
        {
            "title": "Simple Transaction Log",
            "description": (
                "Implement a key-value store backed by a transaction log.\n\n"
                "Operations: `set(key, value)` and `delete(key)`.\n\n"
                "Each operation is appended to an in-memory log as a `LogEntry`.\n"
                "`commit()` applies all pending entries to the state map.\n"
                "`rollback()` discards pending entries without applying them.\n\n"
                "This is the core of ARIES-style transaction logging."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "const Op = enum { set, delete };\n"
                "const LogEntry = struct { op: Op, key: []const u8, value: []const u8 };\n\n"
                "pub const TxStore = struct {\n"
                "    state: std.StringHashMap([]const u8),\n"
                "    log: std.ArrayList(LogEntry),\n"
                "    ally: std.mem.Allocator,\n\n"
                "    pub fn init(ally: std.mem.Allocator) TxStore {\n"
                "        return .{\n"
                "            .state = std.StringHashMap([]const u8).init(ally),\n"
                "            .log = std.ArrayList(LogEntry).init(ally),\n"
                "            .ally = ally,\n"
                "        };\n"
                "    }\n\n"
                "    pub fn deinit(self: *TxStore) void {\n"
                "        self.state.deinit();\n"
                "        self.log.deinit();\n"
                "    }\n\n"
                "    pub fn set(self: *TxStore, key: []const u8, value: []const u8) !void {\n"
                "        try self.log.append(.{ .op = .set, .key = key, .value = value });\n"
                "    }\n\n"
                "    pub fn delete(self: *TxStore, key: []const u8) !void {\n"
                "        try self.log.append(.{ .op = .delete, .key = key, .value = \"\" });\n"
                "    }\n\n"
                "    pub fn commit(self: *TxStore) !void {\n"
                "        // TODO: apply all log entries to self.state, then clear log\n"
                "        _ = self;\n"
                "    }\n\n"
                "    pub fn rollback(self: *TxStore) void {\n"
                "        self.log.clearRetainingCapacity();\n"
                "    }\n\n"
                "    pub fn get(self: *const TxStore, key: []const u8) ?[]const u8 {\n"
                "        return self.state.get(key);\n"
                "    }\n"
                "};\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    var store = TxStore.init(gpa.allocator());\n"
                "    defer store.deinit();\n\n"
                "    try store.set(\"name\", \"Alice\");\n"
                "    try store.set(\"age\", \"30\");\n"
                "    try store.commit();\n"
                "    std.debug.print(\"name={s}\\n\", .{store.get(\"name\") orelse \"null\"});\n\n"
                "    try store.set(\"name\", \"Bob\");\n"
                "    store.rollback();\n"
                "    std.debug.print(\"after rollback name={s}\\n\", .{store.get(\"name\") orelse \"null\"});\n"
                "}\n"
            ),
        },
    ],
    18: [
        {
            "title": "Token Bucket Rate Limiter",
            "description": (
                "Implement a token bucket rate limiter.\n\n"
                "- Bucket capacity: `max_tokens`\n"
                "- Refill rate: `tokens_per_second`\n"
                "- `allow()` — returns `true` if a token is available (consumes one), `false` otherwise\n"
                "- Tokens refill based on elapsed real time\n\n"
                "Test by simulating 100 requests at 10 rps limit."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub const TokenBucket = struct {\n"
                "    tokens: f64,\n"
                "    max_tokens: f64,\n"
                "    tokens_per_ns: f64,\n"
                "    last_refill: i64,\n\n"
                "    pub fn init(max_tokens: f64, tokens_per_second: f64) TokenBucket {\n"
                "        return .{\n"
                "            .tokens = max_tokens,\n"
                "            .max_tokens = max_tokens,\n"
                "            .tokens_per_ns = tokens_per_second / std.time.ns_per_s,\n"
                "            .last_refill = std.time.nanoTimestamp(),\n"
                "        };\n"
                "    }\n\n"
                "    pub fn allow(self: *TokenBucket) bool {\n"
                "        const now = std.time.nanoTimestamp();\n"
                "        const elapsed = now - self.last_refill;\n"
                "        self.tokens = @min(\n"
                "            self.max_tokens,\n"
                "            self.tokens + @as(f64, @floatFromInt(elapsed)) * self.tokens_per_ns,\n"
                "        );\n"
                "        self.last_refill = now;\n"
                "        // TODO: consume a token if available\n"
                "        if (self.tokens >= 1.0) {\n"
                "            self.tokens -= 1.0;\n"
                "            return true;\n"
                "        }\n"
                "        return false;\n"
                "    }\n"
                "};\n\n"
                "pub fn main() void {\n"
                "    var bucket = TokenBucket.init(10, 10); // 10 rps\n"
                "    var allowed: u32 = 0;\n"
                "    var denied: u32 = 0;\n"
                "    for (0..100) |_| {\n"
                "        if (bucket.allow()) { allowed += 1; } else { denied += 1; }\n"
                "        std.time.sleep(50 * std.time.ns_per_ms); // 20 rps attempt\n"
                "    }\n"
                "    std.debug.print(\"allowed={} denied={}\\n\", .{ allowed, denied });\n"
                "}\n"
            ),
        },
        {
            "title": "Consistent Hashing Ring",
            "description": (
                "Implement a consistent hash ring for distributing keys across nodes.\n\n"
                "- Add/remove nodes using virtual nodes (each physical node has `replicas` virtual slots).\n"
                "- `get_node(key)` — return the node responsible for the key by finding the next\n"
                "  virtual node clockwise on the ring.\n\n"
                "Test: add 3 nodes, remove one, verify keys don't all remap."
            ),
            "exercise_type": "implementation",
            "order": 2,
            "is_required": False,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub const HashRing = struct {\n"
                "    ring: std.AutoArrayHashMap(u32, []const u8),\n"
                "    replicas: u32,\n\n"
                "    pub fn init(ally: std.mem.Allocator, replicas: u32) HashRing {\n"
                "        return .{ .ring = std.AutoArrayHashMap(u32, []const u8).init(ally), .replicas = replicas };\n"
                "    }\n\n"
                "    pub fn deinit(self: *HashRing) void { self.ring.deinit(); }\n\n"
                "    fn hash(key: []const u8) u32 { return std.hash.Adler32.hash(key); }\n\n"
                "    pub fn add_node(self: *HashRing, name: []const u8) !void {\n"
                "        var buf: [64]u8 = undefined;\n"
                "        for (0..self.replicas) |i| {\n"
                "            const vnode = try std.fmt.bufPrint(&buf, \"{s}:{}\", .{ name, i });\n"
                "            try self.ring.put(hash(vnode), name);\n"
                "        }\n"
                "    }\n\n"
                "    pub fn get_node(self: *const HashRing, key: []const u8) ?[]const u8 {\n"
                "        if (self.ring.count() == 0) return null;\n"
                "        const h = hash(key);\n"
                "        // TODO: find the next clockwise virtual node >= h\n"
                "        // Hint: iterate sorted keys, return first key >= h, or wrap around\n"
                "        _ = h;\n"
                "        return null;\n"
                "    }\n"
                "};\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    var ring = HashRing.init(gpa.allocator(), 3);\n"
                "    defer ring.deinit();\n"
                "    try ring.add_node(\"node-a\");\n"
                "    try ring.add_node(\"node-b\");\n"
                "    try ring.add_node(\"node-c\");\n"
                "    const keys = [_][]const u8{ \"user:1\", \"user:2\", \"order:42\", \"session:xyz\" };\n"
                "    for (keys) |k| {\n"
                "        std.debug.print(\"{s} -> {s}\\n\", .{ k, ring.get_node(k) orelse \"none\" });\n"
                "    }\n"
                "}\n"
            ),
        },
    ],
    19: [
        {
            "title": "ZigKV: RESP Protocol Parser",
            "description": (
                "Start building ZigKV by implementing the RESP (Redis Serialization Protocol) parser.\n\n"
                "Parse the following RESP types:\n"
                "- Simple strings: `+OK\\r\\n`\n"
                "- Errors: `-ERR message\\r\\n`\n"
                "- Integers: `:42\\r\\n`\n"
                "- Bulk strings: `$5\\r\\nhello\\r\\n`\n"
                "- Arrays: `*2\\r\\n$3\\r\\nGET\\r\\n$5\\r\\nmykey\\r\\n`\n\n"
                "Return a tagged union `RespValue` and implement `parse(input: []const u8)`."
            ),
            "exercise_type": "implementation",
            "order": 1,
            "is_required": True,
            "starter_code": (
                "const std = @import(\"std\");\n\n"
                "pub const RespValue = union(enum) {\n"
                "    simple: []const u8,\n"
                "    err: []const u8,\n"
                "    integer: i64,\n"
                "    bulk: []const u8,\n"
                "    array: []RespValue,\n"
                "    null_bulk,\n"
                "};\n\n"
                "pub const ParseResult = struct { value: RespValue, consumed: usize };\n\n"
                "pub fn parse(ally: std.mem.Allocator, input: []const u8) !ParseResult {\n"
                "    if (input.len == 0) return error.Empty;\n"
                "    return switch (input[0]) {\n"
                "        '+' => blk: {\n"
                "            const end = std.mem.indexOf(u8, input, \"\\r\\n\") orelse return error.Incomplete;\n"
                "            break :blk .{ .value = .{ .simple = input[1..end] }, .consumed = end + 2 };\n"
                "        },\n"
                "        '-' => blk: {\n"
                "            const end = std.mem.indexOf(u8, input, \"\\r\\n\") orelse return error.Incomplete;\n"
                "            break :blk .{ .value = .{ .err = input[1..end] }, .consumed = end + 2 };\n"
                "        },\n"
                "        ':' => blk: {\n"
                "            const end = std.mem.indexOf(u8, input, \"\\r\\n\") orelse return error.Incomplete;\n"
                "            const n = try std.fmt.parseInt(i64, input[1..end], 10);\n"
                "            break :blk .{ .value = .{ .integer = n }, .consumed = end + 2 };\n"
                "        },\n"
                "        '$' => blk: {\n"
                "            // TODO: parse bulk string\n"
                "            _ = ally;\n"
                "            break :blk error.NotImplemented;\n"
                "        },\n"
                "        '*' => blk: {\n"
                "            // TODO: parse array\n"
                "            break :blk error.NotImplemented;\n"
                "        },\n"
                "        else => error.InvalidType,\n"
                "    };\n"
                "}\n\n"
                "pub fn main() !void {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const ally = gpa.allocator();\n\n"
                "    const r1 = try parse(ally, \"+OK\\r\\n\");\n"
                "    std.debug.print(\"simple: {s}\\n\", .{r1.value.simple});\n\n"
                "    const r2 = try parse(ally, \":42\\r\\n\");\n"
                "    std.debug.print(\"integer: {}\\n\", .{r2.value.integer});\n"
                "}\n\n"
                "test \"resp simple\" {\n"
                "    var gpa = std.heap.GeneralPurposeAllocator(.{}){};\n"
                "    defer _ = gpa.deinit();\n"
                "    const r = try parse(gpa.allocator(), \"+PONG\\r\\n\");\n"
                "    try std.testing.expectEqualStrings(\"PONG\", r.value.simple);\n"
                "    try std.testing.expectEqual(@as(usize, 7), r.consumed);\n"
                "}\n"
            ),
        },
    ],
}


class Command(BaseCommand):
    help = "Seed exercises for all curriculum modules"

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing exercises before seeding")

    def handle(self, *args, **options):
        if options["reset"]:
            Exercise.objects.all().delete()
            self.stdout.write("Existing exercises deleted.")

        total = 0
        for module_number, exercises in EXERCISES.items():
            try:
                module = Module.objects.get(number=module_number)
            except Module.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"Module {module_number} not found — run seed_curriculum first"))
                continue

            for ex_data in exercises:
                ex, created = Exercise.objects.get_or_create(
                    module=module,
                    title=ex_data["title"],
                    defaults={
                        "description": ex_data["description"],
                        "exercise_type": ex_data["exercise_type"],
                        "order": ex_data["order"],
                        "is_required": ex_data["is_required"],
                        "starter_code": ex_data["starter_code"],
                    },
                )
                if created:
                    total += 1
                    self.stdout.write(f"  M{module_number}: {ex.title}")

        self.stdout.write(self.style.SUCCESS(f"Seeded {total} exercises."))
