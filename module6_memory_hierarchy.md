# Module 6: The Memory Hierarchy and Why Locality Matters

## The Craft of Systems Programming — Teaching Material

---

> *"The fastest code is code that doesn't touch memory it doesn't need to. The second fastest is code that touches it in an order the hardware expects. Everything else is arithmetic."*

---

## Before You Begin

You now understand what programs are made of and how they behave. You know how data is represented, how the processor executes instructions, how the OS creates processes, how memory is allocated and owned, and how state machines structure behavior over time.

This module returns to the hardware — but with everything you now know as context. In Module 2 you were introduced to the memory hierarchy. You measured the difference between sequential and random access. You saw the row-major versus column-major matrix benchmark.

This module goes much deeper. It is not enough to know that locality matters. You need to understand *precisely why* it matters, what the hardware is doing when you access memory in different patterns, how to redesign data structures and algorithms to align with the hardware, and how to measure and verify that your changes actually help.

This is the module where you become dangerous — where abstract knowledge about cache lines and latency becomes the ability to look at a data structure, predict its cache behavior, redesign it, and produce a 5-10x speedup without changing the algorithm's complexity.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain the three types of cache misses (compulsory, capacity, conflict) and identify which type dominates a given access pattern
- Calculate the expected cache miss rate for simple access patterns given a cache size and cache line size
- Implement and benchmark row-major versus column-major matrix traversal and explain the measured difference
- Explain what the hardware prefetcher does and what access patterns defeat it
- Redesign a data structure from Array of Structures to Structure of Arrays and measure the performance improvement
- Implement cache-blocked matrix multiplication and explain why tiling improves cache utilization
- Use `perf stat` to measure actual cache miss counts and interpret the output
- Identify false sharing in multi-threaded code and fix it using padding
- Implement a cache-oblivious algorithm and explain why it adapts to the cache hierarchy without knowing its parameters

---

## Setting Up Your Environment

This module makes heavy use of performance measurement. Verify your tools:

```bash
# Linux performance counters
perf stat --version
perf stat -e cache-misses,cache-references,instructions ./your_binary

# Valgrind's cache simulator
valgrind --tool=cachegrind ./your_binary
cg_annotate cachegrind.out.PID

# Optional: Intel VTune (if available)
# vtune -collect memory-access ./your_binary
```

All benchmarks in this module must be compiled with `ReleaseFast` optimization to produce meaningful results:

```bash
zig build-exe src/main.zig -O ReleaseFast
```

Running benchmarks in Debug mode measures the overhead of safety checks, not the performance of the algorithm.

A crucial discipline: **always measure before and after**. Every optimization claim must be backed by numbers from your machine. Performance behavior varies across architectures, cache sizes, and workloads. What is 10x faster on one machine may be 2x faster on another. Your job is to measure, not guess.

---

## Part 1: The Three Types of Cache Misses

### 1.1 Why Misses Happen at All

A cache miss occurs when the data you need is not in the cache. The processor must go to the next level of the memory hierarchy to fetch it. Understanding *why* a miss occurred tells you whether it can be prevented.

There are exactly three reasons a cache miss occurs. Processor architects call them the **three C's**:

**Compulsory misses (cold misses):** The first access to any data is always a miss — the data has never been in the cache. These are unavoidable. You cannot cache data before you have accessed it. Compulsory misses account for a small fraction of total misses in long-running programs because each piece of data is only cold once.

**Capacity misses:** The working set — the total amount of data the program is actively using — is larger than the cache. Even with a perfect replacement policy, some data must be evicted before it is reused. Capacity misses are reduced by reducing working set size: processing data in smaller chunks, eliminating unnecessary data fields, or using a more cache-appropriate algorithm.

**Conflict misses:** Most caches are not fully associative — they use set-associative mapping, where each memory address can only be stored in a limited number of cache locations (the "ways" of its set). If two frequently-accessed addresses map to the same set and the set is full, one is evicted even though the cache as a whole has free space elsewhere. Conflict misses are the most surprising category — they can cause poor performance even when the working set fits comfortably in the cache.

Understanding which type dominates is essential for choosing the right fix. You cannot reduce compulsory misses by making the cache larger (they are irreducible). You cannot reduce capacity misses by reordering loops (the data still needs to fit). You cannot reduce conflict misses by decreasing working set size if the issue is address mapping, not total size.

### 1.2 Identifying Miss Types in Practice

```bash
# Run with perf to count total cache misses
perf stat -e L1-dcache-load-misses,L1-dcache-loads \
          -e LLC-load-misses,LLC-loads \
          ./your_binary

# Typical output:
#    45,231,892      L1-dcache-load-misses    #    4.23% of all L1 dcache hits
#  1,070,312,918      L1-dcache-loads
#     3,847,201      LLC-load-misses          #   12.07% of all LL-cache hits
#    31,846,203      LLC-loads
```

A **high L1 miss rate** (>5%) with a **low LLC miss rate** suggests capacity or conflict misses that are being caught by L2/L3. A **high LLC miss rate** means misses are going all the way to main memory — the most expensive scenario.

To distinguish capacity from conflict misses: vary the array size. If miss rate jumps sharply at a specific size, you have found a capacity boundary. If miss rate varies unexpectedly for arrays smaller than the cache, you likely have conflict misses from unfortunate address alignment.

---

## Part 2: Spatial and Temporal Locality — Making Them Concrete

### 2.1 Spatial Locality

**Spatial locality** means: data near recently-accessed data will be accessed soon. The hardware exploits this by loading an entire **cache line** (64 bytes on x86-64) when any byte in it is accessed. If your access pattern is sequential, every byte you fetch brings 63 more useful bytes into cache for free.

If your access pattern jumps around in large strides, each access still loads a full 64-byte cache line — but you only use one or a few bytes of it before evicting it. You pay the full miss penalty but reap only a fraction of the benefit.

