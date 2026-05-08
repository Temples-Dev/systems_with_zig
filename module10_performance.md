# Module 10: Performance Evaluation and Measurement

## The Craft of Systems Programming — Teaching Material

---

> *"Premature optimization is the root of all evil — but so is premature pessimization. The craft is knowing which you're doing, and the only way to know is to measure."*

---

## Before You Begin

Every module in this curriculum has involved measurement. You measured cache miss rates in Module 6, context switch costs in Module 7, atomic operation latencies in Module 8, and page cache throughput in Module 9. But measurement has been in service of specific topics — a tool, not a subject.

This module makes measurement the subject itself.

Performance analysis is a discipline. It has methodologies, failure modes, and tools with specific capabilities and specific blind spots. A programmer who measures carelessly — who reports averages instead of percentiles, who lets the compiler eliminate the code under test, who interprets correlation as causation — produces numbers that are worse than useless because they are confidently wrong.

This module teaches you to measure correctly, to profile systematically, to generate flame graphs that show exactly where CPU time goes, and to apply the USE Method to diagnose bottlenecks in complex systems. The skills here apply to everything you will build for the rest of your career.

---

## Learning Objectives

By the end of this module, you will be able to:

- Apply the USE Method to identify resource bottlenecks in a system
- Write correct microbenchmarks in Zig that resist dead code elimination and avoid measurement artifacts
- Explain the difference between latency percentiles and why mean is often the wrong metric
- Explain coordinated omission and correct for it in latency benchmarks
- Use `perf stat` to count hardware events and interpret the output
- Use `perf record` and `perf report` to identify CPU hotspots at the function and instruction level
- Generate and interpret CPU flame graphs using Brendan Gregg's FlameGraph toolchain
- Use `valgrind --tool=callgrind` for instruction-level profiling
- Distinguish between CPU-bound and I/O-bound bottlenecks and apply appropriate tools to each
- Implement a benchmark framework in Zig with warmup, statistical reporting, and defense against optimization

---

## Part 1: Methodology — The USE Method

### 1.1 Why You Need a Methodology

Ad-hoc performance investigation is expensive and unreliable. Without a systematic approach, you chase the wrong bottleneck, collect irrelevant data, and draw incorrect conclusions. The most common failure: optimizing a function that consumes 3% of CPU time while the function consuming 60% goes unexamined because it was never profiled.

A methodology gives you a checklist: what to measure first, how to interpret what you find, and when to stop digging. Brendan Gregg's **USE Method** is the standard for systems performance analysis. It is simple, comprehensive, and fast.

### 1.2 The USE Method

For every resource in the system, check three things:

**Utilization:** What fraction of the time is the resource busy (as opposed to idle)? A resource at 100% utilization is a bottleneck candidate. A resource at 20% utilization is not your problem — move on.

**Saturation:** Is work queuing up because the resource cannot keep up? Saturation means threads or requests are waiting, not just that the resource is busy. A CPU at 80% utilization with no saturation is fine. A CPU at 80% utilization with 50 threads in the run queue is a problem.

**Errors:** Is the resource reporting errors? A network interface dropping packets has 0% error rate on most metrics but is actually saturated. Errors often appear before saturation is visible in standard metrics.

The resources to check:

| Resource | Utilization | Saturation | Errors |
|----------|-------------|------------|--------|
| CPU | `mpstat`, `top` %usr+%sys | `vmstat` r > CPU count | `perf stat` errors |
| Memory | `free` used/total | `vmstat` si/so (swap) | `dmesg` OOM kills |
| Disk I/O | `iostat` %util | `iostat` await vs svctm | `smartctl` errors |
| Network | `ip -s link` RX/TX bytes | drops, retransmits | `netstat -s` errors |
| File system | `df` usage | disk full on writes | `dmesg` fs errors |
| Threads | thread count | run queue length | panics, crashes |

The USE Method is fast because it tells you what to skip. If CPU utilization is 5%, don't investigate CPU. If memory saturation is zero, don't investigate memory. Focus only on the resources showing high utilization or saturation.

### 1.3 The Performance Investigation Workflow

```
1. Define the performance problem precisely:
   "The server handles 1000 requests/second at 50ms p99 latency
    but we need 5000 req/s at <100ms p99."

2. Apply the USE Method:
   Measure utilization and saturation for all resources.
   Identify which resource(s) are at high utilization or saturated.

3. Profile the identified resource:
   If CPU: use perf record + flame graphs
   If memory: use valgrind massif or heaptrack
   If I/O: use iostat, strace, blktrace

4. Identify the root cause:
   Distinguish symptoms (high CPU) from causes (inefficient algorithm,
   cache-hostile data layout, unnecessary allocations).

5. Fix and measure:
   One change at a time. Measure before and after.
   Verify the metric that was the original problem improved.

6. Stop when the target is met.
   "Fast enough" is a valid stopping point.
```

---

## Part 2: Correct Microbenchmarking

### 2.1 The Problems with Naive Benchmarks

Microbenchmarks are small, focused programs that measure the performance of a specific operation. They are indispensable for understanding low-level performance. They are also one of the most commonly misused tools in software development.

