# Module 18: Systems Design Under Load

## The Craft of Systems Programming — Teaching Material

---

> *"Any system can handle its average load. The difference between a system and a production system is what happens at 3x average, during a deployment, when a dependency goes down, or when the traffic pattern changes in a way nobody predicted."*

---

## Before You Begin

This is the final module before the capstone. You have built the complete stack: from how bits are represented in registers all the way to distributed consensus, transactions, and replication. You can implement TCP in raw sockets, write a Raft node from scratch, and design a protocol with correct versioning semantics.

What you have not done yet is synthesize all of it into a coherent design under real-world constraints.

Systems design is the discipline of taking a vague requirement — "build something like Redis, but distributed" or "design a URL shortener for 500 million users" — and producing a concrete architecture with justified decisions at every layer: what to cache and why, how to shard and on what key, what consistency level to choose and what anomalies that accepts, where the bottleneck will be and how to measure it, what happens when traffic is 10x the expected load.

This module teaches that discipline. Not through abstract frameworks, but through the engineering thinking that underlies every good system: capacity estimation, bottleneck identification, the specific patterns that turn a system that works into a system that holds under load, and the honest acknowledgment of what every design tradeoff costs.

---

## Learning Objectives

By the end of this module, you will be able to:

- Perform back-of-the-envelope capacity estimates for storage, throughput, and server count
- Identify the bottleneck layer in a system given a workload description and hardware spec
- Implement a token bucket rate limiter in Zig
- Implement a circuit breaker with three states (closed, open, half-open) in Zig
- Explain load shedding and implement priority-based request admission in Zig
- Explain consistent hashing and implement a hash ring for distributing keys across shards
- Explain the thundering herd problem and the strategies that prevent it
- Explain the hot key problem and the strategies that mitigate it
- Design a complete system given a throughput requirement, walking through each layer's contribution to the overall SLA
- Read a flame graph of a system under load and identify the next optimization target

---

## Part 1: Back-of-the-Envelope Estimation

### 1.1 Why Estimation Matters

Every design decision in a large system is constrained by numbers: how many requests per second, how much data, how many bytes per second across the network. Before you can decide whether to use a single database or a sharded cluster, whether to add a cache, or how many servers to provision, you need a sense of scale.

Back-of-the-envelope estimation is the skill of producing useful approximations quickly using known constants and logical decomposition. The goal is not precision — it is order-of-magnitude correctness that distinguishes "this fits in one machine" from "this needs a hundred machines."

### 1.2 The Latency Numbers You Must Know

These numbers should be memorized. They come from Jeff Dean's "Numbers Every Programmer Should Know," updated for current hardware:

```
Operation                              Approximate latency
─────────────────────────────────────────────────────────────
L1 cache reference                     1 ns
L2 cache reference                     4 ns
L3 cache reference                     40 ns
Main memory reference                  100 ns
Compress 1K bytes with snappy          3 µs
Send 1K bytes over 1 Gbps network      10 µs
Read 4K from SSD                       150 µs
Round trip within datacenter           500 µs (0.5 ms)
Read 1MB sequentially from memory      250 µs
Read 1MB sequentially from SSD         1 ms
Disk seek (HDD)                        10 ms
Read 1MB sequentially from HDD         20 ms
Cross-datacenter round trip            150 ms
```

The ratios matter more than the absolutes. Memory is 1000x faster than disk. SSD is 10-100x faster than HDD. Intra-datacenter network is 300x faster than cross-datacenter.

### 1.3 Throughput Constants

```
A single-core CPU can execute:
  ~1 billion simple instructions/second
  ~100 million function calls/second
  ~1 million simple HTTP requests/second (with minimal processing)
  ~100,000 database queries/second (in-memory, no disk)
  ~10,000 disk-backed database queries/second
  ~1,000 complex SQL joins/second

A single 1 Gbps network interface can carry:
  ~1 Gbps = 125 MB/s = 125,000 KB/s
  At 1KB average request: 125,000 requests/second
  At 100KB average payload: 1,250 requests/second

A single SSD can sustain:
  ~500 MB/s sequential reads
  ~100,000-500,000 IOPS random reads (4KB blocks)
  ~50,000-200,000 IOPS random writes
```

### 1.4 A Worked Example: Designing for Scale

**Problem:** Design a URL shortener for 500 million registered users. Assume 100 million new URLs shortened per day, and reads are 10x writes.

**Step 1: QPS estimation**

```
Writes:
  100M URLs/day ÷ 86,400 seconds/day ≈ 1,160 writes/second (average)
  Peak ≈ 3x average ≈ 3,500 writes/second

Reads:
  10x writes = 1,000,000 reads/day... no wait.
  10:1 read:write ratio on REQUESTS, not total.
  Reads ≈ 11,600 reads/second (average)
  Peak ≈ 35,000 reads/second
```

**Step 2: Storage estimation**

```
Per URL entry:
  Short code: 7 chars = 7 bytes
  Long URL: average 100 bytes
  Metadata: user_id(8), created_at(8), click_count(8) = 24 bytes
  Total per entry: ~140 bytes

For 5 years of data:
  100M URLs/day × 365 days × 5 years = 182.5 billion URLs... 
  Wait — that's way too many. 
  More realistic: assume 10% of users create a URL per day = 50M active users
  1 URL per active user per day × 365 days × 5 years = 91 billion... still too high.
  Let's revisit: 100M new URLs/day is the stated requirement.
  100M × 365 × 5 = 182.5 billion entries
  182.5B × 140 bytes ≈ 25.5 TB total storage for 5 years

  25.5 TB is manageable on a single high-end server, but sharding is wise for
  write throughput at 3,500 writes/second.
```

