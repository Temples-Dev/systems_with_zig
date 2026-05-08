# Module 8: Parallelism and Concurrency

## The Craft of Systems Programming — Teaching Material

---

> *"Concurrency is not parallelism. Concurrency is the composition of independently executing processes. Parallelism is the simultaneous execution of computations. Concurrency is about dealing with lots of things at once. Parallelism is about doing lots of things at once."*
> — Rob Pike

---

## Before You Begin

Module 7 showed you scheduling from the outside: the OS decides which thread runs when, preempting and resuming as the hardware timer fires. This module goes inside the program. You are the programmer now, and you are writing code that deliberately creates multiple concurrent executions — threads — and must ensure they cooperate correctly on shared data.

This is genuinely difficult territory. The bugs that emerge from concurrent programs are among the hardest in all of software: non-deterministic, timing-dependent, impossible to reproduce reliably in a debugger, and capable of corrupting data silently for hours before anything visibly breaks. Understanding concurrency deeply — not just the APIs, but the underlying hardware behavior and the formal memory model — is what separates a programmer who can write concurrent code that happens to work from one who can write concurrent code that is provably correct.

Zig's concurrency primitives are direct, explicit, and close to the hardware. There is no hidden runtime, no implicit synchronization, no garbage collector that sometimes pauses all threads. What you write is what the hardware executes, which means you can reason about it precisely — and means mistakes are entirely your responsibility.

---

## Learning Objectives

By the end of this module, you will be able to:

- Precisely distinguish concurrency from parallelism and identify which each program uses
- Create threads in Zig and share data between them correctly
- Demonstrate a race condition, explain it at the machine instruction level, and fix it
- Use `std.Thread.Mutex` and `std.Thread.RwLock` correctly in real scenarios
- Use `std.Thread.Semaphore` to coordinate bounded resources
- Use `std.Thread.Condition` to implement producer-consumer and other signaling patterns
- Implement a lock-free stack and counter using Zig's atomic operations
- Explain acquire, release, relaxed, and sequentially consistent memory orderings and choose the right one
- Identify and fix all four deadlock conditions
- Solve the Dining Philosophers problem three different ways
- Explain livelock and starvation and distinguish them from deadlock
- Measure the scalability of concurrent data structures using Amdahl's Law

---

## Part 1: Concurrency vs. Parallelism

### 1.1 Two Different Things

These words are used interchangeably in casual conversation. They mean different things precisely.

**Concurrency** is a property of a program's structure: multiple computations are in progress simultaneously, potentially interleaved on a single processor. A single-core computer can run concurrent programs by context-switching between them. Concurrency is about *composition* — designing a system as multiple independent pieces that can overlap.

**Parallelism** is a property of execution: multiple computations are literally running at the same physical instant, on multiple cores or processors. Parallelism requires parallel hardware.

A concurrent program may or may not be parallel. A single-threaded event loop is concurrent (it handles many connections) but not parallel (one thing runs at a time). A data-parallel computation running on 8 cores is both concurrent and parallel. A poorly written multi-threaded program that serializes on a single lock is parallel in principle but concurrent in effect.

Why does the distinction matter? Because they call for different solutions:

- Concurrency problems (I/O multiplexing, event handling, cooperative multitasking) are solved by event loops, coroutines, and state machines
- Parallelism problems (computation on large data sets) are solved by threads, SIMD, and task decomposition
- Conflating them leads to using threads for everything and wondering why your "parallel" code is not faster

### 1.2 Threads and Their Cost

An OS thread is a unit of execution with its own stack and program counter, scheduled by the kernel. Creating a thread is not free:

- Each thread needs a stack (typically 8 MB default on Linux, configurable)
- Creating a thread involves a system call (`clone()` on Linux)
- The kernel must maintain scheduler state for every thread
- Context switching between threads costs 100-300 nanoseconds

For workloads with many small tasks, thread-per-task does not scale. A web server receiving 100,000 requests per second cannot create 100,000 threads. Thread pools, event loops, and async I/O exist to address this limit.

For CPU-bound parallel computation on N cores, the optimal thread count is typically N or N+1. More threads than cores adds context-switching overhead without adding parallelism.

```zig
const std = @import("std");

pub fn main() !void {
    // Spawn a thread — the most basic concurrency primitive
    const thread = try std.Thread.spawn(.{}, worker, .{42});
    thread.join(); // wait for thread to finish
}

fn worker(arg: u32) void {
    std.debug.print("thread running with arg={d}\n", .{arg});
    // thread stack is separate from main thread's stack
    var local: [1024]u8 = undefined;
    _ = local; // demonstrates thread has its own stack
}
```

---

## Part 2: Race Conditions — The Central Danger

### 2.1 What a Race Condition Is

A **race condition** occurs when the correctness of a computation depends on the relative timing of operations in multiple threads. When two threads access shared mutable state without synchronization, the result depends on which instructions interleave — and that interleaving is non-deterministic.

The canonical demonstration:

```zig
const std = @import("std");

var counter: u64 = 0; // shared mutable state

fn increment_unsafe() void {
    for (0..1_000_000) |_| {
        counter += 1; // NOT ATOMIC
    }
}

pub fn main() !void {
    const t1 = try std.Thread.spawn(.{}, increment_unsafe, .{});
    const t2 = try std.Thread.spawn(.{}, increment_unsafe, .{});
    t1.join();
    t2.join();

    // Expected: 2,000,000
    // Actual: some value less than 2,000,000 — different every run
    std.debug.print("counter = {d}\n", .{counter});
}
```

Run this. The output will be wrong, and different each time.

### 2.2 Why it Happens — Machine Instructions

The `counter += 1` operation in Zig compiles to three machine instructions:

```asm
mov rax, [counter]   ; 1. load counter into register
add rax, 1           ; 2. increment
mov [counter], rax   ; 3. store back
```

These three instructions are not atomic. The OS can preempt the thread between any two of them. Consider this interleaving:

```
Thread 1                     Thread 2
─────────────────────────────────────
mov rax, [counter]  (rax=0)
                             mov rax, [counter]  (rax=0)
add rax, 1          (rax=1)
                             add rax, 1          (rax=1)
mov [counter], rax  (mem=1)
                             mov [counter], rax  (mem=1)
```

Both threads read 0, both add 1, both write 1. Two increments happened but the counter only increased by 1. This is a **lost update** — one thread's work was silently discarded.

With 1,000,000 iterations per thread and 2 threads, lost updates accumulate. The final value is typically somewhere between 1,000,000 and 2,000,000 — unpredictably.

### 2.3 Data Races and Undefined Behavior

A **data race** is a specific type of race condition: a non-atomic read or write to a shared variable that another thread is simultaneously writing, with no synchronization. Data races are undefined behavior in C and C++. In Zig, they produce incorrect results and may corrupt data, but Zig does not have a formal undefined-behavior guarantee for data races (the behavior is implementation-defined: whatever LLVM does with it).

The practical consequence: never access shared mutable data without synchronization. Not even for "read-only" operations — reading while another thread writes is still a race.

---

## Part 3: Mutual Exclusion — Mutexes

### 3.1 The Mutex

A **mutex** (mutual exclusion lock) ensures that only one thread at a time can execute a protected block of code — the **critical section**. A thread acquires the mutex before entering the critical section; other threads that attempt to acquire it block until the holder releases it.

```zig
const std = @import("std");

var counter: u64 = 0;
var mutex: std.Thread.Mutex = .{};

fn increment_safe() void {
    for (0..1_000_000) |_| {
        mutex.lock();
        counter += 1;
        mutex.unlock();
    }
}

pub fn main() !void {
    const t1 = try std.Thread.spawn(.{}, increment_safe, .{});
    const t2 = try std.Thread.spawn(.{}, increment_safe, .{});
    t1.join();
    t2.join();

    // Now always correct: 2,000,000
    std.debug.print("counter = {d}\n", .{counter});
}
```

The mutex serializes access. Only one thread increments at a time. The result is always correct — but notice the cost: two threads are not running in parallel anymore. They take turns. For a workload that is entirely a mutex-protected critical section, adding more threads adds no performance.

### 3.2 The Mutex API in Zig

```zig
var mu: std.Thread.Mutex = .{};

// Basic lock/unlock
mu.lock();
defer mu.unlock(); // always unlock — even if code returns early or panics
// critical section here

// Try-lock: returns false if mutex is already held
if (mu.tryLock()) {
    defer mu.unlock();
    // critical section
} else {
    // do something else
}
```

Always use `defer mu.unlock()` immediately after `mu.lock()`. This ensures the mutex is released even if the critical section returns early or panics.

### 3.3 Protecting a Data Structure

The mutex should protect a data structure, not scattered global state. The idiomatic Zig pattern wraps the mutex and the data together:

```zig
const std = @import("std");

/// Thread-safe counter: mutex and data together
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

    pub fn add(self: *SafeCounter, n: u64) void {
        self.mu.lock();
        defer self.mu.unlock();
        self.value += n;
    }
};

var counter: SafeCounter = .{};

fn worker(_: void) void {
    for (0..100_000) |_| counter.increment();
}

pub fn main() !void {
    var threads: [8]std.Thread = undefined;
    for (&threads) |*t| t.* = try std.Thread.spawn(.{}, worker, .{{}});
    for (&threads) |*t| t.join();
    std.debug.print("counter = {d}\n", .{counter.get()});
}
```

### 3.4 Reader-Writer Locks

When reads greatly outnumber writes, a plain mutex is wasteful: concurrent readers cannot proceed in parallel even though simultaneous reads are safe. A **reader-writer lock** allows unlimited concurrent readers OR one exclusive writer, but not both simultaneously.

```zig
const std = @import("std");

const Cache = struct {
    rwlock: std.Thread.RwLock = .{},
    data: std.StringHashMap(u64),

    pub fn init(allocator: std.mem.Allocator) Cache {
        return .{ .data = std.StringHashMap(u64).init(allocator) };
    }

    pub fn deinit(self: *Cache) void {
        self.data.deinit();
    }

    // Multiple threads can call get() simultaneously
    pub fn get(self: *Cache, key: []const u8) ?u64 {
        self.rwlock.lockShared();     // shared (read) lock
        defer self.rwlock.unlockShared();
        return self.data.get(key);
    }

    // Only one thread can call put() at a time, and no readers
    pub fn put(self: *Cache, key: []const u8, value: u64) !void {
        self.rwlock.lock();           // exclusive (write) lock
        defer self.rwlock.unlock();
        try self.data.put(key, value);
    }
};
```

RwLock tradeoffs: reads are faster under contention (multiple readers proceed in parallel), but write-heavy workloads may be slower than a plain mutex due to RwLock's higher overhead per operation.

---

> **Exercise 8.1: Concurrent HashMap**
>
> Implement a thread-safe hash map that supports concurrent reads and exclusive writes using `std.Thread.RwLock`:
>
> ```zig
> pub fn ConcurrentMap(comptime K: type, comptime V: type) type {
>     return struct {
>         rwlock: std.Thread.RwLock,
>         map: std.AutoHashMap(K, V),
>
>         pub fn init(allocator: std.mem.Allocator) @This() { ... }
>         pub fn deinit(self: *@This()) void { ... }
>         pub fn get(self: *@This(), key: K) ?V { ... }
>         pub fn put(self: *@This(), key: K, value: V) !void { ... }
>         pub fn remove(self: *@This(), key: K) bool { ... }
>         pub fn count(self: *@This()) usize { ... }
>     };
> }
> ```
>
> Benchmark: 8 reader threads, 2 writer threads, 1M operations each.
> Compare throughput against a plain `Mutex`-protected version.
> Under what ratio of reads to writes does RwLock outperform Mutex?