```zig
const std = @import("std");

const ARRAY_LEN = 64 * 1024 * 1024 / @sizeOf(u64); // 64 MB

var data: [ARRAY_LEN]u64 = undefined;

pub fn main() !void {
    // Initialize
    for (&data, 0..) |*x, i| x.* = i;

    var timer = try std.time.Timer.start();
    const ITERS = 256;

    // Test different strides
    const strides = [_]usize{ 1, 2, 4, 8, 16, 32, 64 };

    for (strides) |stride| {
        var sum: u64 = 0;
        timer.reset();

        for (0..ITERS) |_| {
            var i: usize = 0;
            while (i < ARRAY_LEN) : (i += stride) {
                sum +%= data[i];
            }
        }

        const ns = timer.read();
        const accesses = ARRAY_LEN / stride * ITERS;
        const ns_per_access = ns / accesses;

        std.debug.print("stride {:3}: {:6} ns/access  sum={}\n",
            .{ stride, ns_per_access, sum });
    }
}
```

Expected output pattern (approximate, varies by machine):

```
stride   1:      1 ns/access   ← sequential, all cache hits
stride   2:      1 ns/access   ← still mostly cache hits
stride   4:      1 ns/access   ← 4 elements per line, still fine
stride   8:      2 ns/access   ← 8 elements per line
stride  16:      4 ns/access   ← 1 per line, more misses
stride  32:      8 ns/access   ← 1 per 2 lines
stride  64:     15 ns/access   ← 1 per 4 lines
```

The dramatic increase at strides larger than 8 (for `u64`, 8 elements per 64-byte cache line) corresponds to the point where each access loads a new cache line. At stride 64, every single access is a cache miss.

### 2.2 Temporal Locality

**Temporal locality** means: recently-accessed data will be accessed again soon. The cache exploits this by keeping recently-used data in the fastest storage level.

The key factor for temporal locality is whether your working set fits in the relevant cache level. If you repeatedly process a 30 KB array and your L1 cache is 32 KB, it fits — you pay for the initial cold misses and then everything is warm. If you process a 4 MB array and your L2 is 256 KB, the array does not fit in L2 — every traversal is cold from the L2 perspective, although L3 can help.

```zig
const std = @import("std");

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Test temporal locality with different array sizes
    // Each size tests a different level of the memory hierarchy
    const sizes = [_]usize{
        8  * 1024,          //   8 KB  — fits in L1 (32 KB)
        64 * 1024,          //  64 KB  — fits in L2 (256 KB)
        512 * 1024,         // 512 KB  — fits in L3 (8+ MB)
        32 * 1024 * 1024,   //  32 MB  — exceeds L3 → main memory
        128 * 1024 * 1024,  // 128 MB  — well beyond L3
    };

    const PASSES = 8; // multiple passes test temporal reuse
    var timer = try std.time.Timer.start();

    for (sizes) |size_bytes| {
        const n = size_bytes / @sizeOf(u64);
        const arr = try allocator.alloc(u64, n);
        defer allocator.free(arr);

        for (arr, 0..) |*x, i| x.* = i;

        var sum: u64 = 0;
        timer.reset();

        // Multiple passes: data accessed PASSES times
        for (0..PASSES) |_| {
            for (arr) |x| sum +%= x;
        }

        const ns = timer.read();
        const total_accesses = n * PASSES;
        const ns_per = ns / total_accesses;
        const mb = size_bytes / (1024 * 1024);

        std.debug.print("{:4} MB: {:4} ns/access  (sum={})\n",
            .{ mb, ns_per, sum });
    }
}
```

The `ns/access` metric tells you which cache level is being hit:
- ~1-4 ns: L1 cache
- ~4-12 ns: L2 cache
- ~12-50 ns: L3 cache
- ~100-300 ns: main memory

---

> **Exercise 6.1: Build a Memory Latency Profile**
>
> The most accurate way to measure cache latency is **pointer chasing**: following a chain of pointers through memory in a random order, so the hardware prefetcher cannot predict the next address.
>
> Build an array where each element points to the next in a random permutation (Fisher-Yates shuffle). Measure the time to chase through N pointers for different array sizes.
>
> ```zig
> // Each element stores the index of the next element to visit
> var arr: []usize = try allocator.alloc(usize, n);
>
> // Fisher-Yates: create random permutation
> for (arr, 0..) |*x, i| x.* = i;
> var rng = std.rand.DefaultPrng.init(42);
> var k = n;
> while (k > 1) {
>     k -= 1;
>     const j = rng.random().uintLessThan(usize, k + 1);
>     std.mem.swap(usize, &arr[k], &arr[j]);
> }
>
> // Chase: each access is data-dependent on the previous
> var idx: usize = 0;
> for (0..n) |_| idx = arr[idx];
> ```
>
> Test with array sizes: 4 KB, 32 KB, 128 KB, 512 KB, 2 MB, 8 MB, 32 MB, 128 MB.
> Plot ns/access vs array size. The steps in the curve correspond to cache level boundaries.
> What cache sizes does your machine appear to have?

---

## Part 3: The Matrix Traversal — Seeing the Difference

### 3.1 Row-Major Storage and Access Patterns

In Zig (and C), a 2D array `[M][N]T` is stored in **row-major order**: row 0 occupies addresses 0 through N-1, row 1 occupies addresses N through 2N-1, and so on. Elements within the same row are contiguous in memory.

```
Matrix [4][4]i32 in memory:
Row 0:  [0,0] [0,1] [0,2] [0,3]
Row 1:  [1,0] [1,1] [1,2] [1,3]
Row 2:  [2,0] [2,1] [2,2] [2,3]
Row 3:  [3,0] [3,1] [3,2] [3,3]

Memory addresses:
  &arr[0][0] = base + 0
  &arr[0][1] = base + 4
  &arr[0][2] = base + 8
  &arr[0][3] = base + 12
  &arr[1][0] = base + 16   ← 16 bytes from arr[0][0]
  &arr[1][1] = base + 20
  ...
```

Traversing row by row (`arr[i][j]` with `j` as the inner loop) accesses memory sequentially. Each cache line fetch covers 16 consecutive `i32` elements — 16 useful values per cache line.

Traversing column by column (`arr[i][j]` with `i` as the inner loop) accesses memory with a stride of `N * sizeof(T)`. For a 1024×1024 matrix of `f32`, adjacent column elements are 4096 bytes apart. Each cache line covers only 1 useful element per cache line.

### 3.2 The Benchmark

