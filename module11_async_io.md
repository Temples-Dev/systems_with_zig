# Module 11: Asynchronous I/O

## The Craft of Systems Programming — Teaching Material

---

> *"The question is never whether to block. It's who should block, for how long, and at whose expense."*

---

## Before You Begin

Module 8 taught concurrency within a single process — threads, mutexes, atomics. Module 9 covered file systems and persistence. Module 10 covered performance measurement. This module brings those threads together around one of the most consequential problems in high-performance systems: how to handle many I/O operations simultaneously without paying the cost of a thread for each one.

The problem is straightforward. A network server receives connections. Each connection blocks the thread handling it while waiting for data. With one thread per connection, a server handling 10,000 simultaneous clients needs 10,000 threads. Each thread uses at minimum 8MB of stack space — that is 80GB of memory just for stacks. Context-switching between 10,000 threads burns CPU time the server could spend doing real work. This model does not scale.

The alternative — the model used by every high-performance server from nginx to Redis to Node.js — is asynchronous I/O: a single thread monitors many file descriptors simultaneously, reacting to whichever becomes ready rather than blocking on any one of them.

This module traces the complete evolution of async I/O on Linux: from the broken original approach (`select`/`poll`), to the scalable readiness-based model (`epoll`), to the completion-based revolution (`io_uring`), to Zig 0.16.0's new `std.Io` interface that unifies all of these behind a single abstraction without function coloring.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain why blocking I/O does not scale to many concurrent connections
- Explain the difference between readiness-based and completion-based I/O models
- Implement a non-blocking server using `epoll` directly via Linux system calls
- Explain how `io_uring` works: submission queues, completion queues, and the ring buffer design
- Use `io_uring` via Zig's `std.os.linux` for high-performance file and network I/O
- Use Zig 0.16.0's `std.Io` interface for portable async I/O
- Use `std.Io.async`, `Future.await`, and `std.Io.Group` to express concurrent operations
- Distinguish between `std.Io.Threaded` and `std.Io.Evented` and know when to use each
- Implement a timer wheel for managing I/O timeouts
- Measure the throughput and latency difference between blocking, epoll, and io_uring I/O

---

## Part 1: Why Blocking I/O Doesn't Scale

### 1.1 The Thread-Per-Connection Model

The simplest server design: one thread per connection. A thread calls `accept()`, gets a connection, reads the request, writes the response, and loops. When the thread blocks on `read()` waiting for the client to send data, the OS context-switches to another thread. Simple to reason about. Disastrously expensive at scale.

```zig
const std = @import("std");
const linux = std.os.linux;

// SIMPLE BUT UNSCALABLE: one thread per connection
fn handle_connection(fd: i32) void {
    defer _ = linux.close(fd);

    var buf: [4096]u8 = undefined;
    while (true) {
        // This BLOCKS the entire thread until data arrives
        const n = linux.read(fd, &buf, buf.len);
        if (@as(isize, @bitCast(n)) <= 0) break;

        // Echo it back
        _ = linux.write(fd, &buf, n);
    }
}

pub fn main() !void {
    const sock = linux.socket(linux.AF.INET, linux.SOCK.STREAM, 0);
    // ... bind, listen ...

    while (true) {
        const client = linux.accept(sock, null, null, 0);
        // Spawn a thread per connection — expensive!
        const thread = try std.Thread.spawn(.{}, handle_connection,
            .{@as(i32, @intCast(client))});
        thread.detach();
    }
}
```

The numbers make the problem clear. On Linux, a thread with an 8MB stack costs:
- 8MB virtual memory for the stack
- ~2KB kernel stack for the thread descriptor
- ~100-300ns per context switch
- Scheduler overhead proportional to thread count

At 10,000 connections: 80GB virtual memory, thousands of context switches per second. At 100,000 connections: the model simply breaks.

### 1.2 The Conceptual Shift

The insight behind async I/O: most connections are idle most of the time. A web server with 10,000 open connections might only have 50-100 actively sending or receiving data at any instant. Giving each connection a full thread is waste — you are paying for 10,000 workers when only 100 are doing anything.

The solution: one thread monitors all 10,000 file descriptors simultaneously. When one becomes ready, the thread handles it and moves on. When none are ready, the thread sleeps efficiently. This is the event loop model.

```
Thread-per-connection:
[Thread 1: waiting...]  [Thread 2: active!]  [Thread 3: waiting...]  ...
     wasteful                                      wasteful

Event loop (one thread):
[Check fd 1: not ready → skip]
[Check fd 2: data arrived → handle it]
[Check fd 3: not ready → skip]
[Check fd 4: data arrived → handle it]
...
[Sleep until next event]
     efficient
```

---

## Part 2: epoll — Scalable Readiness Notification

### 2.1 The select/poll Problem

Before `epoll`, Linux had `select()` and `poll()`. Both allow a thread to wait for one of many file descriptors to become ready. Both have a fatal scaling problem: they require passing the *entire* list of file descriptors to the kernel on every call. Scanning through 10,000 file descriptors to find the ready ones, on every `select()` call, is O(n) in the number of monitored descriptors. At scale, this loop consumes more CPU than the actual I/O work.