**Step 3: Cache estimation**

```
80/20 rule: 20% of URLs get 80% of reads
  20% of 100M/day = 20M "hot" URLs
  20M × 140 bytes = 2.8 GB for hot entries
  A single cache server with 32 GB RAM easily holds the hot set
  Cache hit rate should be ~80% → only 20% of reads hit the database
```

**Step 4: Server count**

```
At 35,000 peak reads/second:
  If 80% served by cache: 7,000 reads/second to database
  A single database server handles ~10,000 simple reads/second
  → 1 database server handles the read load (with headroom)
  
  For writes at 3,500/second:
  Each write is a disk operation + cache invalidation
  A single database server handles ~5,000-10,000 writes/second on SSD
  → 1-2 database servers handle writes

  Application servers:
  Each request involves: parse URL + cache lookup + (maybe) DB + serialize response
  At 1ms processing time per request, 1 server handles 1,000 req/second
  At 35,000 peak: need ~35 app servers (or fewer with async event loop)
  With async event loop (Module 11 pattern): 1 server handles ~50,000 req/second
  → 1-2 app servers with async I/O
```

**Step 5: The actual bottleneck**

The estimation reveals: the bottleneck is not the application servers (async I/O handles the load easily) or the cache (fits in memory). The bottleneck is **write throughput to the database** and **URL ID generation** (you need globally unique short codes without collisions).

This shapes the design: prioritize write scalability, use a dedicated ID generation service, shard the database by short code prefix.

```zig
/// Back-of-the-envelope calculator — useful for quick estimates in code comments
pub const Estimate = struct {
    /// Estimate QPS given daily requests and peak multiplier
    pub fn qps(daily_requests: f64, peak_multiplier: f64) f64 {
        const average = daily_requests / 86_400.0;
        return average * peak_multiplier;
    }

    /// Estimate storage given items, bytes per item, and years
    pub fn storage_bytes(items_per_day: f64, bytes_per_item: f64, years: f64) f64 {
        return items_per_day * 365.0 * years * bytes_per_item;
    }

    /// Number of app servers needed given QPS and capacity per server
    pub fn server_count(peak_qps: f64, capacity_per_server: f64) u32 {
        return @intFromFloat(@ceil(peak_qps / capacity_per_server * 1.3)); // 30% headroom
    }

    pub fn format_bytes(bytes: f64) []const u8 {
        if (bytes < 1024) return "bytes";
        if (bytes < 1024 * 1024) return "KB";
        if (bytes < 1024 * 1024 * 1024) return "MB";
        if (bytes < 1024.0 * 1024 * 1024 * 1024) return "GB";
        return "TB";
    }
};
```

---

## Part 2: Identifying the Bottleneck

### 2.1 The Four Bottleneck Layers

Every system has exactly one current bottleneck — the resource that limits throughput when under load. Optimizing anything else is waste. The four layers where bottlenecks typically live:

**CPU:** The processing power to execute code. Symptoms: high CPU utilization, low I/O wait, instructions per second near hardware maximum. Fix: optimize hot code paths (Module 10 flame graphs), parallelize with more cores, reduce per-request work.

**Memory:** RAM for in-process data. Symptoms: high memory utilization, GC pressure (in managed runtimes), allocator contention (Module 4), cache evictions. Fix: reduce allocation rate, improve data density, add RAM, shard to distribute the working set.

**I/O:** Network or disk throughput or IOPS. Symptoms: high I/O wait, network saturation (check with `sar -n DEV 1`), disk queue depth > 1 (check with `iostat -x 1`). Fix: batch I/O, use async I/O (Module 11), add SSDs, use caching to reduce I/O.

**Locks/Serialization:** A contended resource that serializes concurrent requests. Symptoms: many threads blocked, low CPU despite high load, latency proportional to concurrency. Fix: reduce critical section size, use lock-free algorithms (Module 8), shard the contended resource.

### 2.2 The USE Method Applied at System Scale

From Module 10: for each resource, measure Utilization, Saturation, Errors. At system scale, the resources expand:

```bash
# CPU
mpstat -P ALL 1
# Look for: usr+sys > 80% on any core (utilization)
#           run queue length > 2*cpu_count (saturation)

# Memory
free -m; cat /proc/meminfo | grep -E "MemAvailable|SwapUsed"
# Look for: MemAvailable < 10% total (utilization)
#           SwapUsed > 0 (saturation — swap is disk-speed memory)

# Disk I/O
iostat -xz 1
# Look for: %util > 80% (utilization)
#           await > 10ms for SSD, > 30ms for HDD (saturation showing as latency)

# Network
sar -n DEV 1
# Look for: rxkB/s or txkB/s near interface capacity (utilization)
#           dropped packets (saturation/errors)

# Application-level
# Measure: request queue depth, active connection count, p99 latency
# Use your benchmarking tools from Module 10
```

### 2.3 Little's Law

**Little's Law:** N = λ × W

Where:
- N = average number of items in the system (queue + in-service)
- λ = average arrival rate (requests per second)
- W = average time an item spends in the system (seconds)

This is the fundamental law of queuing theory. It tells you the relationship between throughput, latency, and concurrency in any stable system.

**Example:** Your server has p50 latency of 50ms at 1,000 req/s:
```
N = 1,000 × 0.050 = 50 concurrent requests in-flight at any moment
```