---

## Part 4: Condition Variables — Waiting for Events

### 4.1 The Problem with Busy-Waiting

Sometimes a thread needs to wait for a condition to become true — for example, a consumer thread waiting for items to appear in a queue. A naive approach is **busy-waiting**:

```zig
// BAD: consumes 100% CPU while waiting
while (queue.isEmpty()) {
    // spin
}
const item = queue.dequeue();
```

This wastes CPU time and may prevent the producer thread from running (on a single core). The correct solution is to block the thread until the condition is true.

### 4.2 Condition Variables

A **condition variable** allows threads to wait for a condition and be notified when it may be true. It is always used together with a mutex:

```zig
const std = @import("std");

const ProducerConsumer = struct {
    mu: std.Thread.Mutex = .{},
    cond: std.Thread.Condition = .{},
    queue: std.ArrayList(u32),
    done: bool = false,

    pub fn init(allocator: std.mem.Allocator) ProducerConsumer {
        return .{ .queue = std.ArrayList(u32).init(allocator) };
    }

    pub fn deinit(self: *ProducerConsumer) void {
        self.queue.deinit();
    }

    pub fn produce(self: *ProducerConsumer, item: u32) !void {
        self.mu.lock();
        defer self.mu.unlock();
        try self.queue.append(item);
        self.cond.signal(); // wake one waiting consumer
    }

    pub fn finish(self: *ProducerConsumer) void {
        self.mu.lock();
        defer self.mu.unlock();
        self.done = true;
        self.cond.broadcast(); // wake all waiting consumers
    }

    pub fn consume(self: *ProducerConsumer) ?u32 {
        self.mu.lock();
        defer self.mu.unlock();

        // MUST use a while loop — not if — because of spurious wakeups
        while (self.queue.items.len == 0 and !self.done) {
            self.cond.wait(&self.mu); // atomically releases mutex and sleeps
            // When we wake up, mutex is held again
        }

        if (self.queue.items.len > 0) {
            return self.queue.orderedRemove(0);
        }
        return null; // done and queue empty
    }
};
```

The three-step pattern:
1. Hold the mutex
2. Check the condition in a `while` loop (not `if` — spurious wakeups can occur)
3. Call `cond.wait(&mutex)` which atomically releases the mutex and sleeps; re-acquires mutex on wakeup

The `while` loop is essential. A condition variable can wake up spuriously — without any `signal()` or `broadcast()` — due to implementation details on some platforms. Always re-check the condition after waking.

### 4.3 Semaphores — Counting Resources

A **semaphore** generalizes a mutex: it tracks a count of available resources. `wait()` decrements the count (blocking if zero); `post()` increments it (waking a waiter if any exist).

```zig
const std = @import("std");

/// Connection pool: at most MAX_CONNECTIONS concurrent database connections
const MAX_CONNECTIONS = 10;

const ConnectionPool = struct {
    sem: std.Thread.Semaphore,
    connections: [MAX_CONNECTIONS]Connection,
    available: std.fifo.LinearFifo(usize, .Static(MAX_CONNECTIONS)),
    mu: std.Thread.Mutex = .{},

    const Connection = struct { id: usize, in_use: bool };

    pub fn init(self: *ConnectionPool) void {
        self.sem = std.Thread.Semaphore{ .permits = MAX_CONNECTIONS };
        for (&self.connections, 0..) |*c, i| {
            c.* = .{ .id = i, .in_use = false };
            self.available.writeItem(i) catch unreachable;
        }
    }

    pub fn acquire(self: *ConnectionPool) *Connection {
        self.sem.wait();  // blocks when no connections available
        self.mu.lock();
        defer self.mu.unlock();
        const idx = self.available.readItem().?;
        self.connections[idx].in_use = true;
        return &self.connections[idx];
    }

    pub fn release(self: *ConnectionPool, conn: *Connection) void {
        self.mu.lock();
        conn.in_use = false;
        self.available.writeItem(conn.id) catch unreachable;
        self.mu.unlock();
        self.sem.post(); // wake a waiting thread
    }
};
```

Semaphores are the right tool when you need to limit concurrency to N — connection pools, rate limiters, bounded queues.

---

## Part 5: Deadlock

### 5.1 The Four Coffman Conditions

A **deadlock** occurs when a set of threads are all blocked, each waiting for a resource held by another thread in the set. No progress is possible; the system is stuck forever.

For deadlock to occur, all four of the **Coffman conditions** must hold simultaneously:

**1. Mutual Exclusion:** At least one resource is held in a non-sharable mode — only one thread can use it at a time. (Mutexes provide mutual exclusion by design.)

**2. Hold and Wait:** A thread is holding at least one resource and waiting to acquire additional resources held by other threads.

**3. No Preemption:** Resources cannot be forcibly taken from threads — a thread must voluntarily release what it holds.

**4. Circular Wait:** A set of threads {T₁, T₂, ..., Tₙ} exists such that T₁ is waiting for a resource held by T₂, T₂ is waiting for one held by T₃, ..., and Tₙ is waiting for one held by T₁.

All four must hold. Breaking any one prevents deadlock.

### 5.2 Producing a Deadlock

```zig
const std = @import("std");

var mu_a: std.Thread.Mutex = .{};
var mu_b: std.Thread.Mutex = .{};

fn thread_1(_: void) void {
    mu_a.lock(); // acquire A
    std.time.sleep(10_000_000); // give thread_2 time to acquire B
    mu_b.lock(); // wait for B — but thread_2 holds B waiting for A → DEADLOCK
    defer mu_b.unlock();
    defer mu_a.unlock();
    std.debug.print("thread_1 completed\n", .{});
}

fn thread_2(_: void) void {
    mu_b.lock(); // acquire B
    std.time.sleep(10_000_000); // give thread_1 time to acquire A
    mu_a.lock(); // wait for A — but thread_1 holds A waiting for B → DEADLOCK
    defer mu_a.unlock();
    defer mu_b.unlock();
    std.debug.print("thread_2 completed\n", .{});
}

pub fn main() !void {
    const t1 = try std.Thread.spawn(.{}, thread_1, .{{}});
    const t2 = try std.Thread.spawn(.{}, thread_2, .{{}});
    t1.join(); // hangs forever
    t2.join();
}
```