```zig
const std = @import("std");

const N = 1024; // 1024 * 1024 * 4 bytes = 4 MB

var matrix: [N][N]f32 = undefined;

fn init_matrix() void {
    for (0..N) |i| {
        for (0..N) |j| {
            matrix[i][j] = @floatFromInt(i * N + j);
        }
    }
}

fn sum_row_major() f64 {
    var total: f64 = 0;
    for (0..N) |i| {
        for (0..N) |j| {
            total += matrix[i][j]; // sequential: arr[0], arr[1], arr[2]...
        }
    }
    return total;
}

fn sum_col_major() f64 {
    var total: f64 = 0;
    for (0..N) |j| {
        for (0..N) |i| {
            total += matrix[i][j]; // stride N: arr[0], arr[1024], arr[2048]...
        }
    }
    return total;
}

fn sum_tiled(comptime TILE: usize) f64 {
    var total: f64 = 0;
    var i: usize = 0;
    while (i < N) : (i += TILE) {
        var j: usize = 0;
        while (j < N) : (j += TILE) {
            // Process TILE × TILE block
            const i_end = @min(i + TILE, N);
            const j_end = @min(j + TILE, N);
            for (i..i_end) |ti| {
                for (j..j_end) |tj| {
                    total += matrix[ti][tj];
                }
            }
        }
    }
    return total;
}

pub fn main() !void {
    init_matrix();

    var timer = try std.time.Timer.start();
    const REPS = 5;

    // Row-major
    var best_row: u64 = std.math.maxInt(u64);
    var result: f64 = 0;
    for (0..REPS) |_| {
        timer.reset();
        result = sum_row_major();
        const t = timer.read();
        if (t < best_row) best_row = t;
    }
    std.debug.print("row-major:  {:8} ms  (result={d:.0})\n",
        .{ best_row / 1_000_000, result });

    // Column-major
    var best_col: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        result = sum_col_major();
        const t = timer.read();
        if (t < best_col) best_col = t;
    }
    std.debug.print("col-major:  {:8} ms  (result={d:.0})\n",
        .{ best_col / 1_000_000, result });

    // Tiled (16x16 blocks)
    var best_tiled: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        result = sum_tiled(16);
        const t = timer.read();
        if (t < best_tiled) best_tiled = t;
    }
    std.debug.print("tiled(16):  {:8} ms  (result={d:.0})\n",
        .{ best_tiled / 1_000_000, result });

    const ratio = @as(f64, @floatFromInt(best_col)) /
                  @as(f64, @floatFromInt(best_row));
    std.debug.print("\ncol-major is {d:.1}x slower than row-major\n", .{ratio});
}
```

Compile and run, then verify with `perf`:

```bash
zig build-exe src/main.zig -O ReleaseFast
perf stat -e L1-dcache-load-misses,LLC-load-misses ./main
```

You will see that the column-major traversal has dramatically more L1 and LLC misses — sometimes 10-50x more — despite performing identical arithmetic.

### 3.3 Why Tiling Helps

The tiled version processes the matrix in small blocks (tiles). If the tile is small enough to fit in L1 or L2 cache, the data loaded for one iteration of the tile is reused for all iterations within that tile. The total number of main memory accesses drops from O(N²) (for column-major) toward O(N²/B) where B is the tile size.

For a tile size of 16 and a matrix of N=1024:
- Naive column-major: ~1M cache line loads (one per element, each a new line)
- Tiled: data within each 16×16 tile stays in cache, ~N²/16² ≈ 4096 tile-loads × 16²/8 lines per tile ≈ 65536 cache lines total

The tiling transforms the access pattern from one where the working set is N²×4 bytes (4 MB for 1024×1024 f32) to one where the effective working set is 16×16×4×3 ≈ 3 KB (three tiles) — which fits comfortably in L1.

---

## Part 4: Array of Structures vs Structure of Arrays

### 4.1 The AoS Layout Problem

The natural way to model a collection of objects is an array of structures (AoS): each element is a struct containing all the fields of that object.

```zig
// Array of Structures (AoS)
const Particle = struct {
    x: f32,      // position
    y: f32,
    z: f32,
    vx: f32,     // velocity
    vy: f32,
    vz: f32,
    mass: f32,   // physical properties
    charge: f32,
};
// AoS layout in memory:
// [x,y,z,vx,vy,vz,mass,charge] [x,y,z,vx,vy,vz,mass,charge] ...
// Each particle: 32 bytes = 0.5 cache lines

var particles_aos: [1_000_000]Particle = undefined;
```

Now consider the most common operation in a physics simulation: update all positions based on velocities:

```zig
// Hot loop: only needs x, y, z, vx, vy, vz
for (&particles_aos) |*p| {
    p.x += p.vx;
    p.y += p.vy;
    p.z += p.vz;
}
```

This loop only uses 6 of the 8 fields — but loads the entire 32-byte struct per particle. The `mass` and `charge` fields are loaded into cache on every iteration but never used. For 1 million particles, that is 8 MB of `mass` and `charge` data polluting the cache for nothing.

### 4.2 The SoA Layout Solution

Structure of Arrays (SoA) stores each field in its own contiguous array:

```zig
// Structure of Arrays (SoA)
const Particles = struct {
    x: []f32,
    y: []f32,
    z: []f32,
    vx: []f32,
    vy: []f32,
    vz: []f32,
    mass: []f32,
    charge: []f32,
    count: usize,

    pub fn init(allocator: std.mem.Allocator, n: usize) !Particles {
        return .{
            .x      = try allocator.alloc(f32, n),
            .y      = try allocator.alloc(f32, n),
            .z      = try allocator.alloc(f32, n),
            .vx     = try allocator.alloc(f32, n),
            .vy     = try allocator.alloc(f32, n),
            .vz     = try allocator.alloc(f32, n),
            .mass   = try allocator.alloc(f32, n),
            .charge = try allocator.alloc(f32, n),
            .count  = n,
        };
    }

    pub fn deinit(self: *Particles, allocator: std.mem.Allocator) void {
        allocator.free(self.x);
        allocator.free(self.y);
        allocator.free(self.z);
        allocator.free(self.vx);
        allocator.free(self.vy);
        allocator.free(self.vz);
        allocator.free(self.mass);
        allocator.free(self.charge);
    }
};
// SoA layout:
// x:  [x0, x1, x2, x3, ...]   (contiguous)
// y:  [y0, y1, y2, y3, ...]   (contiguous)
// ...
```