If your thread pool has 100 threads and 50 are always in-flight, you have 50 idle threads — no problem. If your connection pool has 40 connections, you are going to have queueing at the pool (40 < 50 needed). Little's Law instantly tells you when a resource pool is undersized.

**At saturation:** As load increases toward system capacity, W (latency) increases — queuing adds time. As W increases, N increases (more requests in-flight). The system enters a feedback loop where high latency causes high N which causes higher latency. This is the onset of the "hockey stick" in latency graphs.

---

> **Exercise 18.1: Capacity Estimation**
>
> Design a distributed rate limiter for an API gateway serving 100 million users. The rate limit is 100 requests per minute per user. The system must:
> 1. Handle 10,000 peak API requests/second globally
> 2. Be accurate to within 5% (allow slightly more than 100/min or slightly less, but not more than 5% error)
> 3. Survive the failure of any single node
> 4. Add < 1ms to API response latency
>
> Estimate:
> - How many users will be "active" at any moment (sending at least one request)
> - How much state the rate limiter must maintain (bytes per user × active users)
> - Whether a single server can hold that state in memory
> - How many rate limiter servers you need given the throughput requirement
>
> Then design the data structure (hint: sliding window log vs token bucket vs fixed window counter), the sharding strategy (hint: consistent hashing on user_id), and the failure handling (hint: what happens to a rate limiter node during failover?).

---

## Part 3: Rate Limiting

### 3.1 Why Rate Limiting Exists

Rate limiting protects a service from being overwhelmed by any single client (intentional abuse or unintentional traffic storms) and ensures fair sharing of resources across clients. Without it, a single misbehaving client can degrade service for all others.

Rate limiting also provides **admission control**: a signal to clients about system capacity. A `429 Too Many Requests` response tells the client to back off — this is far better than silently queuing requests until the system collapses.

### 3.2 Algorithms

**Fixed window counter:** Count requests in fixed time windows (e.g., the current minute). Simple but allows burst attacks at window boundaries — a client can send 100 requests at 11:59:59 and 100 more at 12:00:00, sending 200 in 2 seconds.

**Sliding window log:** Store the timestamp of each request. Count requests within the rolling window. Accurate but memory-intensive — O(requests) per user.

**Sliding window counter:** Approximate the sliding window using two fixed-window counters:
```
rate = current_window_count + previous_window_count × (1 - elapsed_fraction)
```
Memory-efficient (O(1) per user), accuracy within ~1%.

**Token bucket:** The most production-appropriate algorithm. A bucket holds tokens (capacity = burst size). Tokens accrue at the rate limit. Each request consumes one token. If the bucket is empty, reject. Allows bursts up to the bucket capacity, then smoothly limits to the rate.

**Leaky bucket:** Requests enter a queue (the "bucket"). Requests drip out at a fixed rate. Excess requests are dropped. Smooths bursty traffic but adds latency (queuing delay). Good for rate-smoothing; less good for rejection.

### 3.3 Token Bucket Implementation

```zig
const std = @import("std");
const atomic = std.atomic;

/// A token bucket rate limiter.
/// Thread-safe. Allows bursts up to capacity, then limits to rate_per_sec.
pub const TokenBucket = struct {
    /// Maximum tokens (burst capacity)
    capacity: f64,
    /// Token accrual rate (tokens per second)
    rate_per_sec: f64,
    /// Current token count
    tokens: f64,
    /// Last time tokens were added
    last_refill_ns: i64,
    /// Mutex for thread safety
    mu: std.Thread.Mutex,

    pub fn init(capacity: f64, rate_per_sec: f64) TokenBucket {
        return .{
            .capacity = capacity,
            .rate_per_sec = rate_per_sec,
            .tokens = capacity, // start full
            .last_refill_ns = std.time.nanoTimestamp(),
            .mu = .{},
        };
    }

    /// Try to consume n tokens. Returns true if allowed, false if rate limited.
    pub fn try_consume(self: *TokenBucket, n: f64) bool {
        self.mu.lock();
        defer self.mu.unlock();

        // Refill tokens based on elapsed time
        const now_ns = std.time.nanoTimestamp();
        const elapsed_sec = @as(f64, @floatFromInt(now_ns - self.last_refill_ns))
                            / 1_000_000_000.0;
        self.tokens = @min(self.capacity,
                           self.tokens + elapsed_sec * self.rate_per_sec);
        self.last_refill_ns = now_ns;

        // Check if we have enough tokens
        if (self.tokens >= n) {
            self.tokens -= n;
            return true; // allowed
        }
        return false; // rate limited
    }

    /// Time until n tokens are available (for retry-after header)
    pub fn time_until_available_ms(self: *TokenBucket, n: f64) u64 {
        self.mu.lock();
        defer self.mu.unlock();
        const deficit = n - self.tokens;
        if (deficit <= 0) return 0;
        const wait_sec = deficit / self.rate_per_sec;
        return @intFromFloat(wait_sec * 1000.0);
    }
};

/// Per-user rate limiter: one token bucket per user
pub const RateLimiter = struct {
    buckets: std.AutoHashMap(u64, TokenBucket),
    mu: std.Thread.Mutex,
    /// Per-user capacity (burst size)
    capacity: f64,
    /// Per-user rate (requests per second)
    rate: f64,
    allocator: std.mem.Allocator,

    pub fn init(capacity: f64, rate: f64, allocator: std.mem.Allocator) RateLimiter {
        return .{
            .buckets = std.AutoHashMap(u64, TokenBucket).init(allocator),
            .mu = .{},
            .capacity = capacity,
            .rate = rate,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *RateLimiter) void {
        self.buckets.deinit();
    }

    /// Check if user_id is within their rate limit.
    /// Returns true if allowed, false if rate limited.
    pub fn check(self: *RateLimiter, user_id: u64) !bool {
        self.mu.lock();
        const result = try self.buckets.getOrPut(user_id);
        if (!result.found_existing) {
            result.value_ptr.* = TokenBucket.init(self.capacity, self.rate);
        }
        self.mu.unlock();

        return result.value_ptr.try_consume(1.0);
    }
};

/// Demonstrate rate limiting behavior
pub fn demonstrate_rate_limiter() !void {
    // 10 tokens capacity, 5 tokens/second refill rate
    var limiter = TokenBucket.init(10.0, 5.0);

    // Burst: consume 10 tokens immediately
    for (0..12) |i| {
        const allowed = limiter.try_consume(1.0);
        std.debug.print("Request {d:2}: {s}\n", .{
            i + 1,
            if (allowed) "ALLOWED" else "RATE LIMITED",
        });
    }
    // First 10: allowed (burst capacity)
    // 11, 12: rate limited (bucket empty)

    // Wait 400ms: 5 tok/sec × 0.4s = 2 tokens refilled
    std.time.sleep(400_000_000);
    std.debug.print("After 400ms:\n", .{});
    for (0..3) |i| {
        const allowed = limiter.try_consume(1.0);
        std.debug.print("Request {d}: {s}\n", .{
            i + 1,
            if (allowed) "ALLOWED" else "RATE LIMITED",
        });
    }
    // Requests 1, 2: allowed (2 tokens refilled)
    // Request 3: rate limited
}
```