The four most common microbenchmark mistakes:

**Dead code elimination.** The compiler is smarter than you. If it can prove the result of a computation is never used, it will eliminate the computation entirely. A benchmark that measures "how long does this function take?" may actually be measuring "how long does nothing take?" if the result is discarded.

**Warm-up effects.** The first iterations of a benchmark are slower than subsequent ones: the instruction cache is cold, the branch predictor has not learned the pattern, the data is not in the CPU cache. A benchmark that reports the time of the first iteration reports cold-start performance, not steady-state performance.

**Measurement overhead.** Reading a clock takes time. On modern hardware, `clock_gettime()` costs ~20ns. Benchmarking an operation that takes 1ns by surrounding it with clock calls inflates the measured time by 20x.

**Insufficient iterations.** A single measurement of a 1µs operation has enormous variance. OS scheduling interrupts, cache effects, branch predictor resets, and thermal throttling all introduce noise. A single measurement means nothing. You need enough iterations to establish statistical significance.

### 2.2 Zig's `doNotOptimizeAway`

The standard defense against dead code elimination:

```zig
const std = @import("std");

pub fn main() void {
    var x: u64 = 42;

    // BAD: compiler may eliminate this entire loop
    for (0..1_000_000) |_| {
        x = x *% 6364136223846793005 +% 1442695040888963407;
    }
    // x is computed but never observed — might be optimized away

    // GOOD: force the compiler to treat x as observable
    std.mem.doNotOptimizeAway(x);

    // Even better: use the result in a way the compiler cannot predict
    std.debug.print("{d}\n", .{x});
}
```

`std.mem.doNotOptimizeAway` inserts an opaque memory barrier that prevents the compiler from proving the value is unused. It does not actually read or write the value — it just tells the optimizer "this value escapes to some unknown consumer."

For benchmarking memory operations, also use `doNotOptimizeAway` on the input to prevent the compiler from constant-folding:

```zig
fn benchmark_hash(data: []const u8) u64 {
    // Without this, the compiler might constant-fold the hash result
    // if data is a compile-time-known literal
    std.mem.doNotOptimizeAway(data.ptr);
    return hash_function(data);
}
```

### 2.3 A Correct Benchmark Framework in Zig

```zig
const std = @import("std");

pub const BenchResult = struct {
    name: []const u8,
    iterations: u64,
    total_ns: u64,
    min_ns: u64,
    max_ns: u64,
    median_ns: u64,
    p99_ns: u64,

    pub fn ns_per_iter(self: BenchResult) f64 {
        return @as(f64, @floatFromInt(self.total_ns)) /
               @as(f64, @floatFromInt(self.iterations));
    }

    pub fn print(self: BenchResult) void {
        std.debug.print("{s:<30} {d:>8.1} ns/iter  " ++
            "min={d} max={d} p99={d} ({d} iters)\n", .{
            self.name,
            self.ns_per_iter(),
            self.min_ns,
            self.max_ns,
            self.p99_ns,
            self.iterations,
        });
    }
};

pub fn bench(
    name: []const u8,
    comptime func: anytype,
    args: anytype,
    allocator: std.mem.Allocator,
) !BenchResult {
    const WARMUP_ITERS: usize = 100;
    const MEASURE_ITERS: usize = 1000;

    // Warm up: run without measuring to prime caches and branch predictor
    for (0..WARMUP_ITERS) |_| {
        const result = @call(.auto, func, args);
        std.mem.doNotOptimizeAway(result);
    }

    // Collect individual iteration timings
    const timings = try allocator.alloc(u64, MEASURE_ITERS);
    defer allocator.free(timings);

    var timer = try std.time.Timer.start();

    for (timings) |*t| {
        timer.reset();
        const result = @call(.auto, func, args);
        t.* = timer.read();
        std.mem.doNotOptimizeAway(result);
    }

    // Compute statistics
    std.mem.sort(u64, timings, {}, std.sort.asc(u64));

    var total: u64 = 0;
    var min_t: u64 = timings[0];
    var max_t: u64 = timings[0];

    for (timings) |t| {
        total += t;
        if (t < min_t) min_t = t;
        if (t > max_t) max_t = t;
    }

    const median = timings[MEASURE_ITERS / 2];
    const p99 = timings[MEASURE_ITERS * 99 / 100];

    return .{
        .name = name,
        .iterations = MEASURE_ITERS,
        .total_ns = total,
        .min_ns = min_t,
        .max_ns = max_t,
        .median_ns = median,
        .p99_ns = p99,
    };
}

// Example usage:
fn add_numbers(a: u64, b: u64) u64 { return a + b; }
fn hash_djb2(data: []const u8) u64 {
    var h: u64 = 5381;
    for (data) |c| h = h *% 33 +% c;
    return h;
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const r1 = try bench("add_numbers", add_numbers, .{42, 58}, allocator);
    r1.print();

    const data = "Hello, World! This is a test string for hashing.";
    const r2 = try bench("hash_djb2", hash_djb2, .{data}, allocator);
    r2.print();
}
```

### 2.4 Percentiles vs Mean — Why Mean Lies