The position update loop with SoA:

```zig
fn update_positions_soa(p: *Particles) void {
    for (0..p.count) |i| {
        p.x[i] += p.vx[i];
        p.y[i] += p.vy[i];
        p.z[i] += p.vz[i];
    }
    // Only 6 arrays are touched: x, y, z, vx, vy, vz
    // mass and charge arrays are not loaded at all
}
```

Now each cache line of the `x` array contains 16 consecutive x-values — all useful, all processed immediately. The `mass` and `charge` arrays are completely untouched by this loop. Working set is 6 × N × 4 bytes = 24 MB for 1M particles — versus 32 MB for AoS.

More importantly: when the compiler sees `p.x[i]` and `p.vx[i]` being accessed at the same index `i`, it can often **vectorize** the loop — processing 8 or 16 elements per iteration using SIMD instructions. AoS layouts typically prevent auto-vectorization because the fields are interleaved.

### 4.3 The Full Benchmark

```zig
const std = @import("std");

const N = 1_000_000; // 1 million particles

// AoS version
const ParticleAoS = struct {
    x: f32, y: f32, z: f32,
    vx: f32, vy: f32, vz: f32,
    mass: f32, charge: f32,
};

// SoA version
const ParticlesSoA = struct {
    x: []f32, y: []f32, z: []f32,
    vx: []f32, vy: []f32, vz: []f32,
    mass: []f32, charge: []f32,
};

fn update_aos(particles: []ParticleAoS) void {
    for (particles) |*p| {
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
    }
}

fn update_soa(p: *const ParticlesSoA) void {
    for (0..N) |i| {
        p.x[i] += p.vx[i];
        p.y[i] += p.vy[i];
        p.z[i] += p.vz[i];
    }
}

// A query that needs ALL fields: AoS may win here
fn compute_energy_aos(particles: []const ParticleAoS) f64 {
    var energy: f64 = 0;
    for (particles) |p| {
        const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
        energy += 0.5 * @as(f64, p.mass) * @as(f64, v2);
    }
    return energy;
}

fn compute_energy_soa(p: *const ParticlesSoA) f64 {
    var energy: f64 = 0;
    for (0..N) |i| {
        const v2 = p.vx[i] * p.vx[i] + p.vy[i] * p.vy[i] + p.vz[i] * p.vz[i];
        energy += 0.5 * @as(f64, p.mass[i]) * @as(f64, v2);
    }
    return energy;
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Allocate and initialize AoS
    const aos = try allocator.alloc(ParticleAoS, N);
    defer allocator.free(aos);
    for (aos, 0..) |*p, i| {
        const fi: f32 = @floatFromInt(i);
        p.* = .{ .x=fi, .y=fi, .z=fi, .vx=0.1, .vy=0.1, .vz=0.1,
                 .mass=1.0, .charge=0.5 };
    }

    // Allocate and initialize SoA
    var soa = ParticlesSoA{
        .x  = try allocator.alloc(f32, N),
        .y  = try allocator.alloc(f32, N),
        .z  = try allocator.alloc(f32, N),
        .vx = try allocator.alloc(f32, N),
        .vy = try allocator.alloc(f32, N),
        .vz = try allocator.alloc(f32, N),
        .mass   = try allocator.alloc(f32, N),
        .charge = try allocator.alloc(f32, N),
    };
    defer {
        allocator.free(soa.x);  allocator.free(soa.y);  allocator.free(soa.z);
        allocator.free(soa.vx); allocator.free(soa.vy); allocator.free(soa.vz);
        allocator.free(soa.mass); allocator.free(soa.charge);
    }
    for (0..N) |i| {
        const fi: f32 = @floatFromInt(i);
        soa.x[i]=fi; soa.y[i]=fi; soa.z[i]=fi;
        soa.vx[i]=0.1; soa.vy[i]=0.1; soa.vz[i]=0.1;
        soa.mass[i]=1.0; soa.charge[i]=0.5;
    }

    var timer = try std.time.Timer.start();
    const REPS = 20;

    // Benchmark: position update (partial field access — SoA should win)
    var best_aos_update: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        update_aos(aos);
        const t = timer.read();
        if (t < best_aos_update) best_aos_update = t;
    }

    var best_soa_update: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        update_soa(&soa);
        const t = timer.read();
        if (t < best_soa_update) best_soa_update = t;
    }

    std.debug.print("Position update (partial fields):\n", .{});
    std.debug.print("  AoS: {} ms\n", .{best_aos_update / 1_000_000});
    std.debug.print("  SoA: {} ms\n", .{best_soa_update / 1_000_000});
    std.debug.print("  Ratio: {d:.1}x\n\n", .{
        @as(f64, @floatFromInt(best_aos_update)) /
        @as(f64, @floatFromInt(best_soa_update)),
    });

    // Benchmark: energy computation (all fields needed)
    var best_aos_energy: u64 = std.math.maxInt(u64);
    var e: f64 = 0;
    for (0..REPS) |_| {
        timer.reset();
        e = compute_energy_aos(aos);
        const t = timer.read();
        if (t < best_aos_energy) best_aos_energy = t;
    }

    var best_soa_energy: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        e = compute_energy_soa(&soa);
        const t = timer.read();
        if (t < best_soa_energy) best_soa_energy = t;
    }
    std.mem.doNotOptimizeAway(e);

    std.debug.print("Energy computation (all fields):\n", .{});
    std.debug.print("  AoS: {} ms\n", .{best_aos_energy / 1_000_000});
    std.debug.print("  SoA: {} ms\n", .{best_soa_energy / 1_000_000});
}
```

The expected result: SoA is significantly faster for partial field access (position update) — typically 2-4x. For full field access (energy), the difference is smaller or AoS may even win on some architectures because loading the full struct in one cache line can be more efficient than loading from multiple separate arrays.

The lesson: **choose AoS or SoA based on your access patterns**, not aesthetics. If most operations use all fields, AoS is fine. If most operations use only a few fields from many elements, SoA is the right choice.

---