Run this. It hangs. `thread_1` holds `mu_a` and waits for `mu_b`. `thread_2` holds `mu_b` and waits for `mu_a`. Circular wait, no preemption, mutual exclusion, hold and wait — all four conditions present.

### 5.3 Breaking Deadlock — Lock Ordering

The standard fix for deadlock is **consistent lock ordering**: always acquire locks in the same global order. If all code that needs both `mu_a` and `mu_b` always acquires `mu_a` before `mu_b`, circular wait is impossible.

```zig
fn thread_1_fixed(_: void) void {
    mu_a.lock(); // always A before B
    defer mu_a.unlock();
    mu_b.lock();
    defer mu_b.unlock();
    std.debug.print("thread_1 completed\n", .{});
}

fn thread_2_fixed(_: void) void {
    mu_a.lock(); // always A before B — same order as thread_1
    defer mu_a.unlock();
    mu_b.lock();
    defer mu_b.unlock();
    std.debug.print("thread_2 completed\n", .{});
}
```

Now if `thread_1` holds `mu_a` and `thread_2` tries to acquire `mu_a`, `thread_2` blocks immediately — it never acquires `mu_b`, so `thread_1` can proceed to acquire `mu_b`, complete, and release both locks.

For more than two locks, extend the ordering: always acquire lock with index i before lock with index j when i < j.

### 5.4 The Dining Philosophers

The Dining Philosophers is the classic deadlock problem. Five philosophers sit around a table. Between each pair of adjacent philosophers is one chopstick (5 total). To eat, a philosopher needs both chopsticks on either side.

If all philosophers simultaneously pick up their left chopstick, everyone holds one chopstick and waits for the other — deadlock.

```zig
const std = @import("std");

const N = 5;
var chopsticks: [N]std.Thread.Mutex = [_]std.Thread.Mutex{.{}} ** N;

// BUGGY: can deadlock
fn philosopher_buggy(id: usize) void {
    for (0..3) |_| {
        // think
        std.time.sleep(1_000_000);

        // pick up left, then right
        chopsticks[id].lock();
        chopsticks[(id + 1) % N].lock();

        // eat
        std.debug.print("philosopher {d} eating\n", .{id});
        std.time.sleep(1_000_000);

        chopsticks[(id + 1) % N].unlock();
        chopsticks[id].unlock();
    }
}

// FIXED: consistent ordering — always pick up lower-indexed first
fn philosopher_fixed(id: usize) void {
    const left = id;
    const right = (id + 1) % N;
    const first = @min(left, right);
    const second = @max(left, right);

    for (0..3) |_| {
        std.time.sleep(1_000_000);

        chopsticks[first].lock();  // always lower index first
        chopsticks[second].lock();

        std.debug.print("philosopher {d} eating\n", .{id});
        std.time.sleep(1_000_000);

        chopsticks[second].unlock();
        chopsticks[first].unlock();
    }
}
```

An alternative fix: use a semaphore to allow at most N-1 philosophers to try eating simultaneously. This ensures at least one philosopher can always eat, preventing circular wait.

### 5.5 Livelock and Starvation

**Livelock:** Threads are actively running but making no progress. Each thread responds to the other's actions by changing its own state, but the system as a whole cycles without completing.

```zig
// Livelock: each thread backs off when it sees the other
fn polite_thread(id: usize, other_flag: *bool, my_flag: *bool) void {
    while (true) {
        my_flag.* = true; // signal intent to proceed
        while (other_flag.*) { // if other also wants to go
            my_flag.* = false; // back off
            std.time.sleep(1_000_000);
            my_flag.* = true; // try again
        }
        // proceed — but this may never happen if both back off in sync
        std.debug.print("thread {d} proceeding\n", .{id});
        my_flag.* = false;
        return;
    }
}
```

Livelock is harder to detect than deadlock because the threads appear active in `top` or `htop` — they are consuming CPU — but making no actual progress.

**Starvation:** One or more threads are perpetually denied access to a resource because other threads always get priority. Unlike deadlock (no progress for anyone), in starvation some threads make progress while others never do.

MLFQ without the priority boost suffers from starvation: CPU-bound jobs in the lowest queue never run if there is always a stream of short interactive jobs in higher queues.

The fix for both is typically **randomness or aging**: introduce random jitter in backoff intervals to break synchronization (fixing livelock), or boost the priority of waiting threads over time (fixing starvation).

---

> **Exercise 8.2: Dining Philosophers — Three Solutions**
>
> Implement the Dining Philosophers problem three ways:
>
> 1. **Lock ordering:** Lower-index chopstick always first (as shown above)
> 2. **Semaphore:** Allow at most N-1 philosophers to attempt eating simultaneously
> 3. **Arbitrator:** A waiter (single mutex) must be asked permission before picking up any chopstick
>
> For each solution:
> - Verify it doesn't deadlock (run for 1000 meals with 5 philosophers)
> - Measure the throughput (total meals eaten per second)
> - Explain which of the four Coffman conditions it breaks
>
> Which solution has the highest throughput? Why?

---

## Part 6: Atomic Operations

### 6.1 The Problem with Mutexes for Simple Operations

A mutex is correct but heavyweight. For simple operations like incrementing a counter, the overhead of mutex acquisition and release dominates. Each operation involves:
- A system call or at minimum a memory barrier
- Potential blocking and context switching if contended
- Cache line invalidation across all cores

For a single counter increment, this is 10-100x the cost of the increment itself.

**Atomic operations** are hardware-supported read-modify-write operations that complete as a single indivisible step. The hardware guarantees no other thread can observe an intermediate state.