The mean (average) latency is almost always the wrong metric for performance reporting. Mean hides the shape of the distribution. Consider two systems both with 1ms average latency:

**System A:** 999 requests at 0.5ms, 1 request at 500ms. Mean: ~1ms.

**System B:** All 1000 requests at 1ms. Mean: 1ms.

These systems are radically different. System A has a tail latency problem — 0.1% of requests take 500ms. System B is perfectly uniform. Users experience the tail. The user who hits the 500ms request from System A is not comforted by the 0.5ms average.

The correct metrics for latency:

- **p50 (median):** Half of requests are faster, half are slower. More representative than mean when distributions are skewed.
- **p95:** 95% of requests are faster. Shows typical "slow" experience.
- **p99:** 99% of requests are faster. Shows the tail that 1 in 100 users experiences.
- **p99.9:** The worst 0.1% of requests. Critical for services with SLAs.
- **max:** The worst single request. Useful for debugging outliers.

```zig
pub fn print_latency_percentiles(timings_ns: []u64) void {
    // timings_ns must be sorted
    std.mem.sort(u64, timings_ns, {}, std.sort.asc(u64));

    const n = timings_ns.len;
    const p = struct {
        fn at(ts: []u64, pct: f64) u64 {
            const idx: usize = @intFromFloat(@as(f64, @floatFromInt(ts.len)) * pct);
            return ts[@min(idx, ts.len - 1)];
        }
    };

    std.debug.print("Latency distribution ({d} samples):\n", .{n});
    std.debug.print("  p50:   {d:>8} ns\n", .{p.at(timings_ns, 0.50)});
    std.debug.print("  p75:   {d:>8} ns\n", .{p.at(timings_ns, 0.75)});
    std.debug.print("  p90:   {d:>8} ns\n", .{p.at(timings_ns, 0.90)});
    std.debug.print("  p95:   {d:>8} ns\n", .{p.at(timings_ns, 0.95)});
    std.debug.print("  p99:   {d:>8} ns\n", .{p.at(timings_ns, 0.99)});
    std.debug.print("  p99.9: {d:>8} ns\n", .{p.at(timings_ns, 0.999)});
    std.debug.print("  max:   {d:>8} ns\n", .{timings_ns[n - 1]});

    var total: u64 = 0;
    for (timings_ns) |t| total += t;
    const mean = total / n;
    std.debug.print("  mean:  {d:>8} ns  ← often misleading\n", .{mean});
}
```

### 2.5 Coordinated Omission

**Coordinated omission** is one of the most pervasive and pernicious bugs in performance benchmarking. It causes benchmarks to dramatically underreport tail latency.

The scenario: a load generator sends requests at 1000 req/s (one per millisecond). It measures response time by recording when it sent the request and when it received the response. When the system experiences a hiccup — one request takes 100ms instead of 1ms — the load generator *waits* for the response before sending the next request. During those 100ms, 99 requests that *should* have been in-flight simply were not sent.

The result: the benchmark reports one 100ms response and everything else at ~1ms. But from a user perspective, during that 100ms window, 99 users were also waiting — they just weren't counted because the load generator never sent their requests.

**The fix:** Track not when each request was actually sent, but when it *should have been* sent according to the target rate. Every operation that was delayed contributes its entire wait time to the latency measurement.

```zig
/// Correct latency measurement using intended send time.
/// Avoids coordinated omission by tracking when operations SHOULD have started.
pub fn benchmark_with_intended_time(
    target_rate_per_sec: u64,
    duration_sec: u64,
    operation: *const fn () void,
    allocator: std.mem.Allocator,
) ![]u64 {
    const interval_ns: u64 = 1_000_000_000 / target_rate_per_sec;
    const total_ops = target_rate_per_sec * duration_sec;

    const latencies = try allocator.alloc(u64, total_ops);
    errdefer allocator.free(latencies);

    var timer = try std.time.Timer.start();
    const start_time = timer.read();

    for (latencies, 0..) |*lat, i| {
        // When this operation SHOULD have started (not when it actually did)
        const intended_start = start_time + @as(u64, @intCast(i)) * interval_ns;

        // Wait until intended start time (if we're ahead of schedule)
        while (timer.read() < intended_start) {
            std.atomic.spinLoopHint();
        }

        // Run the operation
        const actual_start = timer.read();
        operation();
        const end = timer.read();

        // Latency includes all waiting time from intended start
        // Not just the operation duration from actual start
        lat.* = end - intended_start;
        _ = actual_start; // for reference: operation time = end - actual_start
    }

    return latencies;
}
```

The difference between `end - actual_start` (naive) and `end - intended_start` (correct) is the coordinated omission correction. For bursty systems, this correction can change reported p99 latency by 10-100x.

---

> **Exercise 10.1: Benchmarking the KV Store**
>
> Take the `PersistentKvStore` from Module 9 and benchmark it correctly:
>
> 1. Write a benchmark that measures `put` latency using the intended-time approach at 10,000 ops/sec for 60 seconds
> 2. Measure `get` latency at 50,000 ops/sec for 60 seconds (90% reads, 10% writes workload)
> 3. Report p50, p95, p99, p99.9, and max for each operation
> 4. Compare the naive measurement (time the operation only) vs the corrected measurement (time from intended start)
> 5. By how much does coordinated omission inflate the "performance" in your naive benchmark?