> **Exercise 6.2: Hot/Cold Field Split**
>
> A database stores 1 million records with this structure:
>
> ```zig
> const Record = struct {
>     id: u64,           // hot: accessed on every lookup
>     timestamp: u64,    // hot: used in range queries
>     value: f64,        // hot: aggregated frequently
>     description: [64]u8, // cold: only fetched for display
>     metadata: [32]u8,    // cold: rarely needed
>     tags: [16]u8,        // cold: only for filtering
> };
> // Total: 8+8+8+64+32+16 = 136 bytes = 2.125 cache lines per record
> ```
>
> Redesign this as a hot/cold split:
> - `RecordHot` contains only the frequently-accessed fields
> - `RecordCold` contains the rarely-accessed fields
> - Both arrays are indexed by the same integer
>
> Benchmark scanning all records to find those where `value > threshold` using:
> 1. The original layout
> 2. The hot/cold split (scanning only `RecordHot`)
>
> Measure the speedup and explain it in terms of cache lines per record.

---

## Part 5: Cache-Blocked Matrix Multiplication

### 5.1 Why Naive MatMul is Cache-Hostile

Matrix multiplication is the archetypal cache performance problem. The naive triple-loop implementation:

```zig
// Naive: C[i][j] += A[i][k] * B[k][j]
for (0..N) |i| {
    for (0..N) |j| {
        for (0..N) |k| {
            C[i][j] += A[i][k] * B[k][j];
        }
    }
}
```

Accessing `A[i][k]` in the inner loop traverses row `i` of A — sequential, cache-friendly.  
Accessing `B[k][j]` in the inner loop traverses column `j` of B — stride N, one cache miss per element.

For N=1024, matrix B is 4 MB. Column-major access means fetching 1024 cache lines to compute a single element of C. For N² elements of C, that is N³/16 cache line loads just for B — plus compulsory and capacity misses as the column skips over B invalidate cache lines before they can be reused.

### 5.2 The ijk vs ikj Loop Order

Before blocking, consider simply reordering the loops. The order `ikj` instead of `ijk` changes B's access from column-major to row-major:

```zig
// ikj order: B accessed row-by-row (cache-friendly)
for (0..N) |i| {
    for (0..N) |k| {
        const a_ik = A[i][k]; // scalar: reused N times in inner loop
        for (0..N) |j| {
            C[i][j] += a_ik * B[k][j]; // B[k][j]: sequential!
        }
    }
}
```

Now B is traversed row by row in the inner loop — sequential access. This simple reordering can give 3-10x speedup on large matrices with no algorithmic change.

### 5.3 Cache Blocking (Tiling)

Even with the ikj ordering, for large matrices the working set (rows of A, B, and C being processed) eventually exceeds L2 cache capacity. Cache blocking divides the computation into tiles that fit in cache:

```zig
const std = @import("std");

const N = 512; // 512*512*4 = 1 MB per matrix

var A: [N][N]f32 = undefined;
var B: [N][N]f32 = undefined;
var C_naive: [N][N]f32 = undefined;
var C_ikj: [N][N]f32 = undefined;
var C_tiled: [N][N]f32 = undefined;

fn init_matrices() void {
    var rng = std.rand.DefaultPrng.init(12345);
    const rand = rng.random();
    for (0..N) |i| {
        for (0..N) |j| {
            A[i][j] = rand.float(f32);
            B[i][j] = rand.float(f32);
        }
    }
    for (0..N) |i| for (0..N) |j| {
        C_naive[i][j] = 0;
        C_ikj[i][j] = 0;
        C_tiled[i][j] = 0;
    };
}

fn matmul_naive() void {
    for (0..N) |i| for (0..N) |j| for (0..N) |k| {
        C_naive[i][j] += A[i][k] * B[k][j];
    };
}

fn matmul_ikj() void {
    for (0..N) |i| {
        for (0..N) |k| {
            const a = A[i][k];
            for (0..N) |j| {
                C_ikj[i][j] += a * B[k][j];
            }
        }
    }
}

// Tile size: choose so 3 tiles fit in L2 cache
// L2 = 256 KB, tile = T*T*4 bytes, 3 tiles < 256 KB
// T*T < 256*1024/3/4 ≈ 21845 → T ≈ 148, round to T=64 for alignment
fn matmul_tiled(comptime T: usize) void {
    var ii: usize = 0;
    while (ii < N) : (ii += T) {
        var kk: usize = 0;
        while (kk < N) : (kk += T) {
            var jj: usize = 0;
            while (jj < N) : (jj += T) {
                // Process T×T tile
                const i_end = @min(ii + T, N);
                const k_end = @min(kk + T, N);
                const j_end = @min(jj + T, N);

                for (ii..i_end) |i| {
                    for (kk..k_end) |k| {
                        const a = A[i][k];
                        for (jj..j_end) |j| {
                            C_tiled[i][j] += a * B[k][j];
                        }
                    }
                }
            }
        }
    }
}

pub fn main() !void {
    init_matrices();

    var timer = try std.time.Timer.start();
    const REPS = 3;

    var best_naive: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        // Reset C
        for (0..N) |i| for (0..N) |j| { C_naive[i][j] = 0; };
        timer.reset();
        matmul_naive();
        const t = timer.read();
        if (t < best_naive) best_naive = t;
    }

    var best_ikj: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        for (0..N) |i| for (0..N) |j| { C_ikj[i][j] = 0; };
        timer.reset();
        matmul_ikj();
        const t = timer.read();
        if (t < best_ikj) best_ikj = t;
    }

    var best_tiled: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        for (0..N) |i| for (0..N) |j| { C_tiled[i][j] = 0; };
        timer.reset();
        matmul_tiled(64);
        const t = timer.read();
        if (t < best_tiled) best_tiled = t;
    }

    const gflops = 2.0 * @as(f64, N) * N * N / 1e9;
    std.debug.print("Matrix multiplication {}x{} (f32):\n", .{N, N});
    std.debug.print("  Naive:  {:6} ms  ({d:.1} GFLOP/s)\n",
        .{ best_naive / 1_000_000,
           gflops / (@as(f64, @floatFromInt(best_naive)) / 1e9) });
    std.debug.print("  ikj:    {:6} ms  ({d:.1} GFLOP/s)\n",
        .{ best_ikj / 1_000_000,
           gflops / (@as(f64, @floatFromInt(best_ikj)) / 1e9) });
    std.debug.print("  Tiled:  {:6} ms  ({d:.1} GFLOP/s)\n",
        .{ best_tiled / 1_000_000,
           gflops / (@as(f64, @floatFromInt(best_tiled)) / 1e9) });

    std.debug.print("\nikj vs naive:   {d:.1}x speedup\n", .{
        @as(f64, @floatFromInt(best_naive)) /
        @as(f64, @floatFromInt(best_ikj)) });
    std.debug.print("Tiled vs naive: {d:.1}x speedup\n", .{
        @as(f64, @floatFromInt(best_naive)) /
        @as(f64, @floatFromInt(best_tiled)) });
}
```