---

## Part 4: Circuit Breakers

### 4.1 The Problem of Cascading Failure

A service calls a dependency. The dependency becomes slow. The service's threads pile up waiting. Thread pool exhausts. The service itself becomes slow. Its callers pile up. The slowness cascades upstream until the entire system is down.

This is **cascading failure** — one slow dependency taking down an entire call graph. It is one of the most common causes of large-scale outages.

The **circuit breaker** pattern prevents cascading failure. Like an electrical circuit breaker, it detects overload and cuts the connection — fast-failing requests instead of letting them pile up waiting for a slow dependency.

### 4.2 The Three States

```
                 failure rate > threshold
┌─────────┐     (or consecutive failures)     ┌──────────┐
│ CLOSED  │ ────────────────────────────────► │  OPEN    │
│         │                                   │          │
│ Requests│                                   │ Requests │
│ pass    │                                   │ rejected │
│ through │ ◄──────────────────────────────── │ immediately│
└─────────┘      success in HALF-OPEN         └──────────┘
                 (or manual reset)                  │
                                                    │ timeout expires
                                                    ▼
                                              ┌──────────┐
                                              │HALF-OPEN │
                                              │          │
                                              │ One probe│
                                              │ request  │
                                              │ allowed  │
                                              └──────────┘
```

**Closed:** Normal operation. Requests pass through to the dependency. Failures are counted.

**Open:** Dependency is unhealthy. All requests fail immediately (no waiting). After a timeout, transitions to Half-Open.

**Half-Open:** One probe request allowed through. If it succeeds: Closed. If it fails: back to Open.

```zig
const std = @import("std");
const atomic = std.atomic;

pub const CircuitState = enum { closed, open, half_open };

pub const CircuitBreaker = struct {
    state: atomic.Value(CircuitState),
    /// Consecutive failures needed to open
    failure_threshold: u32,
    /// Time to wait in OPEN before trying HALF_OPEN (milliseconds)
    timeout_ms: u64,
    /// Rolling window of recent results
    consecutive_failures: atomic.Value(u32),
    consecutive_successes: atomic.Value(u32),
    /// When the circuit opened (for timeout calculation)
    opened_at_ms: atomic.Value(u64),
    /// Minimum successes in HALF_OPEN to close
    success_threshold: u32,
    mu: std.Thread.Mutex,

    pub fn init(failure_threshold: u32, timeout_ms: u64,
                success_threshold: u32) CircuitBreaker {
        return .{
            .state = atomic.Value(CircuitState).init(.closed),
            .failure_threshold = failure_threshold,
            .timeout_ms = timeout_ms,
            .consecutive_failures = atomic.Value(u32).init(0),
            .consecutive_successes = atomic.Value(u32).init(0),
            .opened_at_ms = atomic.Value(u64).init(0),
            .success_threshold = success_threshold,
            .mu = .{},
        };
    }

    fn now_ms() u64 {
        return @as(u64, @intCast(std.time.milliTimestamp()));
    }

    /// Returns true if the request should be allowed through.
    pub fn allow_request(self: *CircuitBreaker) bool {
        const current_state = self.state.load(.acquire);

        switch (current_state) {
            .closed => return true,

            .open => {
                // Check if timeout has elapsed
                const opened_at = self.opened_at_ms.load(.monotonic);
                if (now_ms() - opened_at >= self.timeout_ms) {
                    // Transition to HALF_OPEN: allow one probe
                    self.mu.lock();
                    defer self.mu.unlock();
                    if (self.state.load(.monotonic) == .open) {
                        self.state.store(.half_open, .release);
                        self.consecutive_successes.store(0, .monotonic);
                        std.debug.print("Circuit HALF_OPEN: probing dependency\n", .{});
                        return true; // the probe request
                    }
                }
                return false; // still open
            },

            .half_open => {
                // Only one request allowed through in half-open
                // (subsequent requests are rejected while probing)
                return false;
            },
        }
    }

    /// Record the result of a request that was allowed through.
    pub fn record_result(self: *CircuitBreaker, success: bool) void {
        self.mu.lock();
        defer self.mu.unlock();

        const current_state = self.state.load(.monotonic);

        if (success) {
            _ = self.consecutive_failures.store(0, .monotonic);
            const successes = self.consecutive_successes.fetchAdd(1, .monotonic) + 1;

            if (current_state == .half_open and successes >= self.success_threshold) {
                self.state.store(.closed, .release);
                self.consecutive_successes.store(0, .monotonic);
                std.debug.print("Circuit CLOSED: dependency recovered\n", .{});
            }
        } else {
            _ = self.consecutive_successes.store(0, .monotonic);
            const failures = self.consecutive_failures.fetchAdd(1, .monotonic) + 1;

            if (current_state == .half_open or
                (current_state == .closed and failures >= self.failure_threshold))
            {
                self.state.store(.open, .release);
                self.opened_at_ms.store(now_ms(), .monotonic);
                self.consecutive_failures.store(0, .monotonic);
                std.debug.print("Circuit OPEN: dependency unhealthy\n", .{});
            }
        }
    }

    pub fn current_state(self: *const CircuitBreaker) CircuitState {
        return self.state.load(.acquire);
    }
};

/// Call a dependency through a circuit breaker
pub fn protected_call(
    breaker: *CircuitBreaker,
    call_fn: *const fn () anyerror!void,
) !void {
    if (!breaker.allow_request()) {
        return error.CircuitOpen; // fast fail
    }

    call_fn() catch |err| {
        breaker.record_result(false);
        return err;
    };

    breaker.record_result(true);
}
```