### 6.2 Zig's Atomic Primitives

```zig
const std = @import("std");
const atomic = std.atomic;

// An atomic value: all operations on it are atomic
var counter: atomic.Value(u64) = atomic.Value(u64).init(0);

fn increment_atomic() void {
    for (0..1_000_000) |_| {
        _ = counter.fetchAdd(1, .monotonic);
    }
}

pub fn main() !void {
    const t1 = try std.Thread.spawn(.{}, increment_atomic, .{});
    const t2 = try std.Thread.spawn(.{}, increment_atomic, .{});
    t1.join();
    t2.join();

    // Always correct: 2,000,000
    std.debug.print("counter = {d}\n", .{counter.load(.seq_cst)});
}
```

The full set of atomic operations in Zig's `std.atomic.Value(T)`:

```zig
// Load and store
const val = atom.load(.acquire);     // atomic read
atom.store(42, .release);            // atomic write

// Fetch-and-modify: returns the old value
const old = atom.fetchAdd(1, .monotonic);   // old = val; val += 1
const old = atom.fetchSub(1, .monotonic);   // old = val; val -= 1
const old = atom.fetchAnd(mask, .monotonic); // old = val; val &= mask
const old = atom.fetchOr(flags, .monotonic); // old = val; val |= flags
const old = atom.fetchXor(mask, .monotonic); // old = val; val ^= mask
const old = atom.swap(new_val, .acq_rel);    // old = val; val = new_val

// Compare-and-swap: the foundation of lock-free algorithms
// If val == expected, set val = new_val and return null
// Otherwise return the current value (the CAS failed)
const result = atom.cmpxchgStrong(expected, new_val, .acq_rel, .monotonic);
if (result == null) { /* success */ } else |actual| { /* failed: actual is current value */ }

// Weak CAS: may fail spuriously (cheaper on some architectures)
const result = atom.cmpxchgWeak(expected, new_val, .acq_rel, .monotonic);
```

### 6.3 Memory Ordering — The Hard Part

Memory ordering specifies what guarantees an atomic operation provides about the ordering of other memory accesses relative to it. This is necessary because both the compiler and the CPU reorder memory operations for performance.

The orderings, from weakest to strongest:

**`.relaxed` (monotonic):** The atomic operation is atomic, but no ordering constraints relative to other memory accesses. Other threads may observe accesses in any order. Use only when the atomic operation is entirely self-contained — for example, a counter where you only care about the final value, not about data written before/after the increment.

```zig
// Safe: counter is the only shared variable being modified
var hits: atomic.Value(u64) = .init(0);
_ = hits.fetchAdd(1, .monotonic); // no other data depends on this
```

**`.acquire` / `.release`:** Release-acquire pairs establish a "happens-before" relationship between two threads. A `.release` store ensures that all writes by the storing thread before the store are visible to any thread that then performs an `.acquire` load of the same value.

```zig
// Thread 1 (producer):
data[i] = value;              // write data
ready.store(true, .release);  // "publish" — all writes above are visible
                               // to anyone who acquires this store

// Thread 2 (consumer):
while (!ready.load(.acquire)) {}  // acquire: synchronizes with the release
// Now we can safely read data[i] — the release guarantees it's written
const v = data[i];
```

**`.seq_cst` (sequentially consistent):** The strongest ordering. All `.seq_cst` operations form a single total order visible to all threads. This is the default in C++ atomics. It is correct everywhere but may be slower on weakly-ordered architectures (ARM, POWER) that require memory fences to enforce it.

**Decision rule:**
- Default to `.seq_cst` for correctness when learning
- Use `.acquire`/`.release` pairs when you have a clear producer/consumer relationship
- Use `.monotonic` (relaxed) only for counters and statistics where ordering doesn't matter
- Never use `.relaxed` for flag variables that coordinate other data

### 6.4 Compare-and-Swap — The Foundation of Lock-Free

**Compare-and-swap (CAS)** is the fundamental primitive for lock-free programming. It atomically: reads a variable, compares to an expected value, and if they match, writes a new value. Returns whether the swap succeeded.

A lock-free counter using CAS:

```zig
fn increment_cas(counter: *atomic.Value(u64)) void {
    while (true) {
        const old = counter.load(.monotonic);
        // Try to store old+1; retry if another thread changed it first
        if (counter.cmpxchgWeak(old, old + 1, .monotonic, .monotonic) == null) {
            break; // success
        }
        // Another thread modified counter first: retry
    }
}
```

This is slower than `fetchAdd` for a counter (CAS can fail and retry), but it is the building block for operations that `fetchAdd` cannot express — like atomically updating two fields that must stay consistent.

### 6.5 A Lock-Free Stack

```zig
const std = @import("std");
const atomic = std.atomic;

/// Lock-free stack using CAS
fn LockFreeStack(comptime T: type) type {
    return struct {
        const Self = @This();
        const Node = struct {
            value: T,
            next: ?*Node,
        };

        head: atomic.Value(?*Node) = atomic.Value(?*Node).init(null),
        allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator) Self {
            return .{ .allocator = allocator };
        }

        pub fn push(self: *Self, value: T) !void {
            const node = try self.allocator.create(Node);
            node.value = value;

            while (true) {
                const old_head = self.head.load(.monotonic);
                node.next = old_head;
                // CAS: if head is still old_head, set it to node
                if (self.head.cmpxchgWeak(
                    old_head, node, .release, .monotonic) == null)
                {
                    break; // success
                }
                // Another thread pushed first: retry
            }
        }

        pub fn pop(self: *Self) ?T {
            while (true) {
                const old_head = self.head.load(.acquire);
                const node = old_head orelse return null; // empty stack

                // CAS: if head is still old_head, update to next
                if (self.head.cmpxchgWeak(
                    old_head, node.next, .acquire, .monotonic) == null)
                {
                    const value = node.value;
                    self.allocator.destroy(node);
                    return value;
                }
                // Another thread popped first: retry
            }
        }
    };
}
```