Run with `perf` to see the cache miss reduction:

```bash
perf stat -e L1-dcache-load-misses,LLC-load-misses ./main 2>&1
```

The tiled version should show dramatically fewer LLC misses than the naive version — often 10-50x fewer.

---

## Part 6: False Sharing — When Threads Fight Over Cache Lines

### 6.1 The Problem

False sharing is a performance bug that appears only in multi-threaded programs. It occurs when two threads on different cores access different variables that happen to live on the same cache line.

The processor's cache coherency protocol operates at the cache line level. When thread A writes to a variable, it invalidates the cache line containing that variable on all other cores — even if those cores have different variables in the same cache line. Thread B, reading or writing its own variable on the same cache line, must fetch the invalidated line from thread A's core.

The two variables are logically independent, but the hardware treats them as conflicting because of their physical proximity.

### 6.2 Demonstrating False Sharing

```zig
const std = @import("std");

const NUM_THREADS = 4;
const ITERS = 100_000_000;

// False sharing: all counters on the same cache lines
const CountersFalseShare = struct {
    values: [NUM_THREADS]u64, // 4 * 8 = 32 bytes — all in same cache line(s)
};

// No false sharing: each counter padded to its own cache line
const CountersPadded = struct {
    // Each element takes a full 64-byte cache line
    const CACHE_LINE = 64;
    values: [NUM_THREADS][CACHE_LINE / @sizeOf(u64)]u64,

    pub fn get(self: *const CountersPadded, i: usize) u64 {
        return self.values[i][0];
    }

    pub fn increment(self: *CountersPadded, i: usize) void {
        self.values[i][0] += 1;
    }
};

var false_share_counters: CountersFalseShare = .{ .values = .{0} ** NUM_THREADS };
var padded_counters: CountersPadded = .{
    .values = [_][8]u64{.{0} ** 8} ** NUM_THREADS
};

fn worker_false_share(id: usize) void {
    for (0..ITERS) |_| {
        false_share_counters.values[id] += 1;
    }
}

fn worker_padded(id: usize) void {
    for (0..ITERS) |_| {
        padded_counters.values[id][0] += 1;
    }
}

pub fn main() !void {
    var threads: [NUM_THREADS]std.Thread = undefined;
    var timer = try std.time.Timer.start();

    // --- False sharing benchmark ---
    for (&false_share_counters.values) |*v| v.* = 0;
    timer.reset();
    for (0..NUM_THREADS) |i| {
        threads[i] = try std.Thread.spawn(.{}, worker_false_share, .{i});
    }
    for (&threads) |*t| t.join();
    const false_share_ns = timer.read();

    // --- Padded benchmark ---
    for (&padded_counters.values) |*row| row[0] = 0;
    timer.reset();
    for (0..NUM_THREADS) |i| {
        threads[i] = try std.Thread.spawn(.{}, worker_padded, .{i});
    }
    for (&threads) |*t| t.join();
    const padded_ns = timer.read();

    std.debug.print("False sharing:   {} ms\n", .{false_share_ns / 1_000_000});
    std.debug.print("Padded:          {} ms\n", .{padded_ns / 1_000_000});
    std.debug.print("Speedup: {d:.1}x\n", .{
        @as(f64, @floatFromInt(false_share_ns)) /
        @as(f64, @floatFromInt(padded_ns)),
    });

    // Verify correctness
    var total_false: u64 = 0;
    for (false_share_counters.values) |v| total_false += v;
    std.debug.print("Total (false share): {} (expected {})\n",
        .{ total_false, NUM_THREADS * ITERS });
}
```

False sharing typically causes a 2-10x slowdown compared to the padded version. The effect grows with the number of threads and the frequency of writes. Verify with `perf`:

```bash
perf stat -e cache-misses ./main
```

The false sharing version will show dramatically more cache misses.

### 6.3 Diagnosing False Sharing in Production

False sharing is notoriously difficult to diagnose without performance counters because:
- The code looks correct — no data races, no synchronization issues
- Performance is worse with more threads (the opposite of what you expect)
- The bottleneck is in cache coherency traffic, not in computation or locking

```bash
# Linux perf: look for "true sharing" vs "false sharing"
perf c2c record ./my_threaded_program
perf c2c report

# Output highlights cache lines with high false sharing
# Look for "HITM" (Hit Modified) — a remote core modified the line
```

The fix is always the same: ensure each thread's hot data lives on separate cache lines, either through padding or through restructuring the data layout.

---

## Part 7: Cache-Oblivious Algorithms

### 7.1 The Problem with Cache-Aware Algorithms

A **cache-aware** algorithm is designed with specific cache parameters in mind — tile size T is chosen based on the known L1 cache size. This works well on the target machine but requires re-tuning for different machines with different cache sizes.

A **cache-oblivious** algorithm achieves good cache behavior on any cache hierarchy without being parameterized on cache sizes. It does this by recursively dividing the problem into smaller sub-problems until the sub-problem fits in whatever level of cache is present — without knowing what "fits" means for any specific cache.

### 7.2 Cache-Oblivious Matrix Transpose

The naive matrix transpose is cache-hostile in one direction: reading row by row writes column by column (or vice versa). The cache-oblivious approach uses recursive halving:

```zig
const std = @import("std");

const N = 1024;
var A: [N][N]f32 = undefined;
var B_naive: [N][N]f32 = undefined;
var B_recursive: [N][N]f32 = undefined;

fn transpose_naive() void {
    for (0..N) |i| {
        for (0..N) |j| {
            B_naive[j][i] = A[i][j]; // reads A row-by-row, writes B column-by-column
        }
    }
}

/// Cache-oblivious recursive transpose
/// Transposes the submatrix A[r0..r1][c0..c1] into B[c0..c1][r0..r1]
fn transpose_recursive(
    src: *const [N][N]f32,
    dst: *[N][N]f32,
    r0: usize, r1: usize,
    c0: usize, c1: usize,
) void {
    const rows = r1 - r0;
    const cols = c1 - c0;

    // Base case: small enough to process directly
    // The threshold should be small enough to fit in L1
    if (rows <= 32 and cols <= 32) {
        for (r0..r1) |i| {
            for (c0..c1) |j| {
                dst[j][i] = src[i][j];
            }
        }
        return;
    }

    // Recursive case: split the larger dimension
    if (rows >= cols) {
        const mid = r0 + rows / 2;
        transpose_recursive(src, dst, r0, mid, c0, c1);
        transpose_recursive(src, dst, mid, r1, c0, c1);
    } else {
        const mid = c0 + cols / 2;
        transpose_recursive(src, dst, r0, r1, c0, mid);
        transpose_recursive(src, dst, r0, r1, mid, c1);
    }
}

pub fn main() !void {
    // Initialize
    for (0..N) |i| {
        for (0..N) |j| {
            A[i][j] = @floatFromInt(i * N + j);
        }
    }

    var timer = try std.time.Timer.start();
    const REPS = 5;

    var best_naive: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        transpose_naive();
        const t = timer.read();
        if (t < best_naive) best_naive = t;
    }

    var best_recursive: u64 = std.math.maxInt(u64);
    for (0..REPS) |_| {
        timer.reset();
        transpose_recursive(&A, &B_recursive, 0, N, 0, N);
        const t = timer.read();
        if (t < best_recursive) best_recursive = t;
    }

    std.debug.print("Matrix transpose {}x{}:\n", .{N, N});
    std.debug.print("  Naive:     {} ms\n", .{best_naive / 1_000_000});
    std.debug.print("  Recursive: {} ms\n", .{best_recursive / 1_000_000});
    std.debug.print("  Speedup: {d:.1}x\n\n", .{
        @as(f64, @floatFromInt(best_naive)) /
        @as(f64, @floatFromInt(best_recursive)),
    });

    // Verify correctness
    for (0..N) |i| {
        for (0..N) |j| {
            std.debug.assert(B_naive[j][i] == B_recursive[j][i]);
        }
    }
    std.debug.print("Results match.\n", .{});
}
```

The recursive transpose achieves good cache behavior at every level of the hierarchy: when the sub-problem reaches 32×32, it fits in L1 cache. Even on a machine where the L1 is 16 KB instead of 32 KB, the recursion will simply go one level deeper — the algorithm adapts automatically.

---

## Part 8: Using perf to Measure Cache Behavior

### 8.1 The perf Tool

`perf` is the standard Linux performance analysis tool. For cache analysis, the relevant events are:

```bash
# L1 data cache
perf stat -e L1-dcache-loads,L1-dcache-load-misses ./binary

# Last-level cache (L3 on most systems)
perf stat -e LLC-loads,LLC-load-misses ./binary

# All cache levels at once
perf stat -e L1-dcache-loads,L1-dcache-load-misses \
          -e L2-dcache-loads,L2-dcache-load-misses \
          -e LLC-loads,LLC-load-misses ./binary

# Cache misses per instruction (efficiency metric)
perf stat -e instructions,cache-misses ./binary

# Branch prediction
perf stat -e branches,branch-misses ./binary
```

### 8.2 Interpreting perf Output

```
Performance counter stats for './main':

    1,234,567,890      L1-dcache-loads
       45,678,901      L1-dcache-load-misses    #    3.70% of all L1 dcache hits
        8,901,234      LLC-loads
        1,234,567      LLC-load-misses          #   13.87% of all LL-cache hits

       2.345678901 seconds time elapsed
```

Key metrics:
- **L1 miss rate < 1%**: excellent spatial/temporal locality
- **L1 miss rate 1-5%**: acceptable for most workloads
- **L1 miss rate > 10%**: investigate data layout
- **LLC miss rate < 1%**: working set fits in L3
- **LLC miss rate > 10%**: working set exceeds L3 — main memory is the bottleneck

### 8.3 Valgrind Cachegrind

For line-by-line cache miss attribution, `cachegrind` is invaluable:

```bash
# Run under cachegrind (10-50x slowdown, but extremely detailed)
valgrind --tool=cachegrind --cache-sim=yes ./main

# View per-function cache miss breakdown
cg_annotate --auto=yes cachegrind.out.PID

# View per-line (need to compile with -g for debug info)
zig build-exe src/main.zig -O ReleaseSafe   # keep debug info
valgrind --tool=cachegrind --cache-sim=yes ./main
cg_annotate --auto=yes cachegrind.out.PID
```

The cachegrind output shows, for each source line:
- `Ir`: instruction reads
- `I1mr`: L1 instruction miss reads
- `ILmr`: last-level instruction miss reads
- `Dr`: data reads
- `D1mr`: L1 data miss reads
- `DLmr`: last-level data miss reads

Lines with high `D1mr` or `DLmr` are your cache miss hotspots.

---

## Part 9: The Module Project — A Cache-Optimized Spatial Index

### Project Specification

Build a **spatial index** — a data structure for answering "which points are within this bounding box?" queries — optimized for cache performance.

This problem appears constantly in systems: database range queries, game collision detection, geographic information systems, rendering acceleration. The naive solution is a flat array of points with a linear scan. The optimized solution uses cache-friendly data layout, SIMD-friendly field arrangement, and optionally a tree structure that maintains cache locality.

### The Data

```zig
const Point2D = struct {
    x: f32,
    y: f32,
};

const BoundingBox = struct {
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,

    pub fn contains(self: BoundingBox, p: Point2D) bool {
        return p.x >= self.x_min and p.x <= self.x_max and
               p.y >= self.y_min and p.y <= self.y_max;
    }
};
```

### Version 1: AoS Scan (Baseline)

```zig
fn query_aos(points: []const Point2D, box: BoundingBox,
             results: *std.ArrayList(Point2D)) !void {
    for (points) |p| {
        if (box.contains(p)) try results.append(p);
    }
}
```