---

## Part 5: Load Shedding

### 5.1 Why Load Shedding Is Necessary

Rate limiting controls individual clients. Circuit breakers protect against bad dependencies. But what happens when the system itself is overloaded — when inbound request rate legitimately exceeds processing capacity?

Without load shedding: requests queue indefinitely. Latency grows without bound. Memory exhausts (the queue itself uses memory). Eventually the system crashes.

With load shedding: the system rejects excess requests immediately with a clear error. The remaining requests are served at normal latency. The system remains stable and predictable.

**Load shedding is not failure.** It is controlled failure — the system choosing which requests to drop rather than letting the overload propagate unpredictably.

### 5.2 Priority-Based Admission

Not all requests are equal. A payment API call is more important than a feed refresh. Shedding should drop low-priority requests first.

```zig
const std = @import("std");
const atomic = std.atomic;

pub const RequestPriority = enum(u8) {
    critical = 0,   // health checks, admin ops — never shed
    high     = 1,   // user-facing, payment critical
    normal   = 2,   // standard API requests
    low      = 3,   // background jobs, analytics
    bulk     = 4,   // batch operations — shed first
};

pub const AdmissionController = struct {
    /// Current in-flight request count per priority
    in_flight: [5]atomic.Value(u32),
    /// Maximum in-flight per priority (capacity allocation)
    max_in_flight: [5]u32,
    /// Total system capacity (across all priorities)
    total_capacity: u32,
    /// Current total in-flight
    total_in_flight: atomic.Value(u32),

    pub fn init(total_capacity: u32) AdmissionController {
        // Allocate capacity by priority: critical gets guaranteed slots,
        // others share remaining capacity with priority order
        return .{
            .in_flight = [_]atomic.Value(u32){atomic.Value(u32).init(0)} ** 5,
            .max_in_flight = .{
                @min(total_capacity, 10),              // critical: 10 or total
                total_capacity * 30 / 100,             // high: 30%
                total_capacity * 40 / 100,             // normal: 40%
                total_capacity * 20 / 100,             // low: 20%
                total_capacity * 10 / 100,             // bulk: 10%
            },
            .total_capacity = total_capacity,
            .total_in_flight = atomic.Value(u32).init(0),
        };
    }

    /// Returns true if this request is admitted, false if shed.
    pub fn admit(self: *AdmissionController, priority: RequestPriority) bool {
        const p = @intFromEnum(priority);

        // Check total capacity first
        const total = self.total_in_flight.load(.monotonic);
        if (total >= self.total_capacity) {
            // At total capacity: only admit critical
            if (priority != .critical) return false;
        }

        // Check priority-specific capacity
        const current = self.in_flight[p].load(.monotonic);
        if (current >= self.max_in_flight[p]) {
            // Priority bucket full: shed unless critical
            if (priority != .critical) return false;
        }

        // Admit: increment counters
        _ = self.in_flight[p].fetchAdd(1, .monotonic);
        _ = self.total_in_flight.fetchAdd(1, .monotonic);
        return true;
    }

    /// Call when a request completes (success or error)
    pub fn release(self: *AdmissionController, priority: RequestPriority) void {
        const p = @intFromEnum(priority);
        _ = self.in_flight[p].fetchSub(1, .monotonic);
        _ = self.total_in_flight.fetchSub(1, .monotonic);
    }

    pub fn utilization(self: *const AdmissionController) f64 {
        const total = self.total_in_flight.load(.monotonic);
        return @as(f64, @floatFromInt(total)) /
               @as(f64, @floatFromInt(self.total_capacity));
    }
};
```

### 5.3 The Thundering Herd