---

## Part 3: The perf Tool

### 3.1 What perf Is

`perf` is the standard Linux performance analysis tool. It wraps the kernel's `perf_events` subsystem, which provides access to hardware performance counters (PMCs) — registers inside the CPU that count hardware events at the cycle level.

Hardware events `perf` can count:
- **CPU cycles:** Raw clock cycles consumed
- **Instructions retired:** Instructions that completed execution
- **Cache misses:** L1, L2, L3 data and instruction cache misses
- **Branch mispredictions:** Branches where the predictor guessed wrong
- **Page faults:** TLB misses requiring page table walks
- **Context switches:** Scheduled preemptions
- **Memory bandwidth:** Bytes loaded from and stored to memory

`perf` can also sample these events: at every Nth occurrence of an event, it records the current stack trace. This produces a profile showing *where* in the program the events are occurring.

### 3.2 perf stat — Counting Events

`perf stat` runs a program and reports event counts at the end:

```bash
# Default stats: cycles, instructions, cache references, cache misses,
#                branches, branch misses, page faults, context switches
perf stat ./your_program

# Specific events
perf stat -e cycles,instructions,L1-dcache-load-misses,LLC-load-misses ./prog

# Run 5 times and show variance (essential for reliability)
perf stat -r 5 ./prog

# System-wide for 10 seconds (requires root)
perf stat -a sleep 10
```

**Reading perf stat output:**

```
Performance counter stats for './matrix_multiply':

     12,345,678,901      cycles                    #    3.21 GHz
      8,901,234,567      instructions              #    0.72  insn per cycle
      1,234,567,890      L1-dcache-load-misses     #   45.67% of all L1 dcache hits
        234,567,890      LLC-load-misses           #   12.34% of all LL-cache hits
         45,678,901      branch-misses             #    5.67% of all branches

       3.845123456 seconds time elapsed
```

**Instructions per cycle (IPC):** A healthy value is 1.0-4.0 for compute-intensive code. If IPC is low (< 0.5), the CPU is stalling — likely waiting for memory.

**L1 miss rate > 5%:** Cache-hostile access patterns. Revisit data layout (Module 6).

**LLC miss rate > 1%:** Working set exceeds L3 cache. Data is fetching from main memory.

**Branch miss rate > 5%:** Unpredictable branches. Consider branchless alternatives or data sorting.

### 3.3 Compile Flags for Profiling

Before profiling, compile with these flags for useful output:

```bash
# Good for profiling: optimized but with frame pointers and debug symbols
zig build-exe src/main.zig \
    -O ReleaseFast \
    -fno-omit-frame-pointer  # essential for stack unwinding in perf

# Debug symbols improve symbol resolution in perf report
# Use ReleaseSafe instead of ReleaseFast to keep debug info
zig build-exe src/main.zig -O ReleaseSafe
```

The `-fno-omit-frame-pointer` flag is critical. Modern compilers omit the frame pointer (`rbp`) as a free register optimization (Module 2). Without it, `perf` cannot walk the call stack to reconstruct the call chain — you get samples attributed to leaf functions with no context about who called them.

### 3.4 perf record — Sampling

`perf record` runs a program while sampling at a specified rate, recording the call stack at each sample:

```bash
# Basic CPU profiling at 99 Hz (99 samples/second)
# 99 Hz instead of 100 Hz to avoid synchronization with timer interrupts
perf record -F 99 -g ./your_program

# Profile with call graph (stack traces)
perf record -F 99 -g --call-graph=fp ./your_program
# --call-graph=fp uses frame pointers (fast, requires -fno-omit-frame-pointer)
# --call-graph=dwarf uses debug info (slower, works without frame pointers)

# Profile a specific event instead of time
perf record -e LLC-load-misses -g ./your_program
# Samples on LLC misses: shows WHERE cache misses occur

# Profile a running process by PID
perf record -F 99 -g -p 1234 sleep 30
```

### 3.5 perf report — Analyzing Samples

After `perf record`, analyze the samples:

```bash
# Interactive TUI (recommended)
perf report

# Text output (good for scripting)
perf report --stdio

# With call graph in text mode
perf report --stdio --call-graph=fractal,5
```

**Reading perf report:**

```
Overhead  Command      Shared Object     Symbol
  45.23%  matrix_mul   matrix_mul        [.] inner_loop
  23.11%  matrix_mul   libc.so.6         [.] memcpy
  12.44%  matrix_mul   matrix_mul        [.] compute_row
   8.91%  matrix_mul   [kernel]          [.] page_fault_handler
```

- **Overhead:** Percentage of CPU samples attributed to this symbol
- **Command:** Which program
- **Shared Object:** Which binary or library
- **Symbol:** Function name (`.` = user space, `k` = kernel)

**Interactive TUI navigation:**
- Arrow keys: navigate
- Enter: expand call graph for selected symbol
- `a`: annotate selected function with assembly
- `h`: help
- `q`: quit

### 3.6 perf annotate — Instruction-Level Attribution