`epoll` solves this with a different model: register interest once, then efficiently wait for events. The kernel maintains an internal data structure of registered descriptors. When one becomes ready, the kernel adds it to the ready list. `epoll_wait` returns only the descriptors that are actually ready — no scanning required. Adding or removing a descriptor is O(log n) (or O(1) with the right hash structure). Waiting for events is O(ready_count), not O(total_count). This is the property that makes `epoll` scale to millions of connections.

### 2.2 The epoll System Calls

Three system calls build the `epoll` interface:

**`epoll_create1(flags)`** — creates a new epoll instance. Returns a file descriptor representing the epoll object. Pass `EPOLL_CLOEXEC` to have the fd automatically closed on `exec()`.

**`epoll_ctl(epfd, op, fd, event)`** — add, modify, or remove a file descriptor from the epoll instance:
- `EPOLL_CTL_ADD`: start monitoring `fd`
- `EPOLL_CTL_MOD`: change the events monitored for `fd`
- `EPOLL_CTL_DEL`: stop monitoring `fd`

The `event` structure specifies:
- **`events`:** What to monitor (`EPOLLIN` for read-ready, `EPOLLOUT` for write-ready, `EPOLLERR` for errors, `EPOLLHUP` for hang-up, `EPOLLET` for edge-triggered mode)
- **`data`:** User data — typically the file descriptor itself or a pointer to connection state

**`epoll_wait(epfd, events, maxevents, timeout)`** — wait for events. Returns the number of ready events, filling the `events` array. `timeout` of -1 means wait forever; 0 returns immediately.

### 2.3 Level-Triggered vs Edge-Triggered

`epoll` supports two notification modes:

**Level-triggered (default):** `epoll_wait` reports a file descriptor as readable as long as there is data in its receive buffer. Every call to `epoll_wait` will include this fd until all data is consumed. This is the safe, easy-to-use mode — partial reads are harmless.

**Edge-triggered (`EPOLLET`):** `epoll_wait` reports a file descriptor only when its state *changes* — when new data arrives. After the initial notification, the fd is not reported again until more data arrives. This requires reading all available data in a loop until `EAGAIN`, or events will be lost. Edge-triggered mode has lower overhead but is harder to use correctly.

For a first implementation, use level-triggered mode.

### 2.4 Non-Blocking File Descriptors

`epoll` only makes sense with non-blocking file descriptors. A blocking fd would stall the event loop if accidentally blocked on. Set a file descriptor to non-blocking with:

```zig
const flags = linux.fcntl(fd, linux.F.GETFL, 0);
_ = linux.fcntl(fd, linux.F.SETFL,
    flags | linux.SOCK.NONBLOCK);
```

Or set it at socket creation:
```zig
const fd = linux.socket(linux.AF.INET,
    linux.SOCK.STREAM | linux.SOCK.NONBLOCK | linux.SOCK.CLOEXEC, 0);
```

When a non-blocking read or write returns `EAGAIN` or `EWOULDBLOCK`, the operation would have blocked — there is no data to read or no space to write. Return to the event loop and wait for `epoll` to signal readiness again.

### 2.5 A Complete epoll Echo Server