The **thundering herd** problem occurs when many clients simultaneously try to do the same thing — typically after a brief outage or cache flush:

1. Cache expires (or is flushed)
2. 10,000 concurrent requests all miss the cache simultaneously
3. All 10,000 try to recompute the cached value from the database
4. Database is overwhelmed by 10,000 identical expensive queries
5. System falls over

Mitigation strategies:

**Mutex/singleflight:** When a cache miss occurs, only one goroutine/thread fetches the value. All others wait for the first to complete and return the same result.

```zig
pub const SingleFlight = struct {
    pending: std.StringHashMap(PendingFlight),
    mu: std.Thread.Mutex,
    allocator: std.mem.Allocator,

    const PendingFlight = struct {
        result: ?[]const u8,
        err: ?anyerror,
        done: bool,
        waiters: u32,
        cond: std.Thread.Condition,
        cond_mu: std.Thread.Mutex,
    };

    pub fn init(allocator: std.mem.Allocator) SingleFlight {
        return .{
            .pending = std.StringHashMap(PendingFlight).init(allocator),
            .mu = .{},
            .allocator = allocator,
        };
    }

    /// Call fetch_fn for key, but only once even if called concurrently.
    /// All concurrent callers receive the same result.
    pub fn do(self: *SingleFlight, key: []const u8,
              fetch_fn: *const fn () anyerror![]const u8) ![]const u8 {
        self.mu.lock();
        const entry = try self.pending.getOrPut(key);

        if (entry.found_existing) {
            // Another caller is already fetching: wait for it
            entry.value_ptr.waiters += 1;
            const cond = &entry.value_ptr.cond;
            const cond_mu = &entry.value_ptr.cond_mu;
            self.mu.unlock();

            cond_mu.lock();
            while (!entry.value_ptr.done) {
                cond.wait(cond_mu);
            }
            cond_mu.unlock();

            if (entry.value_ptr.err) |err| return err;
            return entry.value_ptr.result.?;
        }

        // We are the "leader": fetch the value
        entry.value_ptr.* = .{
            .result = null,
            .err = null,
            .done = false,
            .waiters = 0,
            .cond = .{},
            .cond_mu = .{},
        };
        self.mu.unlock();

        // Do the fetch
        const result = fetch_fn() catch |err| {
            entry.value_ptr.err = err;
            entry.value_ptr.done = true;
            entry.value_ptr.cond.broadcast();
            return err;
        };

        entry.value_ptr.result = result;
        entry.value_ptr.done = true;
        entry.value_ptr.cond.broadcast();

        return result;
    }
};
```

**Jittered expiry:** Instead of all cache entries expiring at the same time, add random jitter to TTLs. This staggers cache misses and prevents synchronized stampedes.

**Probabilistic early refresh:** Before a cache entry expires, with some probability p, refresh it proactively while still serving the cached value. This eliminates the expiry moment entirely.

---

## Part 6: Consistent Hashing

### 6.1 The Problem with Naive Sharding

Naive sharding: `shard_id = hash(key) % num_shards`. Simple and efficient. But when you add or remove a shard, almost every key remaps to a different shard. Adding one shard to a 10-shard cluster moves 90% of keys. During rebalancing, you must move 90% of your data.

**Consistent hashing** solves this: when you add or remove a node, only `1/N` of keys move, where N is the number of nodes.

### 6.2 The Hash Ring

Map nodes to positions on a circle (the hash ring) using their hash. To find the shard for a key: hash the key to a position on the ring, then walk clockwise until you hit a node.

```zig
const std = @import("std");

pub const HashRing = struct {
    /// Virtual nodes sorted by hash value
    /// (each physical node has multiple virtual nodes for better distribution)
    vnodes: std.ArrayList(VNode),
    allocator: std.mem.Allocator,

    const VNode = struct {
        hash: u64,
        node_id: u32,
    };

    const VIRTUAL_NODES_PER_PHYSICAL = 150;

    pub fn init(allocator: std.mem.Allocator) HashRing {
        return .{ .vnodes = std.ArrayList(VNode).init(allocator),
                  .allocator = allocator };
    }

    pub fn deinit(self: *HashRing) void { self.vnodes.deinit(); }

    pub fn add_node(self: *HashRing, node_id: u32) !void {
        for (0..VIRTUAL_NODES_PER_PHYSICAL) |i| {
            var buf: [32]u8 = undefined;
            const key = try std.fmt.bufPrint(&buf, "node-{d}-vnode-{d}", .{node_id, i});
            const hash = fnv1a_hash(key);
            try self.vnodes.append(.{ .hash = hash, .node_id = node_id });
        }
        // Keep sorted for binary search
        std.mem.sort(VNode, self.vnodes.items, {}, struct {
            fn lt(_: void, a: VNode, b: VNode) bool { return a.hash < b.hash; }
        }.lt);
    }

    pub fn remove_node(self: *HashRing, node_id: u32) void {
        var i: usize = 0;
        while (i < self.vnodes.items.len) {
            if (self.vnodes.items[i].node_id == node_id) {
                _ = self.vnodes.orderedRemove(i);
            } else {
                i += 1;
            }
        }
    }

    /// Find which node is responsible for the given key
    pub fn get_node(self: *const HashRing, key: []const u8) ?u32 {
        if (self.vnodes.items.len == 0) return null;

        const hash = fnv1a_hash(key);

        // Binary search for the first vnode with hash >= key_hash
        var lo: usize = 0;
        var hi = self.vnodes.items.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            if (self.vnodes.items[mid].hash < hash) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        // Wrap around (the ring)
        const idx = lo % self.vnodes.items.len;
        return self.vnodes.items[idx].node_id;
    }

    /// For replication: get the N nodes responsible for a key
    pub fn get_nodes(self: *const HashRing, key: []const u8, n: usize,
                     nodes: []u32) usize {
        if (self.vnodes.items.len == 0) return 0;

        const hash = fnv1a_hash(key);
        var lo: usize = 0;
        var hi = self.vnodes.items.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            if (self.vnodes.items[mid].hash < hash) lo = mid + 1
            else hi = mid;
        }

        var count: usize = 0;
        var seen = std.AutoHashMap(u32, void).init(self.allocator);
        defer seen.deinit();

        var idx = lo % self.vnodes.items.len;
        while (count < n and count < self.vnodes.items.len) {
            const node_id = self.vnodes.items[idx].node_id;
            if (!seen.contains(node_id)) {
                seen.put(node_id, {}) catch break;
                nodes[count] = node_id;
                count += 1;
            }
            idx = (idx + 1) % self.vnodes.items.len;
        }

        return count;
    }

    fn fnv1a_hash(data: []const u8) u64 {
        var hash: u64 = 14695981039346656037;
        for (data) |b| {
            hash ^= b;
            hash *%= 1099511628211;
        }
        return hash;
    }
};
```