After identifying a hot function, get instruction-level detail:

```bash
# From within perf report TUI: press 'a' on a symbol
# Or from command line:
perf annotate --symbol=inner_loop --stdio
```

Output shows each assembly instruction with the percentage of samples hitting it:

```
inner_loop():
  0.12 │      mov    (%rbx),%rax
 56.34 │      vmovss (%rax,%rdx,4),%xmm0    ← most time here (cache miss!)
  0.08 │      add    $0x1,%rdx
  0.43 │      vaddss %xmm0,%xmm1,%xmm1
  0.12 │      cmp    %rcx,%rdx
  0.04 │  ↑   jl     inner_loop
```

The 56% hot spot on the `vmovss` load confirms a cache miss bottleneck — this is where the CPU is stalling waiting for data from memory.

---

## Part 4: Flame Graphs

### 4.1 What Flame Graphs Show

A **flame graph** is a visualization of profiled call stacks. It is the most effective tool for answering: "Where is my CPU time going?"

The x-axis represents time (or sample count). A wider bar means more time in that function. The y-axis represents call depth — the bottom is the root of the call stack, the top is the leaf function executing at sample time.

Each frame in the flame graph represents a function. The frames above it are its callees. The frames below it are its callers. Reading upward traces a path from a top-level function (like `main`) to the specific function that was doing work when the sample was taken.

A "flame" shape — wide at the bottom, narrowing toward the top — shows a function that dominates CPU time through a deep call chain.

### 4.2 Generating Flame Graphs

```bash
# 1. Install FlameGraph tools
git clone https://github.com/brendangregg/FlameGraph
cd FlameGraph

# 2. Record samples with call stacks
perf record -F 99 -g --call-graph=fp ./your_program

# 3. Convert to flame graph
perf script | ./stackcollapse-perf.pl | ./flamegraph.pl > flamegraph.svg

# Open in browser
firefox flamegraph.svg
```

For Zig programs specifically:

```bash
# Compile with frame pointers for correct stack unwinding
zig build-exe src/main.zig -O ReleaseSafe -fno-omit-frame-pointer

# Record
perf record -F 99 -g --call-graph=fp ./main

# Generate flame graph
perf script | \
    path/to/FlameGraph/stackcollapse-perf.pl | \
    path/to/FlameGraph/flamegraph.pl \
    --title "My Program CPU Profile" \
    --width 1600 \
    > profile.svg

xdg-open profile.svg
```

### 4.3 Reading a Flame Graph

```
main
├── process_requests (40%)
│   ├── parse_message (15%)
│   │   └── memcpy (12%)
│   └── hash_key (25%)
│       └── hash_djb2 (25%)
├── flush_to_disk (35%)
│   └── write (35%) ← system call
└── accept_connection (25%)
    └── epoll_wait (20%) ← blocked waiting for events
```

Key insights from reading a flame graph:

**Wide top-level frame:** This is your hot path. Start investigation here.

**Wide leaf frame:** CPU is spending most time in this function. If it is a hash function, algorithm work is the bottleneck. If it is `memcpy` or a load instruction, memory access is the bottleneck.

**System calls deep in the stack:** `read`, `write`, `epoll_wait` appearing as tall flame columns indicate I/O time. If `epoll_wait` is wide, the program is I/O-bound (waiting for events), not CPU-bound.

**`[kernel]` frames:** Kernel execution on behalf of the program. Page fault handlers, scheduler code, and I/O dispatch appear here.

### 4.4 Off-CPU Flame Graphs

CPU flame graphs show where the CPU is busy. **Off-CPU flame graphs** show where threads are *blocked* — sleeping, waiting for I/O, waiting for locks.

```bash
# Off-CPU analysis: requires root and newer kernel
perf record -e sched:sched_switch -g -a ./your_program
perf script | ./stackcollapse-perf.pl --pid | \
    ./flamegraph.pl --color=io --title="Off-CPU" > off-cpu.svg
```

If a program is slow but CPU utilization is low, it is blocked — off-CPU flame graphs show exactly what it is waiting for.

---

> **Exercise 10.2: Profile and Fix**
>
> Take this intentionally slow program:
>
> ```zig
> const std = @import("std");
>
> fn slow_sum(data: []const u64) u64 {
>     var total: u64 = 0;
>     // Process every 8th element (destroys cache locality)
>     var i: usize = 0;
>     while (i < data.len) : (i = (i + 8) % data.len + 1) {
>         total +%= data[i];
>     }
>     return total;
> }
>
> pub fn main() !void {
>     var gpa: std.heap.DebugAllocator(.{}) = .init;
>     defer _ = gpa.deinit();
>     const allocator = gpa.allocator();
>
>     const N = 64 * 1024 * 1024 / @sizeOf(u64); // 64 MB
>     const data = try allocator.alloc(u64, N);
>     defer allocator.free(data);
>     for (data, 0..) |*x, idx| x.* = idx;
>
>     const result = slow_sum(data);
>     std.debug.print("sum = {d}\n", .{result});
> }
> ```
>
> 1. Compile with `ReleaseSafe -fno-omit-frame-pointer`
> 2. Run `perf stat` and record the L1 and LLC miss rates
> 3. Generate a flame graph
> 4. Use `perf annotate` to identify the hot instruction
> 5. Fix the access pattern and measure the improvement
> 6. Report: L1 miss rate before and after, LLC miss rate before and after, runtime before and after