```zig
const std = @import("std");
const linux = std.os.linux;
const assert = std.debug.assert;

const MAX_EVENTS = 64;
const PORT = 8080;

fn set_nonblocking(fd: i32) void {
    const flags: u32 = @intCast(linux.fcntl(fd, linux.F.GETFL, 0));
    _ = linux.fcntl(fd, linux.F.SETFL, flags | @as(u32, linux.SOCK.NONBLOCK));
}

fn create_server_socket(port: u16) !i32 {
    const sock = @as(i32, @intCast(
        linux.socket(linux.AF.INET, linux.SOCK.STREAM | linux.SOCK.CLOEXEC, 0)));
    if (sock < 0) return error.SocketFailed;

    // Allow address reuse (prevents "address already in use" on restart)
    const one: i32 = 1;
    _ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.REUSEADDR,
        @ptrCast(&one), @sizeOf(i32));

    const addr = linux.sockaddr.in{
        .family = linux.AF.INET,
        .port = std.mem.nativeToBig(u16, port),
        .addr = 0, // INADDR_ANY
        .zero = [_]u8{0} ** 8,
    };

    if (linux.bind(sock, @ptrCast(&addr), @sizeOf(@TypeOf(addr))) != 0)
        return error.BindFailed;
    if (linux.listen(sock, 128) != 0)
        return error.ListenFailed;

    set_nonblocking(sock);
    return sock;
}

pub fn main() !void {
    const server_fd = try create_server_socket(PORT);
    defer _ = linux.close(server_fd);

    // Create epoll instance
    const epfd = @as(i32, @intCast(linux.epoll_create1(linux.EPOLL_CLOEXEC)));
    if (epfd < 0) return error.EpollCreateFailed;
    defer _ = linux.close(epfd);

    // Register server socket: notify when a new connection is ready to accept
    var server_event = linux.epoll_event{
        .events = linux.EPOLL.IN,
        .data = .{ .fd = server_fd },
    };
    _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_ADD, server_fd, &server_event);

    std.debug.print("Echo server listening on port {d}\n", .{PORT});

    var events: [MAX_EVENTS]linux.epoll_event = undefined;

    while (true) {
        // Wait for events: -1 = wait forever
        const n_events = linux.epoll_wait(epfd, &events, MAX_EVENTS, -1);

        for (events[0..@intCast(n_events)]) |ev| {
            const fd = ev.data.fd;

            if (fd == server_fd) {
                // New connection ready to accept
                while (true) {
                    const client = @as(i32, @intCast(
                        linux.accept(server_fd, null, null, linux.SOCK.CLOEXEC)));
                    if (client < 0) break; // EAGAIN: no more pending connections

                    set_nonblocking(client);

                    // Register client with epoll
                    var client_event = linux.epoll_event{
                        .events = linux.EPOLL.IN | linux.EPOLL.RDHUP,
                        .data = .{ .fd = client },
                    };
                    _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_ADD,
                        client, &client_event);

                    std.debug.print("accepted fd={d}\n", .{client});
                }
            } else if (ev.events & linux.EPOLL.RDHUP != 0) {
                // Client disconnected
                _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
                _ = linux.close(fd);
                std.debug.print("closed fd={d}\n", .{fd});
            } else if (ev.events & linux.EPOLL.IN != 0) {
                // Data available to read
                var buf: [4096]u8 = undefined;

                // Read in a loop until EAGAIN (all available data consumed)
                while (true) {
                    const n = @as(isize, @bitCast(linux.read(fd, &buf, buf.len)));
                    if (n <= 0) {
                        if (n == 0) {
                            // Orderly disconnect
                            _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
                            _ = linux.close(fd);
                        }
                        break;
                    }
                    // Echo back
                    var written: usize = 0;
                    while (written < @as(usize, @intCast(n))) {
                        const w = @as(isize, @bitCast(
                            linux.write(fd, buf[written..@intCast(n)].ptr,
                                @intCast(n) - written)));
                        if (w < 0) break;
                        written += @intCast(w);
                    }
                }
            }
        }
    }
}
```

This single-threaded server handles thousands of concurrent connections. No thread creation, no context switching overhead, no per-connection memory overhead beyond a small epoll registration.

### 2.6 The Read Loop Is Critical

The inner `while (true)` loop around `read()` is not optional — it is required for correct epoll behavior. When `epoll` reports a file descriptor as readable, the kernel may have buffered multiple incoming packets or messages. Reading only one chunk leaves data in the buffer. With level-triggered epoll, this means the fd will be reported ready again on the next `epoll_wait` call — correct but wasteful. With edge-triggered epoll, failure to drain the buffer completely means events are lost until more data arrives — a real bug.

Always read until `EAGAIN`. Always write in a loop until all data is written or `EAGAIN` occurs (in which case, register for `EPOLLOUT` and continue writing when writable).

---