> **Important:** This stack has the **ABA problem** — a known hazard in lock-free programming. If thread A reads head=X, then thread B pops X and Y and pushes X back, then thread A's CAS succeeds (head is still X) but the list is now in a different state than A assumed. Real lock-free stacks use hazard pointers or epoch-based reclamation to avoid this. For production code, prefer a mutex-protected stack unless you have profiling evidence that the mutex is a bottleneck.

---

> **Exercise 8.3: Lock-Free Reference Counter**
>
> Implement a thread-safe reference-counted smart pointer using atomics (similar to `Arc<T>` in Rust or `std::shared_ptr` in C++):
>
> ```zig
> fn Arc(comptime T: type) type {
>     return struct {
>         // Inner struct shared by all Arc instances pointing to same data
>         const Inner = struct {
>             value: T,
>             ref_count: atomic.Value(usize),
>         };
>
>         inner: *Inner,
>
>         pub fn new(allocator: std.mem.Allocator, value: T) !@This() { ... }
>         pub fn clone(self: @This()) @This() { ... }  // increments ref count
>         pub fn deinit(self: @This(), allocator: std.mem.Allocator) void { ... }
>         pub fn get(self: @This()) *const T { ... }
>     };
> }
> ```
>
> Key question: which memory ordering is correct for the reference count operations?
> - Increment: `.monotonic` (why is this safe?)
> - Decrement: `.acq_rel` (why is this required?)
>
> Hint: The decrement to zero must synchronize with all prior increments and data accesses.

---

## Part 7: The Memory Model

### 7.1 Why the Memory Model Exists

On a modern multi-core processor, each core has its own cache. Writes by one core are not immediately visible to other cores — they must propagate through the cache coherency protocol. This propagation is not instantaneous and may happen in different orders for different cores.

The compiler also reorders instructions for optimization — a store to memory may be moved earlier or later in the instruction stream if the compiler determines it doesn't affect the single-threaded result.

The result: without explicit constraints, two threads may observe memory in completely different orders. This is not a bug — it is the performance model of modern hardware.

The **memory model** defines the rules for what orderings are possible and how to constrain them. Zig's memory model aligns with LLVM's, which is based on C++11's model.

### 7.2 Observing Reordering