---

## Part 5: Valgrind Tools for Deep Analysis

### 5.1 Callgrind — Instruction-Level Profiling

While `perf` is best for real-time profiling with low overhead (~1%), `valgrind --tool=callgrind` provides deterministic, reproducible instruction-level profiling. It simulates the CPU and counts every instruction, every function call, and every cache access — without sampling error.

The tradeoff: callgrind typically runs 10-50x slower than native execution.

```bash
# Profile with callgrind
valgrind --tool=callgrind --callgrind-out-file=callgrind.out ./your_program

# Visualize with kcachegrind (install: apt install kcachegrind)
kcachegrind callgrind.out

# Or text output
callgrind_annotate callgrind.out | head -100

# Show per-function instruction counts
callgrind_annotate --auto=yes callgrind.out
```

Callgrind reports:
- **Ir:** Instruction reads (total instruction count)
- **I1mr:** L1 instruction cache miss reads
- **ILmr:** Last-level instruction cache miss reads
- **Dr:** Data reads
- **D1mr:** L1 data cache miss reads
- **DLmr:** Last-level data cache miss reads

Lines with high `D1mr` or `DLmr` are your cache hotspots.

### 5.2 Massif — Heap Profiling

`valgrind --tool=massif` tracks heap memory usage over time, showing which call sites allocate how much.

```bash
# Profile heap usage
valgrind --tool=massif --time-unit=ms ./your_program

# Visualize
ms_print massif.out.PID

# Or use massif-visualizer for a GUI
massif-visualizer massif.out.PID
```

Massif output shows peak heap usage and a breakdown by call site — essential for finding allocation-heavy code paths that degrade performance through GC pressure (in languages with GC) or allocator overhead (in systems languages).

### 5.3 Helgrind — Thread Error Detection

`valgrind --tool=helgrind` detects data races, lock order violations, and other threading errors:

```bash
valgrind --tool=helgrind ./your_threaded_program
```

It reports:
- **Data races:** Two threads accessing the same memory without synchronization
- **Lock order violations:** Acquiring locks in inconsistent order (potential deadlock)
- **Misuse of pthreads API:** Unlocking a mutex from the wrong thread, etc.

Helgrind catches races that may not manifest in testing due to timing — it instruments every memory access and lock operation.

---

## Part 6: Profiling Specific Bottlenecks

### 6.1 CPU-Bound: The Investigation Path

When `perf stat` shows high IPC (>1.0) and low cache miss rates, the program is CPU-bound — it is doing real computation but not doing it efficiently enough.

```bash
# Step 1: Identify hot functions
perf record -F 999 -g --call-graph=fp ./prog
perf report --stdio | head -30

# Step 2: Look at the hot function in detail
perf annotate --symbol=hot_function --stdio

# Step 3: Check instruction mix
perf stat -e \
  instructions,cycles,\
  fp_arith_inst_retired.scalar_single,\
  fp_arith_inst_retired.128b_packed_single \
  ./prog
```

If the hot function is doing floating-point work, check whether it is vectorized. If `fp_arith_inst_retired.scalar_single` is high and `128b_packed_single` is low, the compiler is not vectorizing — look for aliasing barriers or non-contiguous memory access.

### 6.2 Memory-Bound: The Investigation Path

When `perf stat` shows low IPC (<0.5) and high cache miss rates, the program is memory-bound — the CPU is stalling waiting for data.

```bash
# Step 1: Confirm the bottleneck
perf stat -e cycles,instructions,L1-dcache-load-misses,LLC-load-misses ./prog
# Low IPC + high LLC miss rate = memory bound

# Step 2: Find where misses occur
perf record -e LLC-load-misses -g --call-graph=fp ./prog
perf report --stdio

# Step 3: Line-level cache miss attribution
valgrind --tool=callgrind --simulate-cache=yes ./prog
callgrind_annotate --auto=yes callgrind.out | grep -A 5 "DLmr"
```

Fixes: AoS → SoA restructuring (Module 6), hot/cold field split, cache blocking, reducing working set size.

### 6.3 I/O-Bound: The Investigation Path

When CPU utilization is low but the program is slow, it is likely waiting for I/O.

```bash
# Check disk I/O
iostat -xz 1

# Trace file I/O syscalls
strace -T -e trace=read,write,pread64,pwrite64 ./prog 2>&1 | \
    awk '{print $NF}' | sort -n | tail -20
# -T prints the time each syscall took
# Last column shows duration; sort to find slowest calls

# Count syscalls by type
strace -c ./prog

# Off-CPU flame graph to see where threads block
perf record -e sched:sched_switch -ag -o perf-offcpu.data sleep 30
```

Fixes: larger I/O buffers (fewer syscalls), `O_DIRECT` for database-style I/O (bypass page cache), `io_uring` for async I/O (Module 11 preview), or simply caching frequently-read data in memory.

### 6.4 Lock Contention: The Investigation Path