> **Exercise 11.1: HTTP Request Counter**
>
> Extend the echo server into a minimal HTTP server that:
> 1. Accepts a connection
> 2. Reads until it finds `\r\n\r\n` (end of HTTP headers)
> 3. Responds with: `HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK`
> 4. Tracks the total number of requests served atomically (so it's safe if you later add threads)
> 5. Responds to GET `/stats` with the request count
>
> Use `wrk` or `hey` to benchmark at 1000, 10000, and 50000 concurrent connections. What is the throughput? Where does it saturate?

---

## Part 3: io_uring — The Completion-Based Revolution

### 3.1 The Problem with Readiness

`epoll` notifies when a file descriptor is *ready* — when a `read()` or `write()` can proceed without blocking. But the actual read or write still requires a system call. For high-throughput I/O:

1. `epoll_wait()` — one system call to learn which fds are ready
2. `read()` per ready fd — one system call per read
3. `write()` per response — one system call per write

System calls are expensive: ~100-300ns each (Module 3). A server handling 100,000 requests per second makes 300,000 or more system calls per second. The system call overhead becomes significant.

`io_uring` takes a fundamentally different approach: **completion-based I/O**. Instead of asking "is this fd ready so I can call read?", you ask "please read N bytes from this fd and notify me when done." The kernel performs the operation for you.

### 3.2 The Ring Buffer Architecture

`io_uring` gets its name from its core data structure: two ring buffers shared between user space and the kernel via `mmap`. No system call crossing is required to add requests or check completions in the common case — the shared memory makes it free.

```
User Space                          Kernel
──────────────────────────────────────────────────────
┌─────────────────────────────┐
│  Submission Queue (SQ)      │    User writes SQEs here
│  ┌──┬──┬──┬──┬──┬──┬──┬──┐ │ ──► Kernel drains and executes
│  │  │  │  │  │  │  │  │  │ │
│  └──┴──┴──┴──┴──┴──┴──┴──┘ │
│  head ──────────────► tail  │
└─────────────────────────────┘

┌─────────────────────────────┐
│  Completion Queue (CQ)      │    Kernel writes CQEs here
│  ┌──┬──┬──┬──┬──┬──┬──┬──┐ │ ──► User reads completions
│  │  │  │  │  │  │  │  │  │ │
│  └──┴──┴──┴──┴──┴──┴──┴──┘ │
│  head ──────────────► tail  │
└─────────────────────────────┘
```

**Submission Queue Entry (SQE):** A request placed by user space:
- Operation code (`IORING_OP_READ`, `IORING_OP_WRITE`, `IORING_OP_ACCEPT`, etc.)
- File descriptor
- Buffer pointer and length
- User data (64-bit value returned in the completion)
- Flags

**Completion Queue Entry (CQE):** A result placed by the kernel:
- User data (same value as submitted — this is how you correlate requests with responses)
- Result (bytes transferred, or a negative errno on error)
- Flags

### 3.3 The Three Execution Paths

`io_uring` has three ways to execute an operation:

**Inline completion:** The operation completes synchronously while processing the SQE. Result is immediately available. Zero overhead beyond the SQE submission.

**Async via io_uring worker threads:** The kernel's internal worker threads execute the operation. The CQE arrives when the operation completes. True asynchrony.

**Fallback to blocking:** For operations that cannot be made truly async on some kernel versions, `io_uring` falls back to a blocking thread pool. From the application's perspective, this is still async — the CQE arrives eventually.

The application code is identical for all three paths. The kernel chooses the execution path transparently.

### 3.4 io_uring in Zig

Zig's `std.os.linux` provides direct access to the `io_uring` system calls. The standard library wraps the ring buffer management:

```zig
const std = @import("std");
const linux = std.os.linux;

pub fn main() !void {
    // Initialize io_uring with 256 SQE slots
    var ring: linux.IoUring = try linux.IoUring.init(256, 0);
    defer ring.deinit();

    // Open a file for reading (this is a normal blocking open — 
    // io_uring also supports async open via IORING_OP_OPENAT)
    const fd = try std.fs.cwd().openFile("test.txt", .{});
    defer fd.close();

    var buf: [4096]u8 = undefined;

    // Submit a read request
    // user_data=1 identifies this request in the completion
    _ = try ring.read(1, fd.handle, .{ .buffer = &buf }, 0);

    // Submit to kernel (this is where system calls happen — batched)
    const submitted = try ring.submit();
    std.debug.print("submitted {d} operations\n", .{submitted});

    // Wait for completions
    const cqe = try ring.copy_cqe();

    if (cqe.res < 0) {
        std.debug.print("error: {d}\n", .{cqe.res});
    } else {
        const bytes_read: usize = @intCast(cqe.res);
        std.debug.print("read {d} bytes: {s}\n",
            .{bytes_read, buf[0..bytes_read]});
    }
}
```

### 3.5 Batching — The Key to io_uring Performance

The power of `io_uring` is batching: submitting many operations in a single `io_uring_enter()` system call. For a server handling 100,000 requests/second:

- `epoll` approach: one `epoll_wait` + one `read` + one `write` per request = 300,000 syscalls/sec
- `io_uring` approach: submit 100 reads, submit 100 writes, one `io_uring_enter` = essentially 1 syscall per 200 operations

```zig
/// Process a batch of pending reads and writes using io_uring
pub fn process_batch(
    ring: *linux.IoUring,
    pending_reads: []PendingRead,
    pending_writes: []PendingWrite,
) !void {
    // Submit all reads
    for (pending_reads, 0..) |*pr, i| {
        _ = try ring.read(@intCast(i), pr.fd,
            .{ .buffer = pr.buf[0..] }, 0);
    }

    // Submit all writes
    for (pending_writes, 0..) |*pw, i| {
        _ = try ring.write(
            @intCast(pending_reads.len + i),
            pw.fd,
            pw.data[0..pw.len],
            0
        );
    }

    // One system call submits everything AND waits for at least one completion
    const submitted = try ring.submit_and_wait(1);
    _ = submitted;

    // Process all available completions
    while (ring.cq_ready() > 0) {
        const cqe = try ring.copy_cqe();
        // Identify which operation completed via user_data
        const op_id = cqe.user_data;
        _ = op_id;
        // Handle completion...
    }
}
```

### 3.6 io_uring vs epoll — When to Use Which

| Factor | epoll | io_uring |
|--------|-------|---------|
| Kernel version | Any modern Linux | 5.1+ (5.6+ for full feature set) |
| Syscall count | High (one per operation) | Low (batched) |
| Memory copies | Zero-copy possible | Zero-copy possible |
| File I/O | Limited | Full support |
| Network I/O | Excellent | Excellent |
| Complexity | Moderate | Higher |
| Portability | Linux only | Linux only |

For **new Linux services** targeting kernel 5.6+: `io_uring` is the right choice, especially for services that mix file and network I/O.

For **portability** or **older kernels**: `epoll` is the reliable choice.

For **maximum simplicity** when the performance difference doesn't matter: use Zig's `std.Io` interface (Part 4) and let it choose.

---

> **Exercise 11.2: io_uring File Copier**
>
> Implement a file copy program using `io_uring` that copies a large file (>100MB) asynchronously:
>
> 1. Open source and destination files
> 2. Use a ring of N read buffers (e.g., 16 buffers × 64KB each)
> 3. Submit reads for all N buffers initially
> 4. As each read completes, immediately submit a write for that buffer
> 5. As each write completes, submit the next read for that buffer
> 6. Continue until the entire file is copied
>
> Measure throughput compared to a simple `sendfile()` implementation.
>
> Extension: Use `IORING_OP_SPLICE` or `io_uring`'s zero-copy support to eliminate buffer copies entirely.

---

## Part 4: Zig 0.16.0 — std.Io, the Unified Interface

### 4.1 The Function Coloring Problem

Every language that has introduced async/await has encountered the "function coloring" problem. In JavaScript, Python, and Rust, there are two kinds of functions: regular functions and async functions. They are different "colors" that don't mix freely. You can call a regular function from an async function, but you cannot call an async function from a regular function without special handling. This creates a viral propagation: the moment you add async I/O deep in a call chain, the entire call chain must be annotated `async`.

The consequence: libraries must choose. A library that uses async I/O cannot be used from synchronous code without bridging. Libraries that want to be universally usable must provide two versions — sync and async — or avoid async entirely.

Zig's previous async/await implementation had this problem. It was removed in Zig 0.13. In 0.16.0, the language team released a fundamentally different solution.

### 4.2 std.Io — The Abstraction

`std.Io` is an interface — similar in concept to `std.mem.Allocator` — that abstracts over I/O implementations. All code that performs I/O takes an `io: std.Io` parameter, just as all code that allocates takes an `allocator: std.mem.Allocator` parameter.

The crucial insight: the `Io` interface is the *application's* choice of concurrency model, not the library's. A library that takes an `Io` parameter works correctly with any `Io` implementation — blocking, threaded, or evented — without the library knowing or caring which one the application chose. There is no function coloring because there is no distinction between "sync" and "async" functions. There are only functions that take an `Io` parameter.

```zig
const std = @import("std");
const Io = std.Io;

// This function works correctly with any Io implementation.
// The caller decides whether it runs blocking, threaded, or event-driven.
fn save_file(io: Io, data: []const u8, name: []const u8) !void {
    const file = try Io.Dir.cwd().createFile(io, name, .{});
    defer file.close(io);
    try file.writeAll(io, data);
}
```

### 4.3 std.Io Implementations

The standard library provides two `Io` implementations for 0.16.0:

**`std.Io.Blocking`** (or equivalent): Maps directly to blocking system calls. Zero overhead, zero machinery. Using this `Io` implementation, code is identical in behavior and machine code to C using blocking I/O. This is the implementation you use when simplicity matters and performance is adequate.

**`std.Io.Threaded`**: Creates a thread pool and runs I/O operations on pool threads. Concurrent operations using `io.async()` run in parallel on pool threads. Correct on all platforms. Good for workloads that benefit from parallelism without needing event loop efficiency.

**`std.Io.Evented`** (planned, partial in 0.16.0): Uses the platform's native event loop — `io_uring` on Linux, GCD on macOS, IOCP on Windows. Concurrent operations are interleaved on the event loop. Optimal for high-concurrency I/O-bound workloads.

```zig
const std = @import("std");
const Io = std.Io;

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Choose your concurrency model:

    // Option 1: Blocking (synchronous, zero overhead)
    // var io_impl: std.Io.Blocking = .init;
    // const io = io_impl.io();

    // Option 2: Threaded (parallel, portable)
    var io_impl: std.Io.Threaded = .init(allocator);
    defer io_impl.deinit();
    const io = io_impl.io();

    // All application code below is identical regardless of which Io was chosen
    try do_work(io);
}

fn do_work(io: Io) !void {
    const file = try Io.Dir.cwd().createFile(io, "output.txt", .{});
    defer file.close(io);
    try file.writeAll(io, "Hello from async I/O\n");
}
```

### 4.4 Expressing Concurrency with io.async and Future

`io.async()` launches a concurrent operation. It returns a `Future` — a handle to the in-progress operation. The operation may run on a separate thread, on the event loop, or inline (synchronously), depending on the `Io` implementation.

```zig
const std = @import("std");
const Io = std.Io;

fn save_to_file(io: Io, data: []const u8, name: []const u8) !void {
    const file = try Io.Dir.cwd().createFile(io, name, .{});
    defer file.close(io);
    try file.writeAll(io, data);
}

fn save_data_sequentially(io: Io, data: []const u8) !void {
    // Sequential: save A, then save B (total time = A + B)
    try save_to_file(io, data, "output_a.txt");
    try save_to_file(io, data, "output_b.txt");
}

fn save_data_concurrently(io: Io, data: []const u8) !void {
    // Concurrent: save A and B simultaneously (total time = max(A, B))
    var future_a = io.async(save_to_file, .{io, data, "output_a.txt"});
    var future_b = io.async(save_to_file, .{io, data, "output_b.txt"});

    // CRITICAL: always await before trying. Never try a.await directly.
    // Reason: if we try a_result immediately and it errored,
    // we skip b_future.await — leaking resources.
    const result_a = future_a.await(io);
    const result_b = future_b.await(io);

    try result_a; // now it's safe to propagate errors
    try result_b;
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var io_impl: std.Io.Threaded = .init(allocator);
    defer io_impl.deinit();
    const io = io_impl.io();

    const data = "important data to save";

    var timer = try std.time.Timer.start();

    try save_data_sequentially(io, data);
    const seq_ns = timer.lap();

    try save_data_concurrently(io, data);
    const conc_ns = timer.read();

    std.debug.print("sequential:  {d} ms\n", .{seq_ns / 1_000_000});
    std.debug.print("concurrent:  {d} ms\n", .{conc_ns / 1_000_000});
    std.debug.print("speedup: {d:.1}x\n", .{
        @as(f64, @floatFromInt(seq_ns)) /
        @as(f64, @floatFromInt(conc_ns))
    });
}
```

### 4.5 The await-before-try Pattern

The most important correctness rule in `std.Io`: **always `await` all futures before `try`-ing any result.**

```zig
// WRONG: resource leak if a errors
try future_a.await(io); // if this errors, future_b is never awaited
try future_b.await(io);

// CORRECT: await both, then handle errors
const result_a = future_a.await(io);
const result_b = future_b.await(io);
try result_a;
try result_b;
```

If `future_a.await()` returns an error and you immediately `try` it, you skip `future_b.await()` entirely. The future for B may have allocated resources, opened files, or spawned threads — all of which are leaked. Awaiting all futures before handling any errors ensures cleanup happens correctly regardless of which operation errored.

### 4.6 std.Io.Group — Dynamic Concurrency

When the number of concurrent operations is not known at compile time, `std.Io.Group` manages a dynamic collection of futures:

```zig
const std = @import("std");
const Io = std.Io;

fn process_files(io: Io, filenames: []const []const u8,
                 allocator: std.mem.Allocator) !void {
    var group: Io.Group = .init;
    defer group.cancel(io); // cancels any remaining operations on exit

    // Launch all file processing operations concurrently
    for (filenames) |name| {
        // concurrent() is like async() but for the group
        try group.concurrent(io, process_one_file, .{io, name});
    }

    // Wait for all to complete
    // Returns as soon as any one errors (or when all succeed)
    try group.wait(io);
    _ = allocator;
}

fn process_one_file(io: Io, name: []const u8) !void {
    const file = try Io.Dir.cwd().openFile(io, name, .{});
    defer file.close(io);
    var buf: [4096]u8 = undefined;
    const n = try file.read(io, &buf);
    std.debug.print("processed {s}: {d} bytes\n", .{name, n});
}
```

`group.cancel(io)` in the `defer` ensures that if `process_files` returns early (due to an error), all in-progress operations are requested to cancel. Operations that have already completed are not affected. This is the `std.Io` equivalent of structured concurrency — all spawned work is bounded to the lifetime of the group.

### 4.7 Cancellation

`Future.cancel(io)` requests cancellation of an in-progress operation. It is idempotent and semantically identical to `await` except it additionally signals the implementation to stop the operation if possible.

```zig
var future = io.async(long_operation, .{io, data});
defer future.cancel(io) catch {}; // always cancel if we exit early

// Do other work...
// If we need to abandon the operation:
future.cancel(io) catch {};
// The result may be error.Canceled or may be success if the
// operation completed before cancellation was processed
```

---

## Part 5: Building a Timer Wheel

### 5.1 Why Event Loops Need Timers

An event loop that only handles I/O readiness is incomplete. Real servers need:
- **Connection timeouts:** Close connections that have been idle too long
- **Request timeouts:** Kill requests that take longer than expected
- **Retry timers:** Re-attempt failed operations after a delay
- **Health check timers:** Periodic background tasks

The naive approach — storing a sorted list of timers and checking against the current time — is O(log n) per timer operation. For a server managing tens of thousands of connections, each with its own timeout, this adds up.

The **timer wheel** is the standard solution: O(1) per timer operation, used in the Linux kernel, BSD network stacks, and production event loops everywhere.

### 5.2 How a Timer Wheel Works

A timer wheel is a circular array of buckets. Each bucket holds timers expiring in a specific time interval. A "hand" advances through the buckets at a fixed tick rate. When the hand reaches a bucket, all timers in that bucket are fired.

```
Timer wheel with 8 slots, 100ms per slot:

Slot 0: [timer A: 100ms]
Slot 1: [timer B: 200ms, timer C: 200ms]
Slot 2: []
Slot 3: [timer D: 400ms]
Slot 4: []
Slot 5: [timer E: 600ms]
Slot 6: []
Slot 7: []
        ↑
      current slot (0)

After one tick (100ms passes):
  → Fire timer A
  → Advance hand to slot 1
  
After two ticks:
  → Fire timers B and C
  → Advance hand to slot 2
```

For timeouts much longer than the wheel period, hierarchical timer wheels stack multiple wheels with different resolutions — the same way a clock has seconds, minutes, and hours hands.

```zig
const std = @import("std");

const WHEEL_SIZE = 512;       // number of slots
const TICK_MS: u64 = 10;      // milliseconds per tick

const TimerNode = struct {
    callback: *const fn (*anyopaque) void,
    ctx: *anyopaque,
    next: ?*TimerNode,
};

const TimerWheel = struct {
    slots: [WHEEL_SIZE]?*TimerNode,
    current_slot: usize,
    current_time_ms: u64,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) TimerWheel {
        return .{
            .slots = [_]?*TimerNode{null} ** WHEEL_SIZE,
            .current_slot = 0,
            .current_time_ms = 0,
            .allocator = allocator,
        };
    }

    /// Schedule a callback to fire after `delay_ms` milliseconds.
    pub fn schedule(self: *TimerWheel,
                    delay_ms: u64,
                    callback: *const fn (*anyopaque) void,
                    ctx: *anyopaque) !void {
        const ticks = (delay_ms + TICK_MS - 1) / TICK_MS; // ceiling division
        const slot = (self.current_slot + ticks) % WHEEL_SIZE;

        const node = try self.allocator.create(TimerNode);
        node.* = .{
            .callback = callback,
            .ctx = ctx,
            .next = self.slots[slot],
        };
        self.slots[slot] = node;
    }

    /// Advance the wheel by one tick. Fires all timers in the current slot.
    /// Returns number of timers fired.
    pub fn tick(self: *TimerWheel) u64 {
        self.current_time_ms += TICK_MS;
        const slot = self.current_slot;
        self.current_slot = (self.current_slot + 1) % WHEEL_SIZE;

        var fired: u64 = 0;
        var node = self.slots[slot];
        self.slots[slot] = null;

        while (node) |n| {
            const next = n.next;
            n.callback(n.ctx);
            self.allocator.destroy(n);
            node = next;
            fired += 1;
        }

        return fired;
    }

    /// Advance wheel to the given time, firing all expired timers.
    pub fn advance_to(self: *TimerWheel, now_ms: u64) void {
        while (self.current_time_ms + TICK_MS <= now_ms) {
            _ = self.tick();
        }
    }
};

// Example: use timer wheel in an event loop
const ConnectionCtx = struct {
    fd: i32,
    last_activity_ms: u64,
};

fn on_connection_timeout(ctx: *anyopaque) void {
    const conn: *ConnectionCtx = @ptrCast(@alignCast(ctx));
    std.debug.print("connection fd={d} timed out\n", .{conn.fd});
    _ = std.os.linux.close(conn.fd);
}
```

### 5.3 Integrating Timers with the Event Loop

In an `epoll`-based event loop, integrate the timer wheel by converting the next timer expiration to an `epoll_wait` timeout:

```zig
// In the event loop:
while (true) {
    const now_ms = current_time_ms();

    // Fire expired timers
    wheel.advance_to(now_ms);

    // Calculate time until next timer expires (for epoll_wait timeout)
    const next_expiry_ms = next_timer_slot_ms(&wheel);
    const wait_ms: i32 = if (next_expiry_ms > now_ms)
        @intCast(@min(next_expiry_ms - now_ms, std.math.maxInt(i32)))
    else
        0;

    // Wait for I/O or timer expiry
    const n = linux.epoll_wait(epfd, &events, MAX_EVENTS, wait_ms);

    // Handle I/O events...
    for (events[0..@intCast(n)]) |ev| {
        handle_event(ev);
    }
}
```

---

## Part 6: The Module Project — An Async HTTP Server

### Project Specification

Build a complete, production-quality HTTP/1.1 server using `epoll` for the event loop, the timer wheel from Part 5 for connection timeouts, and `std.Io` for file serving.

The server must:
- Handle concurrent connections without blocking
- Implement keep-alive (multiple requests per connection)
- Close idle connections after 30 seconds using the timer wheel
- Serve static files using memory-mapped file I/O
- Respond to `GET /` with `200 OK` and a simple HTML page
- Respond to `GET /static/<filename>` with the file contents
- Respond to anything else with `404 Not Found`
- Log request method, path, status code, and response time

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Async HTTP Server                        │
│                                                             │
│  ┌────────────┐    ┌────────────┐    ┌────────────────────┐ │
│  │  epoll     │    │  Timer     │    │  Connection Pool   │ │
│  │  Event     │───►│  Wheel     │    │  (HashMap fd→Conn) │ │
│  │  Loop      │    │  (30s TTL) │    │                    │ │
│  └────────────┘    └────────────┘    └────────────────────┘ │
│         │                                     │             │
│         ▼                                     ▼             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │               HTTP Parser (state machine)              │ │
│  │  States: request_line → headers → body → complete      │ │
│  └────────────────────────────────────────────────────────┘ │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │               Request Handler                          │ │
│  │  GET /        → HTML response                          │ │
│  │  GET /static/ → mmap'd file via std.Io                 │ │
│  │  Otherwise    → 404                                    │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Connection State Machine

Each connection is a state machine (Module 5 pattern):

```zig
const ConnState = union(enum) {
    reading_headers: struct {
        buf: [8192]u8,
        len: usize,
    },
    sending_response: struct {
        data: []const u8,
        sent: usize,
    },
    idle,  // keep-alive: waiting for next request
    closing,
};
```

### Key Implementation Details

**Non-blocking accept loop:**
```zig
// When EPOLLIN fires on server_fd, drain all pending connections
while (true) {
    const client_fd = linux.accept4(server_fd, null, null,
        linux.SOCK.NONBLOCK | linux.SOCK.CLOEXEC);
    if (@as(isize, @bitCast(client_fd)) < 0) break; // EAGAIN
    try register_connection(epfd, &wheel, connections, @intCast(client_fd));
}
```

**Memory-mapped file serving:**
```zig
fn serve_file(io: Io, path: []const u8, fd: i32) !void {
    const file = Io.Dir.cwd().openFile(io, path, .{}) catch {
        return send_404(fd);
    };
    defer file.close(io);
    // Use mmap for zero-copy file serving (Module 9)
    // ...
}
```

**Benchmarking:**
```bash
# Install wrk
sudo apt install wrk

# Benchmark: 100 concurrent connections, 30s duration
wrk -t4 -c100 -d30s http://localhost:8080/

# Compare with blocking reference implementation
wrk -t4 -c1000 -d30s http://localhost:8080/  # 1000 concurrent connections
```

### Extension Challenges

1. **HTTP/1.1 pipelining:** Handle multiple requests in the same TCP segment without needing a round-trip for each. The parser must buffer incomplete requests and process multiple complete requests from a single `read()`.

2. **io_uring backend:** Rewrite the inner event loop to use `io_uring` instead of `epoll`. Submit batches of `IORING_OP_READ` and `IORING_OP_WRITE` operations. Measure the throughput improvement.

3. **Worker threads:** Add a pool of worker threads that handle request processing while the event loop thread only handles I/O readiness. This separates I/O multiplexing from CPU work.

---

## Summary

Asynchronous I/O is the technique that allows single-threaded programs to handle thousands of concurrent connections efficiently. The evolution from blocking I/O to async I/O reflects a fundamental shift in how programs relate to the OS.

**Blocking I/O** is simple but does not scale. One thread per connection consumes memory and CPU proportional to connection count, independent of actual activity.

**`epoll`** provides scalable readiness notification. Register file descriptors once; receive notifications only when they have data. A single thread handles thousands of connections by processing only the ready ones. The inner read-until-EAGAIN loop is critical for correctness.

**`io_uring`** shifts from readiness to completion. Submit operations to the kernel's ring buffer; receive completions when they finish. Batching multiple operations into a single system call eliminates per-operation syscall overhead. The performance advantage is most pronounced at high throughput with mixed file and network I/O.

**`std.Io`** in Zig 0.16.0 solves the function coloring problem. All I/O passes through an `Io` interface parameter. The application chooses the concurrency model — blocking, threaded, or evented — and all library code works with any choice. `io.async()` launches concurrent operations; `Future.await()` collects results; `Group` manages dynamic concurrency. The await-before-try pattern prevents resource leaks.

**Timer wheels** provide O(1) timer management for event loops, essential for connection timeouts, request deadlines, and periodic tasks.

---

## What's Next

Module 12 — Building a Real Concurrent System: A Network Server — takes everything from Module 11 and assembles it into a complete, production-quality network server with protocol parsing, connection management, and the kind of architecture that real high-performance servers use.

---

## Reference: Async I/O Quick Reference

```bash
# Check if io_uring is available
uname -r  # need 5.1+ for basic io_uring, 5.6+ for full feature set
ls /sys/kernel/debug/io_uring  # present if enabled

# epoll system calls
epoll_create1(EPOLL_CLOEXEC)
epoll_ctl(epfd, EPOLL_CTL_ADD|MOD|DEL, fd, &event)
epoll_wait(epfd, events, maxevents, timeout_ms)  # -1 = wait forever, 0 = non-blocking

# epoll event flags
EPOLLIN   - fd is readable
EPOLLOUT  - fd is writable  
EPOLLERR  - error on fd
EPOLLHUP  - hang-up on fd
EPOLLRDHUP - peer closed write end
EPOLLET   - edge-triggered mode (default is level-triggered)
EPOLLONESHOT - notify only once, then disarm (re-arm with EPOLL_CTL_MOD)

# Non-blocking socket setup
socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0)
# or
fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)

# std.Io pattern (Zig 0.16.0)
var io_impl: std.Io.Threaded = .init(allocator);
defer io_impl.deinit();
const io = io_impl.io();

var fa = io.async(func_a, .{io, args_a...});
var fb = io.async(func_b, .{io, args_b...});
const ra = fa.await(io);   // await first, THEN try
const rb = fb.await(io);
try ra;
try rb;

var group: std.Io.Group = .init;
defer group.cancel(io);
try group.concurrent(io, func, .{io, args...});
try group.wait(io);
```

---

*End of Module 11*