### Version 2: SoA Scan (Better Cache Utilization)

```zig
const Points2D_SoA = struct {
    x: []f32,
    y: []f32,
    count: usize,
};

fn query_soa(points: *const Points2D_SoA, box: BoundingBox,
             result_indices: *std.ArrayList(usize)) !void {
    for (0..points.count) |i| {
        if (points.x[i] >= box.x_min and points.x[i] <= box.x_max and
            points.y[i] >= box.y_min and points.y[i] <= box.y_max)
        {
            try result_indices.append(i);
        }
    }
}
```

### Version 3: Sorted + SIMD-Friendly Layout

Sort points by x-coordinate and use binary search to narrow the x range before scanning y. This reduces the number of y comparisons dramatically for small query boxes.

```zig
fn query_sorted(points: *const Points2D_SoA, box: BoundingBox,
                result_indices: *std.ArrayList(usize)) !void {
    // Binary search for x range
    const x_start = std.sort.lowerBound(f32, box.x_min, points.x[0..points.count],
        {}, std.sort.asc(f32));
    const x_end = std.sort.upperBound(f32, box.x_max, points.x[0..points.count],
        {}, std.sort.asc(f32));

    // Only scan within x range
    for (x_start..x_end) |i| {
        if (points.y[i] >= box.y_min and points.y[i] <= box.y_max) {
            try result_indices.append(i);
        }
    }
}
```

### Benchmark and Analysis

Build the benchmark harness:
1. Generate 10 million random 2D points uniformly in [0, 1000] × [0, 1000]
2. Run 10,000 queries with boxes of size 10×10 (captures ~0.01% of points)
3. Measure total time and verify result counts match across all versions

Use `perf` to compare cache miss counts across the three versions. Write a one-page analysis explaining the measured differences in terms of:
- Cache lines loaded per point examined
- Working set size for the inner loop
- Branch prediction behavior

### Extension Challenges

1. **KD-tree with cache-friendly layout:** Implement a KD-tree where nodes are stored in breadth-first order (BFS layout) rather than the natural recursive (DFS) layout. BFS layout ensures that parent and children are near each other in memory, improving cache behavior during traversal.

2. **Coordinate compression:** Partition the 1000×1000 space into 100×100 cells. For each query box, identify which cells it intersects and only scan points in those cells. Measure how this reduces cache miss count for small query boxes.

3. **SIMD scan:** Use Zig's vector types to check 8 points simultaneously:
   ```zig
   const Vec8f32 = @Vector(8, f32);
   // Load 8 x-coordinates at once and compare with x_min/x_max
   ```

---

## Summary

The memory hierarchy is not a detail to be optimized later. It is the dominant performance factor in most data-intensive programs — more important than algorithm choice, more important than compiler flags, more important than programming language.

**The three C's** give you a vocabulary for diagnosing cache misses. Compulsory misses are irreducible. Capacity misses are solved by reducing working set. Conflict misses are solved by changing access patterns or alignment.

**Spatial locality** is exploited by accessing data sequentially — every cache line loaded gives 16 (for f32) or 8 (for f64) useful values instead of one. Column-major traversal of a row-major matrix is the canonical example of destroying spatial locality.

**Temporal locality** is exploited by reusing data while it is still in cache. Cache blocking (tiling) is the principal technique: process the data in small tiles that fit in L1 or L2, accessing each tile many times before moving on.

**AoS vs SoA** is a data layout decision that should be made based on access patterns. SoA wins when hot loops access only a few fields. AoS wins when operations use all fields together. The hot/cold split is a middle ground: separate frequently-accessed fields from rarely-accessed fields.

**False sharing** is the multi-threaded version of this problem: two threads writing to different variables on the same cache line cause cache coherency traffic that serializes the writes. Fix it with padding.

**Cache-oblivious algorithms** achieve cache efficiency without knowing the cache parameters, by recursively dividing the problem until the sub-problem fits at whatever cache level is present.

**Measure everything.** `perf stat` and `valgrind --tool=cachegrind` are your primary tools. A cache miss rate, not a runtime difference, tells you whether your optimization actually addressed the root cause.

---

## What's Next

Module 7 — Resource Allocation and Scheduling — moves from memory layout to resource management. You now understand how data moves through the memory hierarchy. Module 7 teaches how a scheduler decides which thread runs when, how to implement scheduling algorithms, and how the scheduler interacts with everything you have learned about memory, processes, and state machines.

---

## Reference: Cache Optimization Checklist

```
Data Layout:
□ Are hot fields separated from cold fields?
□ Is AoS vs SoA chosen based on access patterns?
□ Are structs ordered by alignment (large fields first)?
□ Is there unnecessary padding in hot structs?
□ Are frequently-used arrays contiguous (not linked list)?

Access Patterns:
□ Is the inner loop accessing memory sequentially?
□ Is the working set of the inner loop small enough for L1/L2?
□ Have you considered loop reordering (ikj vs ijk)?
□ Should cache blocking (tiling) be applied?

Multi-threading:
□ Are per-thread counters/state on separate cache lines?
□ Is shared read-only data on its own cache lines (not mixed with mutable)?
□ Have you checked for false sharing with perf c2c?

Measurement:
□ Did you benchmark in ReleaseFast mode?
□ Did you measure cache miss rates with perf, not just runtime?
□ Did you verify the optimized version produces correct results?
□ Did you measure on the target hardware, not just your dev machine?
```

## Reference: perf Commands for Cache Analysis

```bash
# Basic cache statistics
perf stat -e cache-misses,cache-references ./prog

# L1 and LLC detail
perf stat -e L1-dcache-loads,L1-dcache-load-misses,LLC-loads,LLC-load-misses ./prog

# False sharing detection
perf c2c record ./prog
perf c2c report

# Per-function hotspot analysis
perf record -e cache-misses ./prog
perf report

# Annotated source (needs debug symbols)
zig build-exe src/main.zig   # Debug mode preserves symbols
perf record -e cache-misses ./main
perf annotate

# Cachegrind for line-level detail
valgrind --tool=cachegrind --cache-sim=yes ./prog
cg_annotate --auto=yes cachegrind.out.PID
```

---

*End of Module 6*