When a multi-threaded program scales poorly (adding threads doesn't increase throughput), lock contention is often the cause.

```bash
# Count mutex-related events
perf stat -e \
  futex:futex_wait,futex:futex_wake \
  ./threaded_prog

# Trace which locks are contended
perf record -e lock:contention_begin -ag ./threaded_prog
perf report

# Use perf c2c for false sharing
perf c2c record ./threaded_prog
perf c2c report
```

Fixes: finer-grained locking, lock-free data structures (Module 8), sharding (Module 8 project), or restructuring to reduce shared state.

---

## Part 7: Benchmarking at System Scale

### 7.1 The Benchmark Hierarchy

Different benchmark types answer different questions:

**Microbenchmarks** measure individual operations (hash function latency, allocation cost). Controlled, reproducible, but synthetic — they may not reflect production behavior.

**Component benchmarks** measure subsystems (database read throughput, network parsing rate). More realistic than microbenchmarks but still isolated.

**System benchmarks** measure end-to-end behavior under realistic load (HTTP server requests per second, database OLTP throughput). Closest to production but harder to control and interpret.

**Production monitoring** measures the actual running system. Real user traffic, real data, real conditions. Ground truth, but you cannot control the experiment.

The discipline is to use each type appropriately: microbenchmarks to understand low-level performance, component benchmarks to evaluate design alternatives, system benchmarks to validate that optimizations actually help end-to-end, and production monitoring to catch regressions.

### 7.2 Avoiding Common System Benchmark Mistakes

**Closed vs Open Systems:** A closed-loop benchmark (send request, wait for response, send next) does not match production behavior where requests arrive independently of the system's current state. Use an open-loop benchmark (send at a fixed rate regardless of response time) for realistic load testing. This is where coordinated omission matters most.

**Warmup:** Production systems have warm caches, hot JIT compilation, open connections, and primed OS state. A benchmark that starts from cold state and runs for 10 seconds is measuring cold-start behavior, not steady-state behavior. Always discard the first N% of results.

**Working set:** Make sure the benchmark's working set matches production. A cache benchmark that fits entirely in L3 cache reports irrelevant results if the production working set is 10x larger.

**Isolation:** Other processes on the same machine inject noise into benchmarks. Use CPU pinning (`taskset`), disable frequency scaling, and run on dedicated hardware for reproducible results:

```bash
# Pin to specific CPUs (reduce scheduler interference)
taskset -c 0,1 ./your_benchmark

# Disable frequency scaling (prevent thermal throttling affecting results)
sudo cpupower frequency-set -g performance

# Disable transparent huge pages (can cause jitter)
echo never | sudo tee /sys/kernel/mm/transparent_hugepage/enabled
```

### 7.3 Reporting Results Rigorously

A benchmark result without context is meaningless. A rigorous benchmark report includes:

**The measurement environment:**
- Hardware: CPU model, core count, RAM, storage type
- OS: kernel version
- Compiler: Zig version, optimization flags

**The experimental design:**
- What was measured (metric, unit)
- How long the benchmark ran
- Number of iterations or requests
- Warmup period

**The statistical summary:**
- For latency: p50, p95, p99, p99.9, max (never just mean)
- For throughput: operations per second ± standard deviation
- Multiple runs showing variance

**The comparison:**
- Baseline vs optimized, in the same units
- Percentage improvement or regression
- Statistical significance (is the difference larger than the noise?)

```zig
pub fn print_benchmark_report(
    name: []const u8,
    baseline: BenchResult,
    optimized: BenchResult,
) void {
    const speedup = @as(f64, @floatFromInt(baseline.median_ns)) /
                    @as(f64, @floatFromInt(optimized.median_ns));
    const pct_improvement = (speedup - 1.0) * 100.0;

    std.debug.print("\n=== {s} ===\n", .{name});
    std.debug.print("{s:<12} {s:>10} {s:>10} {s:>10} {s:>10}\n",
        .{"", "p50", "p95", "p99", "max"});
    std.debug.print("{s:<12} {d:>10} {d:>10} {d:>10} {d:>10}\n",
        .{"baseline", baseline.median_ns, 0, baseline.p99_ns, baseline.max_ns});
    std.debug.print("{s:<12} {d:>10} {d:>10} {d:>10} {d:>10}\n",
        .{"optimized", optimized.median_ns, 0, optimized.p99_ns, optimized.max_ns});
    std.debug.print("Speedup: {d:.2}x ({d:.1}% improvement at p50)\n",
        .{speedup, pct_improvement});

    if (optimized.p99_ns > baseline.p99_ns) {
        std.debug.print(
            "WARNING: p99 REGRESSED ({d} → {d} ns)\n",
            .{baseline.p99_ns, optimized.p99_ns});
    }
}
```

---

## Part 8: The Module Project — A Performance Report

### Project Specification

Choose one of the projects from earlier modules and produce a complete performance report:

- The `ShardedKvStore` from Module 8
- The `PersistentKvStore` from Module 9
- The matrix multiplication benchmark from Module 6
- The thread pool from Module 7

The report must include the following sections.

### Section 1: System Characterization

Run the USE Method on your program. Report:
- CPU utilization and IPC under load
- Cache miss rates (L1, LLC) under load
- Whether the program is CPU-bound, memory-bound, or I/O-bound

```bash
perf stat -r 3 -e \
    cycles,instructions,\
    L1-dcache-load-misses,LLC-load-misses,\
    branch-misses \
    ./your_program
```

### Section 2: Flame Graph Analysis

Generate a CPU flame graph of your program under realistic load. Annotate the flame graph identifying:
- The top 3 functions by CPU time
- Whether time is in computation, memory access, or system calls
- The most surprising finding

### Section 3: Latency Distribution

Benchmark the primary operation of your program (e.g., `get` for the KV store, matrix multiply for the matrix benchmark). Report:
- The full latency distribution: p50, p95, p99, p99.9, max
- The latency under increasing load (plot throughput vs p99 latency)
- The point at which the system saturates (p99 begins to increase sharply)

### Section 4: One Targeted Optimization

Based on your profiling, identify one specific bottleneck and implement a fix. The fix must be motivated by profiling data — not guesswork. Report:
- The bottleneck identified and the profiling evidence
- The change made (code diff or description)
- Before and after perf stat output
- Before and after latency percentiles
- Whether the optimization had any negative effects (regression in another metric)

### Section 5: Negative Results

Report at least one optimization you tried that did NOT improve performance. Explain why, based on profiling data. This section is as important as Section 4 — it demonstrates that you understand the system well enough to explain why an expected improvement did not materialize.

---

## Summary

Performance analysis is a discipline, not a technique. It has methodology, tooling, and failure modes — and using any of them incorrectly produces worse-than-useless results.

**The USE Method** gives you a systematic starting point: check utilization, saturation, and errors for every resource before diving into detailed profiling. It prevents you from optimizing the wrong thing.

**Correct microbenchmarks** require defending against dead code elimination (`doNotOptimizeAway`), measuring warm-state performance (warmup iterations), and reporting distributions (percentiles) rather than summaries (mean). Coordinated omission is a fundamental error in load testing that can underreport tail latency by 10-100x.

**`perf stat`** counts hardware events. IPC, cache miss rates, and branch miss rates tell you what kind of bottleneck you have before you invest in detailed profiling.

**`perf record` and flame graphs** tell you where in the program the bottleneck manifests. A flame graph answers "where is CPU time going?" with unambiguous visual clarity. It takes 30 seconds to generate and immediately reveals the hot path.

**`perf annotate`** narrows to instruction-level attribution — showing which specific load or branch instruction is the bottleneck within a hot function.

**Valgrind callgrind** provides deterministic, reproducible profiling at the cost of 10-50x slowdown. Use it when you need exact instruction counts or cache miss attribution without sampling noise.

**Reporting rigorously** — with percentiles, multiple runs, the measurement environment documented, and negative results included — is what separates engineering from guessing.

---

## What's Next

Module 10 is the final module of the curriculum's first section. The modules that follow cover the network stack (Module 11 — Networking and the Network Stack), distributed systems foundations (Modules 12-15), and the curriculum capstone. But the skills in this module — methodology, measurement, profiling, and honest reporting — apply to every system you will ever build, at every scale.

---

## Reference: Performance Analysis Cheatsheet

```bash
# ── The USE Method Quick Check ────────────────────────────────────
vmstat 1           # CPU: r (run queue), us+sy (utilization), si/so (swap)
mpstat -P ALL 1    # Per-CPU utilization
free -m            # Memory: used vs available
iostat -xz 1       # Disk: %util, await (latency), r/s w/s (IOPS)
netstat -s         # Network: error and drop counts
ss -s              # Socket summary

# ── perf Quick Reference ──────────────────────────────────────────
# Count hardware events
perf stat -e cycles,instructions,cache-misses,branch-misses ./prog

# Profile CPU time (record + report)
perf record -F 99 -g --call-graph=fp ./prog
perf report --stdio

# Instruction-level hotspot
perf annotate --symbol=func_name --stdio

# Generate flame graph
perf record -F 99 -g ./prog
perf script | stackcollapse-perf.pl | flamegraph.pl > flame.svg

# Compare two runs
perf stat -r 5 -o baseline.perf ./original
perf stat -r 5 -o optimized.perf ./optimized
perf diff baseline.perf optimized.perf

# ── Valgrind Quick Reference ──────────────────────────────────────
# Instruction-level profiling
valgrind --tool=callgrind ./prog
callgrind_annotate callgrind.out.PID

# Heap profiling
valgrind --tool=massif --time-unit=ms ./prog
ms_print massif.out.PID

# Thread race detection
valgrind --tool=helgrind ./threaded_prog

# ── Benchmarking Discipline ───────────────────────────────────────
# Always: ReleaseFast or ReleaseSafe for benchmarks (not Debug)
# Always: -fno-omit-frame-pointer for profiling
# Always: doNotOptimizeAway on results
# Always: warmup iterations before measurement
# Always: report percentiles, not mean
# Always: run multiple times, report variance
# Never: benchmark from cold cache unless cold-start is what you're measuring
# Never: report a result without the measurement environment
```

---

*End of Module 10*