On x86-64, the hardware memory model (TSO — Total Store Order) is relatively strong: stores are never reordered with each other, and loads are never reordered with each other. But stores can be reordered with respect to loads (a store may appear to happen after a subsequent load from the reader's perspective).

On ARM and POWER architectures, the hardware model is much weaker: almost any reordering is permitted in the absence of fence instructions. Code that works correctly on x86-64 due to its strong hardware ordering may silently break on ARM.

This is why you cannot rely on hardware ordering — you must use atomic operations with the appropriate memory ordering to make your intent explicit and portable.

### 7.3 A Classic Reordering Bug

```zig
// Shared variables — NOT atomics (demonstrating the danger)
var data: u64 = 0;
var ready: bool = false;

fn producer() void {
    data = 42;      // write data
    ready = true;   // signal ready
    // The compiler or CPU may reorder: ready=true might be visible
    // before data=42 on some architectures
}

fn consumer() void {
    while (!ready) {} // wait for ready
    // On a weakly-ordered CPU, data might still be 0 here!
    std.debug.print("data = {d}\n", .{data});
}
```

The fix uses release/acquire semantics:

```zig
var data: u64 = 0;
var ready: atomic.Value(bool) = atomic.Value(bool).init(false);

fn producer() void {
    data = 42;
    ready.store(true, .release); // all writes before this are visible
                                 // to anyone who acquires this store
}

fn consumer() void {
    while (!ready.load(.acquire)) {} // synchronizes with the release
    // data is now guaranteed to be 42
    std.debug.print("data = {d}\n", .{data});
}
```

The `.release` store acts as a one-way barrier: all memory writes before it are committed before the store executes. The `.acquire` load acts as a one-way barrier: all memory reads after it happen after the load executes. Together they establish a happens-before relationship between the producer's writes and the consumer's reads.

---

## Part 8: Amdahl's Law and Scalability

### 8.1 The Theoretical Limit

No matter how many threads you add, the portion of your program that must run sequentially limits your maximum speedup. Amdahl's Law quantifies this:

```
Speedup = 1 / (S + P/N)
```

Where:
- `S` is the fraction that is strictly sequential (cannot be parallelized)
- `P` is the fraction that can be parallelized (P = 1 - S)
- `N` is the number of processors

As N → ∞:

```
Maximum speedup = 1 / S
```

If 10% of your program is sequential, the maximum possible speedup is **10x**, regardless of how many cores you use.

```zig
pub fn amdahl_speedup(sequential_fraction: f64, threads: usize) f64 {
    const s = sequential_fraction;
    const p = 1.0 - s;
    const n: f64 = @floatFromInt(threads);
    return 1.0 / (s + p / n);
}

pub fn print_amdahl_table() void {
    std.debug.print("\nAmdahl's Law: Maximum Speedup\n", .{});
    std.debug.print("{s:>12}", .{"Seq fraction"});
    for ([_]usize{1, 2, 4, 8, 16, 32, 64}) |n| {
        std.debug.print(" {:>6} cores", .{n});
    }
    std.debug.print("\n", .{});

    for ([_]f64{0.5, 0.25, 0.1, 0.05, 0.01}) |s| {
        std.debug.print("{d:>12.0}%", .{s * 100});
        for ([_]usize{1, 2, 4, 8, 16, 32, 64}) |n| {
            std.debug.print(" {:>9.1}x", .{amdahl_speedup(s, n)});
        }
        std.debug.print("  (max: {d:.1}x)\n", .{1.0 / s});
    }
}
```

### 8.2 Measuring Parallel Efficiency

Parallel efficiency = speedup / N. Perfect efficiency = 1.0 (100%). Real systems are below 1.0 due to synchronization overhead, load imbalance, and memory bandwidth contention.

```zig
pub fn measure_scalability(
    work_fn: *const fn ([]u64) void,
    data: []u64,
) !void {
    const max_threads = try std.Thread.getCpuCount();
    var timer = try std.time.Timer.start();

    // Single-thread baseline
    timer.reset();
    work_fn(data);
    const baseline_ns = timer.read();

    std.debug.print("\nScalability measurement:\n", .{});
    std.debug.print("{s:>8}  {s:>10}  {s:>10}  {s:>12}\n",
        .{"Threads", "Time (ms)", "Speedup", "Efficiency"});

    var n: usize = 1;
    while (n <= max_threads) : (n *= 2) {
        // Partition data and run n threads
        // ... (thread spawning and joining)
        const parallel_ns: u64 = baseline_ns; // placeholder
        const speedup = @as(f64, @floatFromInt(baseline_ns)) /
                        @as(f64, @floatFromInt(parallel_ns));
        const efficiency = speedup / @as(f64, @floatFromInt(n));

        std.debug.print("{d:>8}  {d:>10}  {d:>10.2}x  {d:>11.1}%\n",
            .{ n, parallel_ns / 1_000_000, speedup, efficiency * 100 });
    }
}
```

### 8.3 Gustafson's Law — The Other Perspective

Amdahl's Law holds the problem size fixed and asks: how much faster can we solve this fixed problem? The answer is bounded by the sequential fraction.

Gustafson's Law takes a different view: what if we scale the problem size with the number of processors? As hardware gets faster, we use it to solve larger problems, not to solve the same problem faster. Under this model, the sequential fraction typically shrinks as the problem grows, and scaling efficiency is much better.

This is why parallel computing keeps improving: we don't run the same weather model faster, we run a higher-resolution weather model in the same time.

---

## Part 9: The Module Project — A Concurrent Key-Value Store

### Project Specification

Build a production-quality thread-safe key-value store that supports concurrent reads and exclusive writes, with a configurable number of shards to reduce lock contention.

**Why sharding?** A single mutex for an entire hash map means all concurrent operations serialize — only one can proceed at a time. Sharding splits the map into N independent segments, each with its own lock. Operations on different shards can proceed in parallel. With 16 shards and 16 threads, contention drops to approximately 1/16th.

### Architecture

```zig
const std = @import("std");
const atomic = std.atomic;

pub fn ShardedKvStore(comptime K: type, comptime V: type,
                      comptime N_SHARDS: usize) type {
    return struct {
        const Self = @This();
        const Shard = struct {
            mu: std.Thread.RwLock = .{},
            map: std.AutoHashMap(K, V),
        };

        shards: [N_SHARDS]Shard,
        allocator: std.mem.Allocator,

        // Metrics
        reads: atomic.Value(u64) = atomic.Value(u64).init(0),
        writes: atomic.Value(u64) = atomic.Value(u64).init(0),
        hits: atomic.Value(u64) = atomic.Value(u64).init(0),

        pub fn init(allocator: std.mem.Allocator) Self {
            var self: Self = undefined;
            self.allocator = allocator;
            self.reads = atomic.Value(u64).init(0);
            self.writes = atomic.Value(u64).init(0);
            self.hits = atomic.Value(u64).init(0);
            for (&self.shards) |*shard| {
                shard.* = .{ .map = std.AutoHashMap(K, V).init(allocator) };
            }
            return self;
        }

        pub fn deinit(self: *Self) void {
            for (&self.shards) |*shard| shard.map.deinit();
        }

        fn shard_index(key: K) usize {
            // Hash key to shard
            const h = std.hash_map.getAutoHashFn(K, void)({}, key);
            return h % N_SHARDS;
        }

        pub fn get(self: *Self, key: K) ?V {
            _ = self.reads.fetchAdd(1, .monotonic);
            const idx = shard_index(key);
            const shard = &self.shards[idx];

            shard.mu.lockShared();
            defer shard.mu.unlockShared();

            const result = shard.map.get(key);
            if (result != null) _ = self.hits.fetchAdd(1, .monotonic);
            return result;
        }

        pub fn put(self: *Self, key: K, value: V) !void {
            _ = self.writes.fetchAdd(1, .monotonic);
            const idx = shard_index(key);
            const shard = &self.shards[idx];

            shard.mu.lock();
            defer shard.mu.unlock();

            try shard.map.put(key, value);
        }

        pub fn remove(self: *Self, key: K) bool {
            const idx = shard_index(key);
            const shard = &self.shards[idx];

            shard.mu.lock();
            defer shard.mu.unlock();

            return shard.map.remove(key);
        }

        pub fn print_stats(self: *const Self) void {
            const reads = self.reads.load(.monotonic);
            const hits = self.hits.load(.monotonic);
            const writes = self.writes.load(.monotonic);
            const hit_rate = if (reads > 0)
                @as(f64, @floatFromInt(hits)) /
                @as(f64, @floatFromInt(reads)) * 100.0
            else 0.0;

            std.debug.print("\nKV Store Stats:\n", .{});
            std.debug.print("  Reads:     {d}\n", .{reads});
            std.debug.print("  Writes:    {d}\n", .{writes});
            std.debug.print("  Hit rate:  {d:.1}%\n", .{hit_rate});
            std.debug.print("  Shards:    {d}\n", .{N_SHARDS});
        }
    };
}
```

### The Benchmark

```zig
pub fn benchmark_sharding() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const N_THREADS = 8;
    const OPS_PER_THREAD = 100_000;
    const READ_FRACTION = 0.9; // 90% reads, 10% writes

    // Compare 1 shard vs 8 shards vs 64 shards
    inline for ([_]usize{1, 8, 64}) |n_shards| {
        var store = ShardedKvStore(u64, u64, n_shards).init(allocator);
        defer store.deinit();

        // Pre-populate
        for (0..10_000) |i| {
            try store.put(i, i * 2);
        }

        var timer = try std.time.Timer.start();
        var threads: [N_THREADS]std.Thread = undefined;

        for (&threads, 0..) |*t, tid| {
            t.* = try std.Thread.spawn(.{}, struct {
                fn run(s: anytype, id: usize) void {
                    var rng = std.rand.DefaultPrng.init(id * 137);
                    const rand = rng.random();
                    for (0..OPS_PER_THREAD) |_| {
                        const key = rand.uintLessThan(u64, 10_000);
                        if (rand.float(f32) < READ_FRACTION) {
                            _ = s.get(key);
                        } else {
                            s.put(key, key) catch {};
                        }
                    }
                }
            }.run, .{ &store, tid });
        }
        for (&threads) |*t| t.join();

        const elapsed = timer.read();
        const total_ops = N_THREADS * OPS_PER_THREAD;
        const ops_per_sec = @as(f64, @floatFromInt(total_ops)) /
                            (@as(f64, @floatFromInt(elapsed)) / 1e9);

        std.debug.print("Shards={d:>3}: {d:.0} ops/sec\n",
            .{ n_shards, ops_per_sec });
    }
}
```

### Extension Challenges

1. **Lock-free reads with copy-on-write:** Implement an RCU (Read-Copy-Update) variant: reads are lock-free using an atomic pointer to an immutable snapshot; writes create a new snapshot and atomically swap the pointer. Measure the read latency improvement over the mutex version.

2. **Persistence:** Add a write-ahead log (WAL) that durably persists every write to a file. Implement crash recovery by replaying the log on startup. This connects the concurrency module to the file system concepts from Module 3.

3. **Eviction policy:** Add a bounded capacity with LRU eviction. This requires tracking access order concurrently — a classic lock design challenge because the access order changes on every read.

---

## Summary

Concurrency and parallelism are not the same thing. Concurrency is structural; parallelism is execution. Most concurrent programs need both: parallel threads doing real work, plus careful coordination of shared state.

**Race conditions** occur when shared mutable state is accessed without synchronization. They are non-deterministic, hard to reproduce, and can corrupt data silently. The fix is always explicit synchronization.

**Mutexes** serialize access to critical sections. Use `defer mu.unlock()` immediately after every `mu.lock()`. Protect data structures, not individual operations.

**Condition variables** allow threads to wait for conditions without busy-waiting. Always use a `while` loop — not `if` — because of spurious wakeups.

**Deadlock** requires all four Coffman conditions simultaneously. The standard fix is consistent lock ordering — always acquire locks in the same global sequence.

**Livelock** and **starvation** are subtle relatives of deadlock: threads active but making no progress, or some threads perpetually bypassed.

**Atomic operations** provide lock-free access to single variables. `fetchAdd` for counters; CAS for more complex update patterns. Memory ordering is not optional — choose `.seq_cst` for correctness when learning, then optimize with `.acquire`/`.release` pairs once you understand the happens-before relationships.

**Amdahl's Law** is inescapable: the sequential fraction bounds maximum speedup. Adding threads to a mostly-sequential program gives diminishing returns. Measure parallel efficiency, not just absolute speedup.

---

## What's Next

Module 9 — File Systems and Persistence — moves from in-memory concurrency to durable storage. You now understand how programs share mutable state in memory. Module 9 teaches how programs make state survive power loss: file system structure, crash consistency, journaling, and memory-mapped I/O.

---

## Reference: Zig Concurrency Primitives

```zig
// Thread creation and joining
const t = try std.Thread.spawn(.{}, func, .{arg});
t.join();
t.detach(); // fire and forget — no join needed

// Mutex
var mu: std.Thread.Mutex = .{};
mu.lock();
defer mu.unlock();
if (mu.tryLock()) { defer mu.unlock(); ... }

// Reader-writer lock
var rwl: std.Thread.RwLock = .{};
rwl.lockShared(); defer rwl.unlockShared(); // read lock
rwl.lock();       defer rwl.unlock();       // write lock

// Condition variable
var cond: std.Thread.Condition = .{};
cond.wait(&mu);       // release mu, sleep, reacquire mu on wakeup
cond.signal();        // wake one waiter
cond.broadcast();     // wake all waiters
cond.timedWait(&mu, timeout_ns); // wait with timeout

// Semaphore
var sem: std.Thread.Semaphore = .{ .permits = N };
sem.wait();   // decrement (block if 0)
sem.post();   // increment (wake if waiters)

// Atomics
var atom: atomic.Value(T) = atomic.Value(T).init(val);
atom.load(.ordering)
atom.store(val, .ordering)
atom.fetchAdd(n, .ordering)   // returns old value
atom.fetchSub(n, .ordering)
atom.swap(new, .ordering)     // returns old value
atom.cmpxchgStrong(expected, new, success_order, fail_order)
atom.cmpxchgWeak(expected, new, success_order, fail_order)

// Memory orderings (weakest to strongest):
// .monotonic / .relaxed — no ordering constraints
// .acquire — loads: all subsequent reads happen after this load
// .release — stores: all prior writes visible before this store
// .acq_rel — combined acquire+release (for RMW operations)
// .seq_cst — global total order across all seq_cst operations
```

## Reference: Deadlock Checklist

```
To prevent deadlock, ensure at least one of these is impossible:

1. Break Mutual Exclusion:
   □ Use read-write locks when possible (allows concurrent reads)
   □ Use lock-free structures for simple operations

2. Break Hold and Wait:
   □ Acquire all locks at once (not always practical)
   □ Release all held locks before acquiring new ones

3. Break No Preemption:
   □ Use tryLock() — abort and retry if lock unavailable
   □ Use timeout-based locking

4. Break Circular Wait (MOST PRACTICAL):
   □ Define a global ordering of all locks
   □ Always acquire locks in that order
   □ Never acquire lock[j] while holding lock[i] when i > j
```

---

*End of Module 8*