### 6.3 Hot Keys

Consistent hashing distributes keys evenly on average — but some keys are hot. A key that receives 10,000 requests per second overwhelms a single shard node regardless of how well the ring is balanced.

**Hot key mitigations:**

**Local caching:** Cache hot keys in-process on every application server. Reads never reach the storage tier for cached keys.

**Replication + read spreading:** Replicate hot keys to multiple nodes. Route reads to any replica (using random or round-robin selection among replicas for that key).

**Key splitting:** For a counter at key "popular_post:views", instead of one counter, maintain "popular_post:views:0" through "popular_post:views:N" — one per application server. To read the total, sum all. Writes are distributed. This is a partial CRDT (similar to the G-Counter from Module 17).

**Jitter in key naming:** For keys derived from popular content, add a suffix: "hot_key:0" through "hot_key:9". Hash each individually to distribute load.

---

## Part 7: The Complete Design Process

### 7.1 A Framework for Systems Design

Given a vague requirement, the following process produces a defensible, concrete design:

**Step 1: Clarify requirements (5 minutes)**
- Functional: what operations must the system support?
- Non-functional: what are the latency SLAs? Availability targets? Consistency requirements?
- Scale: read-heavy or write-heavy? How much data? Peak vs average?
- Constraints: geography (one data center vs multi-region)? Cost?

**Step 2: Estimate capacity (5 minutes)**
- QPS: average and peak
- Data size: storage per item × number of items × retention period
- Bandwidth: bytes per request × QPS
- Servers needed: QPS / capacity per server

**Step 3: High-level design (10 minutes)**
- Draw the main components: clients, load balancer, app servers, cache, database, queue
- Data flow for the primary read and write paths
- Identify where the bottleneck is given your estimates

**Step 4: Deep dive (20 minutes)**
- The data model: how is data structured and where is it stored?
- The primary operations in detail
- The failure modes: what happens if the database is down? Cache is cleared? A server crashes?
- Consistency and availability tradeoffs: what level do you need, and what does that cost?

**Step 5: Scale and edge cases (5 minutes)**
- How does the design handle 10x load?
- Hot keys, hot partitions
- Slow nodes, partial failures

### 7.2 Worked Example: Distributed Rate Limiter

Let's apply the framework to the exercise from Part 1.

**Requirements:**
- 100 million users, rate limit = 100 req/min per user
- 10,000 peak API requests/second
- < 1ms added latency
- Survive single node failure

**Capacity estimate:**
```
Active users at any moment:
  Assume 1% of users active = 1 million active users
  Each has a token bucket: capacity=100, refill=100/60 per second
  State per user: current_tokens(8) + last_refill_ts(8) = 16 bytes
  Total state: 1M × 16 bytes = 16 MB — fits in one server's RAM easily

Throughput: 10,000 QPS
  Each check: hash(user_id) → look up bucket → compare → update
  In-memory hash map lookup: ~100ns per operation
  → 1 server handles 10M ops/second
  → 1 rate limiter server handles 10,000 QPS easily
  But: 1 server is a single point of failure
  → 3 servers with consistent hashing: any one failure, others handle load
```

**Design:**
- 3 rate limiter nodes, each responsible for 1/3 of users via consistent hashing
- Each app server determines the rate limiter node via consistent hashing on user_id
- Rate limiter node holds token bucket state in memory (HashMap<user_id, TokenBucket>)
- On check: update token bucket, return allowed/rejected
- Failure handling: if rate limiter node is unreachable within 1ms, **allow the request** (fail open, not fail closed — availability > strict accuracy during failures)

**Data model:**
```zig
const UserBucket = struct {
    tokens: f32,
    last_refill_ms: u64,
};
// HashMap<u64 user_id, UserBucket> per rate limiter node
// No persistence: restart with full buckets (conservative, slightly allows burst after restart)
```

**Failure handling:**
- App server detects rate limiter timeout (> 0.5ms) via circuit breaker
- Circuit breaker opens → fail open (allow all requests)
- Circuit breaker closes when rate limiter recovers
- Trade-off: brief period of no rate limiting during failure vs requests being blocked

---

## Part 8: The Module Project — Load-Tested Distributed System

### Project Specification

Take the RaftKV system from Module 16/17 and make it production-quality under load. Add all the safety mechanisms from this module, then load test and tune it.

### Additions

**1. Rate limiting per client:**
Implement a token bucket rate limiter that limits each client to 10,000 req/second. Rate limiter state is stored in-process on the leader.

**2. Circuit breakers for follower reads:**
When a leader routes linearizable reads to followers (as an optimization), wrap each follower call in a circuit breaker. If a follower is slow, fail over to the leader.

**3. Load shedding:**
Implement priority-based admission control:
- `PING`, `INFO`, `COMMAND`: critical (never shed)
- `GET`: high priority
- `SET`, `DEL`: normal priority
- `KEYS`, `SCAN`: low priority (shed first under load)

**4. Consistent hashing for multi-node deployment:**
When running a cluster of RaftKV nodes (multiple Raft groups, each handling a subset of keys), use a hash ring to route client requests to the correct Raft group.

### Load Test

```bash
# Compile in ReleaseFast
zig build -Doptimize=ReleaseFast

# Run the cluster
./raftkv --id 0 --port 7380 --peers 1,2 &
./raftkv --id 1 --port 7381 --peers 0,2 &
./raftkv --id 2 --port 7382 --peers 0,1 &

# Load test with redis-benchmark
redis-benchmark -p 7380 -c 100 -n 1000000 -t set,get --pipeline 10

# Observe under load
watch -n 1 'redis-cli -p 7380 INFO server | grep -E "connected_clients|ops_per_sec"'

# Flame graph during load test
perf record -F 99 -g -p $(pgrep raftkv) sleep 30
perf script | stackcollapse-perf.pl | flamegraph.pl > raftkv-load.svg
```

### Acceptance Criteria

Under 10,000 req/second sustained load:
- p50 latency < 5ms
- p99 latency < 20ms
- Zero crashes or data loss
- Rate limiter correctly rejects traffic above 10,000 req/second per node
- Circuit breaker correctly fast-fails requests when a follower is killed

### The Final Flame Graph

Generate a flame graph under load. Annotate it identifying:
1. The hottest function (where most CPU time goes)
2. The next optimization target if you needed to double throughput
3. Whether the bottleneck is CPU, I/O, or lock contention

This annotated flame graph is the deliverable that proves you can read a production system's performance profile and reason about it correctly.

---

## Summary

Systems design under load is the discipline of translating vague requirements into concrete, justified architectures that remain stable under real-world conditions.

**Back-of-the-envelope estimation** produces order-of-magnitude numbers that determine which design choices are viable. The key constants — latency numbers, throughput per server, storage costs — must be internalized, not looked up.

**Identifying the bottleneck** — CPU, memory, I/O, or serialization — must precede any optimization effort. Optimizing the wrong layer produces no improvement. The USE Method applied at system scale, combined with Little's Law for understanding queuing behavior, provides the systematic approach.

**Rate limiting** protects the system from individual abusive or misbehaving clients. The token bucket algorithm is the right default: allows short bursts, then smoothly limits to the configured rate, with O(1) state per user.

**Circuit breakers** prevent cascading failure. A dependency that is slow or unreliable should be fast-failed rather than allowed to consume thread pool capacity and propagate latency upstream. The three-state state machine (closed → open → half-open) is the standard implementation.

**Load shedding** keeps the system stable when inbound load exceeds processing capacity. Priority-based admission ensures that critical operations succeed even when the system is overloaded. The alternative — unlimited queuing — leads to unbounded latency growth and eventual crash.

**Consistent hashing** distributes keys across shards with minimal movement when nodes are added or removed. Virtual nodes ensure even distribution. Hot keys require additional mitigation: local caching, read spreading, or key splitting.

---

## What's Next

The Final Capstone — A Distributed Key-Value Store — assembles everything you have built across all 18 modules into a single, complete, production-quality system. You will build ZigKV: a distributed key-value store that implements the full stack from the custom binary protocol through Raft consensus to MVCC transactions, with production safety mechanisms and end-to-end load testing.

---

## Reference: Numbers Every Systems Programmer Should Know

```
Latency:
  L1 cache:        ~1 ns        L2 cache:           ~4 ns
  L3 cache:        ~40 ns       Main memory:        ~100 ns
  SSD 4K read:     ~150 µs      HDD seek:           ~10 ms
  Intra-DC RTT:    ~500 µs      Cross-DC RTT:       ~150 ms

Throughput (single server, rough):
  CPU:             1B instructions/core/sec
  Memory:          ~50 GB/s bandwidth
  Network:         125 MB/s per 1 Gbps interface
  SSD:             500 MB/s sequential, 100K-500K IOPS random
  HDD:             100 MB/s sequential, 100-200 IOPS random

Rules of thumb:
  80/20 rule:      20% of keys receive 80% of traffic
  Peak = 3x avg:   design for 3x your average load
  Read/write ratio: most systems are 10:1 read-heavy
  Cache hit rate:  aim for >90% in-memory cache hit rate
  Server headroom: provision 30% spare capacity for spikes

Little's Law:
  N = λ × W
  (in-flight requests) = (arrival rate) × (average latency)
  Use to size thread pools, connection pools, queue capacities

Availability:
  99%:     87.6 hours downtime/year
  99.9%:   8.76 hours downtime/year ("three nines")
  99.99%:  52.6 minutes downtime/year ("four nines")
  99.999%: 5.26 minutes downtime/year ("five nines")
```

---

*End of Module 18*
