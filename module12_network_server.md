# Module 12: Building a Real Concurrent System — A Network Server

## The Craft of Systems Programming — Teaching Material

---

> *"The difference between a toy server and a production server is not features. It is the depth of understanding baked into the architecture — how connections are managed, how the protocol is parsed, how backpressure is applied, and how the system fails gracefully when things go wrong."*

---

## Before You Begin

Modules 7 through 11 have built a complete toolkit: scheduling, concurrency primitives, memory management, file systems, performance measurement, async I/O. This module assembles that toolkit into a single, coherent system — a real network server.

Not a toy echo server. Not a demo that works for five connections. A server with a real protocol, real connection management, real backpressure, real graceful shutdown, and the architectural patterns that production servers like Redis, nginx, and memcached are built on.

The vehicle is a Redis-compatible server. Redis is the right choice for this module because its architecture is genuinely instructive — single-threaded event loop, zero-copy protocol parsing, in-memory data structures — and its protocol (RESP) is real, documented, and simple enough to implement from scratch in a module. When you finish this module, you can connect a real Redis client to your server and it works.

By the end you will have implemented the Reactor pattern, built a complete RESP parser as a state machine, managed a connection pool with backpressure, implemented commands backed by real data structures, and benchmarked the result against Redis itself.

---

## Learning Objectives

By the end of this module, you will be able to:

- Implement the Reactor pattern: a single-threaded event loop with a thread pool for CPU-bound work
- Implement a complete RESP2 parser as a state machine that handles arbitrary fragmentation
- Implement RESP2 serialization for all five data types
- Manage a bounded connection pool with accept-rate limiting as backpressure
- Implement graceful shutdown: draining in-flight requests before exiting
- Implement `SET`, `GET`, `DEL`, `EXISTS`, `EXPIRE`, `TTL`, `PING`, `ECHO`, `KEYS`, and `COMMAND` commands
- Store values with expiry using a combination of a hash map and a min-heap
- Benchmark your server against Redis using `redis-benchmark`
- Explain why Redis uses a single-threaded event loop and when that design breaks down

---

## Part 1: The Architecture

### 1.1 What We Are Building

A Redis-compatible in-memory key-value server. It will:

- Listen on TCP port 6380 (to avoid conflicting with a real Redis on 6379)
- Accept connections from any Redis client (`redis-cli`, client libraries, `redis-benchmark`)
- Parse the RESP2 protocol: the same wire protocol Redis uses
- Handle commands: `PING`, `ECHO`, `SET`, `GET`, `DEL`, `EXISTS`, `EXPIRE`, `TTL`, `KEYS`
- Store data in an in-memory hash map with optional expiry
- Handle up to 10,000 concurrent connections
- Respond correctly to `redis-benchmark` for throughput measurement

### 1.2 The Reactor Pattern

The Reactor pattern uses a single threaded event loop blocking on resource-emitting events and dispatches them to corresponding handlers and callbacks. There is no need to block on I/O, as long as handlers and callbacks for events are registered to take care of them.

Redis relies on a single-threaded event loop for its core operations. This model allows a single thread to handle thousands of concurrent client connections efficiently using I/O multiplexing.

The reason a single-threaded event loop is powerful: in Redis, virtually all work is in-memory operations that complete in nanoseconds. The bottleneck is not CPU — it is I/O. A single thread can service thousands of clients because the thread is almost never blocked; it is always doing useful work.

Because the number of full-weight processes is small (usually only one per CPU core) and constant, much less memory is consumed and CPU cycles aren't wasted on task switching.

The architecture of our server:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Event Loop Thread                           │
│                                                                 │
│  ┌──────────┐    ┌─────────────────┐    ┌────────────────────┐  │
│  │  epoll   │───►│ Connection Pool │───►│  RESP Parser       │  │
│  │          │    │ (HashMap fd→    │    │  (state machine    │  │
│  │          │    │  ConnState)     │    │   per connection)  │  │
│  └──────────┘    └─────────────────┘    └────────────────────┘  │
│                                                  │              │
│                                                  ▼              │
│                           ┌──────────────────────────────────┐  │
│                           │  Command Dispatcher              │  │
│                           │  PING → ping_handler             │  │
│                           │  SET  → set_handler              │  │
│                           │  GET  → get_handler              │  │
│                           └──────────────────────────────────┘  │
│                                          │                      │
│                                          ▼                      │
│                           ┌──────────────────────────────────┐  │
│                           │  Storage Engine                  │  │
│                           │  HashMap<Key, ValueWithExpiry>   │  │
│                           │  + expiry heap (min-heap by TTL) │  │
│                           └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

No thread pool for command handling. Commands are in-memory operations. The event loop handles everything: accept, read, parse, execute, write.

---

## Part 2: The RESP2 Protocol

### 2.1 Protocol Overview

RESP is binary-safe and uses prefixed length to transfer bulk data so it does not require processing bulk data transferred from one process to another. In RESP, the first byte of data determines its type. Subsequent bytes constitute the type's contents. The `\r\n` (CRLF) is the protocol's terminator, which always separates its parts.

The five RESP2 data types:

| First byte | Type | Example |
|------------|------|---------|
| `+` | Simple String | `+OK\r\n` |
| `-` | Error | `-ERR unknown command\r\n` |
| `:` | Integer | `:1000\r\n` |
| `$` | Bulk String | `$6\r\nfoobar\r\n` |
| `*` | Array | `*2\r\n$4\r\nLLEN\r\n$6\r\nmylist\r\n` |

Clients send commands to a Redis server as a RESP Array of Bulk Strings. The server's reply type is command-specific.

A `SET foo bar` command on the wire:
```
*3\r\n
$3\r\n
SET\r\n
$3\r\n
foo\r\n
$3\r\n
bar\r\n
```

An `OK` response:
```
+OK\r\n
```

### 2.2 The RESP Parser as a State Machine

The parser must handle arbitrary fragmentation — the client may send the command in multiple TCP segments. This is the state machine pattern from Module 5 applied directly.

```zig
const std = @import("std");

pub const RespValue = union(enum) {
    simple_string: []const u8,
    error_msg: []const u8,
    integer: i64,
    bulk_string: ?[]const u8,    // null = nil bulk string ($-1\r\n)
    array: ?[]RespValue,         // null = nil array (*-1\r\n)
};

/// Parser state — exactly where we are in parsing the current value
const ParseState = union(enum) {
    /// At the start: waiting for the type byte
    start,

    /// Reading a simple string or error: accumulating bytes until \r\n
    reading_line: struct {
        is_error: bool,
        buf: std.ArrayList(u8),
    },

    /// Reading an integer: accumulating digits until \r\n
    reading_integer: struct {
        buf: std.ArrayList(u8),
    },

    /// Reading a bulk string: waiting for length, then data
    bulk_string_length: struct {
        length_buf: std.ArrayList(u8),
    },
    bulk_string_data: struct {
        expected_len: usize,
        buf: []u8,      // pre-allocated to expected_len
        read: usize,
        after_crlf: u8, // state for consuming trailing \r\n
    },

    /// Reading an array: waiting for count, then parsing each element
    array_count: struct {
        count_buf: std.ArrayList(u8),
    },
    array_elements: struct {
        total: usize,
        elements: std.ArrayList(RespValue),
        child_parser: *RespParser, // recursive parser for elements
    },
};

pub const ParseResult = union(enum) {
    complete: RespValue,
    incomplete,
    err: []const u8,
};

pub const RespParser = struct {
    state: ParseState,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) RespParser {
        return .{
            .state = .start,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *RespParser) void {
        self.reset();
    }

    pub fn reset(self: *RespParser) void {
        switch (self.state) {
            .reading_line => |*s| s.buf.deinit(),
            .reading_integer => |*s| s.buf.deinit(),
            .bulk_string_length => |*s| s.length_buf.deinit(),
            .bulk_string_data => |*s| self.allocator.free(s.buf),
            .array_count => |*s| s.count_buf.deinit(),
            .array_elements => |*s| {
                s.elements.deinit();
                s.child_parser.deinit();
                self.allocator.destroy(s.child_parser);
            },
            .start => {},
        }
        self.state = .start;
    }

    /// Feed one byte to the parser.
    /// Returns complete value when enough bytes have been received,
    /// incomplete when more bytes are needed, or an error.
    pub fn feed(self: *RespParser, byte: u8) !ParseResult {
        switch (self.state) {
            .start => {
                switch (byte) {
                    '+' => {
                        self.state = .{ .reading_line = .{
                            .is_error = false,
                            .buf = std.ArrayList(u8).init(self.allocator),
                        }};
                    },
                    '-' => {
                        self.state = .{ .reading_line = .{
                            .is_error = true,
                            .buf = std.ArrayList(u8).init(self.allocator),
                        }};
                    },
                    ':' => {
                        self.state = .{ .reading_integer = .{
                            .buf = std.ArrayList(u8).init(self.allocator),
                        }};
                    },
                    '$' => {
                        self.state = .{ .bulk_string_length = .{
                            .length_buf = std.ArrayList(u8).init(self.allocator),
                        }};
                    },
                    '*' => {
                        self.state = .{ .array_count = .{
                            .count_buf = std.ArrayList(u8).init(self.allocator),
                        }};
                    },
                    else => return .{ .err = "invalid RESP type byte" },
                }
                return .incomplete;
            },

            .reading_line => |*s| {
                if (byte == '\r') return .incomplete; // skip CR
                if (byte == '\n') {
                    const owned = try s.buf.toOwnedSlice();
                    const result: ParseResult = if (s.is_error)
                        .{ .complete = .{ .error_msg = owned } }
                    else
                        .{ .complete = .{ .simple_string = owned } };
                    self.state = .start;
                    return result;
                }
                try s.buf.append(byte);
                return .incomplete;
            },

            .reading_integer => |*s| {
                if (byte == '\r') return .incomplete;
                if (byte == '\n') {
                    const str = s.buf.items;
                    const val = try std.fmt.parseInt(i64, str, 10);
                    s.buf.deinit();
                    self.state = .start;
                    return .{ .complete = .{ .integer = val } };
                }
                try s.buf.append(byte);
                return .incomplete;
            },

            .bulk_string_length => |*s| {
                if (byte == '\r') return .incomplete;
                if (byte == '\n') {
                    const str = s.buf.items;
                    const len = try std.fmt.parseInt(i64, str, 10);
                    s.length_buf.deinit();

                    if (len < 0) {
                        // Null bulk string: $-1\r\n
                        self.state = .start;
                        return .{ .complete = .{ .bulk_string = null } };
                    }

                    const ulen: usize = @intCast(len);
                    if (ulen == 0) {
                        // Empty bulk string: $0\r\n\r\n
                        self.state = .{ .bulk_string_data = .{
                            .expected_len = 0,
                            .buf = try self.allocator.alloc(u8, 0),
                            .read = 0,
                            .after_crlf = 0,
                        }};
                    } else {
                        self.state = .{ .bulk_string_data = .{
                            .expected_len = ulen,
                            .buf = try self.allocator.alloc(u8, ulen),
                            .read = 0,
                            .after_crlf = 0,
                        }};
                    }
                    return .incomplete;
                }
                try s.length_buf.append(byte);
                return .incomplete;
            },

            .bulk_string_data => |*s| {
                if (s.read < s.expected_len) {
                    s.buf[s.read] = byte;
                    s.read += 1;
                    return .incomplete;
                }
                // Consume trailing \r\n
                s.after_crlf += 1;
                if (s.after_crlf == 2) {
                    const data = s.buf;
                    self.state = .start;
                    return .{ .complete = .{ .bulk_string = data } };
                }
                return .incomplete;
            },

            .array_count => |*s| {
                if (byte == '\r') return .incomplete;
                if (byte == '\n') {
                    const str = s.count_buf.items;
                    const count = try std.fmt.parseInt(i64, str, 10);
                    s.count_buf.deinit();

                    if (count < 0) {
                        self.state = .start;
                        return .{ .complete = .{ .array = null } };
                    }

                    if (count == 0) {
                        self.state = .start;
                        return .{ .complete = .{ .array = &[_]RespValue{} } };
                    }

                    const child = try self.allocator.create(RespParser);
                    child.* = RespParser.init(self.allocator);

                    self.state = .{ .array_elements = .{
                        .total = @intCast(count),
                        .elements = std.ArrayList(RespValue).init(self.allocator),
                        .child_parser = child,
                    }};
                    return .incomplete;
                }
                try s.count_buf.append(byte);
                return .incomplete;
            },

            .array_elements => |*s| {
                const result = try s.child_parser.feed(byte);
                switch (result) {
                    .incomplete => return .incomplete,
                    .err => |msg| return .{ .err = msg },
                    .complete => |val| {
                        try s.elements.append(val);
                        s.child_parser.reset();

                        if (s.elements.items.len == s.total) {
                            const owned = try s.elements.toOwnedSlice();
                            s.child_parser.deinit();
                            self.allocator.destroy(s.child_parser);
                            self.state = .start;
                            return .{ .complete = .{ .array = owned } };
                        }
                        return .incomplete;
                    },
                }
            },
        }
    }

    /// Feed a slice of bytes, returning the first complete value found
    /// and the number of bytes consumed.
    pub fn feed_slice(self: *RespParser, data: []const u8) !struct {
        result: ParseResult,
        consumed: usize,
    } {
        for (data, 0..) |byte, i| {
            const result = try self.feed(byte);
            switch (result) {
                .incomplete => continue,
                .complete, .err => return .{
                    .result = result,
                    .consumed = i + 1,
                },
            }
        }
        return .{ .result = .incomplete, .consumed = data.len };
    }
};
```

### 2.3 RESP Serialization

The server must serialize responses back to the client. All five RESP types:

```zig
pub const RespWriter = struct {
    buf: std.ArrayList(u8),

    pub fn init(allocator: std.mem.Allocator) RespWriter {
        return .{ .buf = std.ArrayList(u8).init(allocator) };
    }

    pub fn deinit(self: *RespWriter) void {
        self.buf.deinit();
    }

    pub fn reset(self: *RespWriter) void {
        self.buf.clearRetainingCapacity();
    }

    pub fn bytes(self: *const RespWriter) []const u8 {
        return self.buf.items;
    }

    /// +OK\r\n
    pub fn write_simple_string(self: *RespWriter, s: []const u8) !void {
        try self.buf.append('+');
        try self.buf.appendSlice(s);
        try self.buf.appendSlice("\r\n");
    }

    /// -ERR message\r\n
    pub fn write_error(self: *RespWriter, msg: []const u8) !void {
        try self.buf.append('-');
        try self.buf.appendSlice(msg);
        try self.buf.appendSlice("\r\n");
    }

    /// :1234\r\n
    pub fn write_integer(self: *RespWriter, n: i64) !void {
        try self.buf.append(':');
        var tmp: [32]u8 = undefined;
        const s = try std.fmt.bufPrint(&tmp, "{d}", .{n});
        try self.buf.appendSlice(s);
        try self.buf.appendSlice("\r\n");
    }

    /// $6\r\nfoobar\r\n  or  $-1\r\n for nil
    pub fn write_bulk_string(self: *RespWriter, s: ?[]const u8) !void {
        if (s) |data| {
            try self.buf.append('$');
            var tmp: [32]u8 = undefined;
            const len_str = try std.fmt.bufPrint(&tmp, "{d}", .{data.len});
            try self.buf.appendSlice(len_str);
            try self.buf.appendSlice("\r\n");
            try self.buf.appendSlice(data);
            try self.buf.appendSlice("\r\n");
        } else {
            try self.buf.appendSlice("$-1\r\n");
        }
    }

    /// *3\r\n... (array of N elements, each pre-serialized)
    pub fn write_array_header(self: *RespWriter, count: ?usize) !void {
        if (count) |n| {
            try self.buf.append('*');
            var tmp: [32]u8 = undefined;
            const s = try std.fmt.bufPrint(&tmp, "{d}", .{n});
            try self.buf.appendSlice(s);
            try self.buf.appendSlice("\r\n");
        } else {
            try self.buf.appendSlice("*-1\r\n");
        }
    }

    /// Convenience: write a string array (common for KEYS, LRANGE, etc.)
    pub fn write_string_array(self: *RespWriter,
                              strings: []const []const u8) !void {
        try self.write_array_header(strings.len);
        for (strings) |s| {
            try self.write_bulk_string(s);
        }
    }
};
```

---

> **Exercise 12.1: Parser Verification**
>
> Write a test suite that verifies the RESP parser handles:
> 1. A complete `PING` command: `*1\r\n$4\r\nPING\r\n`
> 2. A `SET foo bar` command split across three byte feeds: `*3\r\n$3\r\n`, `SET\r\n$3\r\nfoo`, `\r\n$3\r\nbar\r\n`
> 3. A nil bulk string: `$-1\r\n`
> 4. A nil array: `*-1\r\n`
> 5. An integer: `:42\r\n`
> 6. An error: `-ERR bad command\r\n`
> 7. A nested array: `*2\r\n*2\r\n:1\r\n:2\r\n*2\r\n:3\r\n:4\r\n`
>
> Each test feeds the bytes one at a time to verify the parser handles every possible fragmentation point.

---

## Part 3: Connection Management

### 3.1 Connection State

Each connection has its own parser state, read buffer, write buffer, and request count. All connection state is allocated on the heap — the event loop owns it via a hash map.

```zig
const std = @import("std");
const linux = std.os.linux;

const MAX_CONNECTIONS = 10_000;
const READ_BUF_SIZE  = 16 * 1024;  // 16 KB read buffer
const WRITE_BUF_SIZE = 64 * 1024;  // 64 KB write buffer

const ConnState = struct {
    fd: i32,
    parser: RespParser,
    writer: RespWriter,
    read_buf: [READ_BUF_SIZE]u8,
    read_len: usize,
    write_buf: std.ArrayList(u8), // pending data to write
    write_offset: usize,          // how much of write_buf has been sent
    requests_handled: u64,
    created_at_ms: u64,
    last_activity_ms: u64,
    state: enum {
        reading,
        writing,  // blocked on write (EAGAIN on send)
        closing,
    },
    allocator: std.mem.Allocator,

    pub fn init(fd: i32, allocator: std.mem.Allocator, now_ms: u64) !*ConnState {
        const conn = try allocator.create(ConnState);
        conn.* = .{
            .fd = fd,
            .parser = RespParser.init(allocator),
            .writer = RespWriter.init(allocator),
            .read_buf = undefined,
            .read_len = 0,
            .write_buf = std.ArrayList(u8).init(allocator),
            .write_offset = 0,
            .requests_handled = 0,
            .created_at_ms = now_ms,
            .last_activity_ms = now_ms,
            .state = .reading,
            .allocator = allocator,
        };
        return conn;
    }

    pub fn deinit(self: *ConnState) void {
        self.parser.deinit();
        self.writer.deinit();
        self.write_buf.deinit();
        _ = linux.close(self.fd);
        self.allocator.destroy(self);
    }

    /// Queue response bytes to be written to the client.
    /// If write returns EAGAIN, register EPOLLOUT and continue later.
    pub fn queue_response(self: *ConnState, data: []const u8) !void {
        try self.write_buf.appendSlice(data);
    }

    /// Flush as much of write_buf as possible without blocking.
    /// Returns true if all data was sent.
    pub fn flush(self: *ConnState) !bool {
        while (self.write_offset < self.write_buf.items.len) {
            const remaining = self.write_buf.items[self.write_offset..];
            const n = @as(isize, @bitCast(
                linux.write(self.fd, remaining.ptr, remaining.len)));

            if (n < 0) {
                const err = linux.getErrno(@bitCast(n));
                if (err == .AGAIN or err == .WOULDBLOCK) {
                    return false; // blocked: register EPOLLOUT
                }
                return error.WriteFailed;
            }
            self.write_offset += @intCast(n);
        }

        // All data sent: compact the write buffer
        self.write_buf.clearRetainingCapacity();
        self.write_offset = 0;
        return true;
    }
};
```

### 3.2 The Connection Pool with Backpressure

When the server reaches `MAX_CONNECTIONS`, it should stop accepting new connections rather than allocating more memory. This is **backpressure** — the server signals to clients that it is at capacity by making them queue at the OS TCP accept backlog level.

```zig
const ConnectionPool = struct {
    connections: std.AutoHashMap(i32, *ConnState),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) ConnectionPool {
        return .{
            .connections = std.AutoHashMap(i32, *ConnState).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *ConnectionPool) void {
        var it = self.connections.valueIterator();
        while (it.next()) |conn| conn.*.deinit();
        self.connections.deinit();
    }

    pub fn count(self: *const ConnectionPool) usize {
        return self.connections.count();
    }

    pub fn at_capacity(self: *const ConnectionPool) bool {
        return self.connections.count() >= MAX_CONNECTIONS;
    }

    pub fn add(self: *ConnectionPool, conn: *ConnState) !void {
        try self.connections.put(conn.fd, conn);
    }

    pub fn remove(self: *ConnectionPool, fd: i32) void {
        if (self.connections.fetchRemove(fd)) |kv| {
            kv.value.deinit();
        }
    }

    pub fn get(self: *ConnectionPool, fd: i32) ?*ConnState {
        return self.connections.get(fd);
    }
};
```

### 3.3 Accept with Backpressure

```zig
fn accept_connections(
    server_fd: i32,
    epfd: i32,
    pool: *ConnectionPool,
    now_ms: u64,
    allocator: std.mem.Allocator,
) !void {
    // Drain the accept backlog
    while (true) {
        // Backpressure: stop accepting when at capacity
        if (pool.at_capacity()) {
            // Stop monitoring server_fd for new connections temporarily
            // The OS will queue incoming connections in the TCP backlog
            var ev = linux.epoll_event{
                .events = 0, // remove interest in EPOLLIN
                .data = .{ .fd = server_fd },
            };
            _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_MOD, server_fd, &ev);
            std.debug.print("at capacity ({d}), pausing accepts\n",
                .{pool.count()});
            return;
        }

        const client = @as(i32, @intCast(linux.accept4(
            server_fd, null, null,
            linux.SOCK.NONBLOCK | linux.SOCK.CLOEXEC)));

        if (client < 0) {
            const err = linux.getErrno(@bitCast(@as(isize, @intCast(client))));
            if (err == .AGAIN or err == .WOULDBLOCK) break; // no more pending
            return error.AcceptFailed;
        }

        const conn = try ConnState.init(client, allocator, now_ms);
        try pool.add(conn);

        // Register for read events
        var ev = linux.epoll_event{
            .events = linux.EPOLL.IN | linux.EPOLL.RDHUP | linux.EPOLL.ET,
            .data = .{ .fd = client },
        };
        _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_ADD, client, &ev);
    }
}

/// Re-enable accepting when connection count drops below capacity
fn maybe_resume_accepting(
    server_fd: i32,
    epfd: i32,
    pool: *const ConnectionPool,
) void {
    if (!pool.at_capacity()) {
        var ev = linux.epoll_event{
            .events = linux.EPOLL.IN,
            .data = .{ .fd = server_fd },
        };
        _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_MOD, server_fd, &ev);
    }
}
```

---

## Part 4: The Storage Engine

### 4.1 Value Types and Expiry

```zig
const std = @import("std");

const ValueType = union(enum) {
    string: []const u8,
    // Future: list, set, hash, sorted_set...
};

const StoredValue = struct {
    value: ValueType,
    expires_at_ms: ?u64, // null = no expiry
    allocator: std.mem.Allocator,

    pub fn deinit(self: *StoredValue) void {
        switch (self.value) {
            .string => |s| self.allocator.free(s),
        }
    }

    pub fn is_expired(self: *const StoredValue, now_ms: u64) bool {
        if (self.expires_at_ms) |exp| {
            return now_ms >= exp;
        }
        return false;
    }

    pub fn ttl_ms(self: *const StoredValue, now_ms: u64) ?i64 {
        if (self.expires_at_ms) |exp| {
            return @as(i64, @intCast(exp)) - @as(i64, @intCast(now_ms));
        }
        return null;
    }
};

/// The storage engine: in-memory KV store with expiry
pub const Storage = struct {
    data: std.StringHashMap(StoredValue),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Storage {
        return .{
            .data = std.StringHashMap(StoredValue).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Storage) void {
        var it = self.data.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit();
        }
        self.data.deinit();
    }

    /// Remove expired keys. Called periodically by the event loop.
    /// Returns number of keys removed.
    pub fn expire_keys(self: *Storage, now_ms: u64) usize {
        var to_delete = std.ArrayList([]const u8).init(self.allocator);
        defer to_delete.deinit();

        var it = self.data.iterator();
        while (it.next()) |entry| {
            if (entry.value_ptr.is_expired(now_ms)) {
                to_delete.append(entry.key_ptr.*) catch {};
            }
        }

        for (to_delete.items) |key| {
            if (self.data.fetchRemove(key)) |kv| {
                self.allocator.free(kv.key);
                var val = kv.value;
                val.deinit();
            }
        }

        return to_delete.items.len;
    }

    pub fn set(self: *Storage, key: []const u8, value: []const u8,
               expires_at_ms: ?u64) !void {
        const key_copy = try self.allocator.dupe(u8, key);
        const val_copy = try self.allocator.dupe(u8, value);

        // Remove existing key if present
        if (self.data.fetchRemove(key)) |kv| {
            self.allocator.free(kv.key);
            var v = kv.value;
            v.deinit();
        }

        try self.data.put(key_copy, .{
            .value = .{ .string = val_copy },
            .expires_at_ms = expires_at_ms,
            .allocator = self.allocator,
        });
    }

    pub fn get(self: *Storage, key: []const u8,
               now_ms: u64) ?[]const u8 {
        const entry = self.data.getPtr(key) orelse return null;
        if (entry.is_expired(now_ms)) {
            // Lazy deletion: remove on access
            if (self.data.fetchRemove(key)) |kv| {
                self.allocator.free(kv.key);
                var v = kv.value;
                v.deinit();
            }
            return null;
        }
        return switch (entry.value) {
            .string => |s| s,
        };
    }

    pub fn del(self: *Storage, key: []const u8) bool {
        if (self.data.fetchRemove(key)) |kv| {
            self.allocator.free(kv.key);
            var v = kv.value;
            v.deinit();
            return true;
        }
        return false;
    }

    pub fn exists(self: *Storage, key: []const u8, now_ms: u64) bool {
        return self.get(key, now_ms) != null;
    }

    pub fn expire(self: *Storage, key: []const u8,
                  seconds: i64, now_ms: u64) bool {
        const entry = self.data.getPtr(key) orelse return false;
        if (entry.is_expired(now_ms)) return false;
        if (seconds <= 0) {
            // Negative TTL: delete immediately
            _ = self.del(key);
            return true;
        }
        entry.expires_at_ms = now_ms + @as(u64, @intCast(seconds)) * 1000;
        return true;
    }

    pub fn ttl(self: *Storage, key: []const u8, now_ms: u64) i64 {
        const entry = self.data.getPtr(key) orelse return -2; // key doesn't exist
        if (entry.is_expired(now_ms)) return -2;
        return entry.ttl_ms(now_ms) orelse -1; // -1 = no expiry
    }
};
```

---

## Part 5: Command Dispatch

### 5.1 Command Handler Architecture

Each command is a function that takes the argument array and the storage engine, and writes its response to a `RespWriter`.

```zig
pub const CommandArgs = struct {
    args: []const RespValue, // args[0] is the command name
    storage: *Storage,
    writer: *RespWriter,
    now_ms: u64,
    allocator: std.mem.Allocator,
};

pub const CommandFn = *const fn (CommandArgs) anyerror!void;

pub const CommandTable = struct {
    table: std.StringHashMapUnmanaged(CommandFn),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) !CommandTable {
        var ct = CommandTable{
            .table = .{},
            .allocator = allocator,
        };
        // Register all commands (case-insensitive via uppercase)
        try ct.table.put(allocator, "PING",    cmd_ping);
        try ct.table.put(allocator, "ECHO",    cmd_echo);
        try ct.table.put(allocator, "SET",     cmd_set);
        try ct.table.put(allocator, "GET",     cmd_get);
        try ct.table.put(allocator, "DEL",     cmd_del);
        try ct.table.put(allocator, "EXISTS",  cmd_exists);
        try ct.table.put(allocator, "EXPIRE",  cmd_expire);
        try ct.table.put(allocator, "TTL",     cmd_ttl);
        try ct.table.put(allocator, "KEYS",    cmd_keys);
        try ct.table.put(allocator, "COMMAND", cmd_command);
        try ct.table.put(allocator, "QUIT",    cmd_quit);
        return ct;
    }

    pub fn deinit(self: *CommandTable) void {
        self.table.deinit(self.allocator);
    }

    pub fn dispatch(self: *CommandTable, ca: CommandArgs) !void {
        // Extract command name from args[0]
        const cmd_value = ca.args[0];
        const cmd_name = switch (cmd_value) {
            .bulk_string => |s| s orelse {
                try ca.writer.write_error("ERR nil command");
                return;
            },
            .simple_string => |s| s,
            else => {
                try ca.writer.write_error("ERR invalid command type");
                return;
            },
        };

        // Uppercase for case-insensitive matching
        var upper_buf: [64]u8 = undefined;
        if (cmd_name.len > upper_buf.len) {
            try ca.writer.write_error("ERR command name too long");
            return;
        }
        for (cmd_name, 0..) |c, i| {
            upper_buf[i] = std.ascii.toUpper(c);
        }
        const upper = upper_buf[0..cmd_name.len];

        if (self.table.get(upper)) |handler| {
            try handler(ca);
        } else {
            var err_buf: [128]u8 = undefined;
            const err = try std.fmt.bufPrint(&err_buf,
                "ERR unknown command '{s}', with args beginning with: ",
                .{cmd_name});
            try ca.writer.write_error(err);
        }
    }
};
```

### 5.2 Command Implementations

```zig
fn cmd_ping(ca: CommandArgs) !void {
    if (ca.args.len > 1) {
        // PING with message: return the message
        const msg = switch (ca.args[1]) {
            .bulk_string => |s| s orelse "",
            .simple_string => |s| s,
            else => "",
        };
        try ca.writer.write_bulk_string(msg);
    } else {
        try ca.writer.write_simple_string("PONG");
    }
}

fn cmd_echo(ca: CommandArgs) !void {
    if (ca.args.len < 2) {
        try ca.writer.write_error("ERR wrong number of arguments for 'echo'");
        return;
    }
    const msg = switch (ca.args[1]) {
        .bulk_string => |s| s orelse "",
        .simple_string => |s| s,
        else => {
            try ca.writer.write_error("ERR wrong type");
            return;
        },
    };
    try ca.writer.write_bulk_string(msg);
}

fn cmd_set(ca: CommandArgs) !void {
    // SET key value [EX seconds] [PX milliseconds] [NX] [XX]
    if (ca.args.len < 3) {
        try ca.writer.write_error("ERR wrong number of arguments for 'set'");
        return;
    }

    const key = get_string_arg(ca.args[1]) orelse {
        try ca.writer.write_error("ERR invalid key");
        return;
    };
    const value = get_string_arg(ca.args[2]) orelse {
        try ca.writer.write_error("ERR invalid value");
        return;
    };

    var expires_at: ?u64 = null;
    var i: usize = 3;
    while (i < ca.args.len) : (i += 1) {
        const opt = get_string_arg(ca.args[i]) orelse continue;
        var opt_upper: [8]u8 = undefined;
        const opt_len = @min(opt.len, opt_upper.len);
        for (opt[0..opt_len], 0..opt_len) |c, j| {
            opt_upper[j] = std.ascii.toUpper(c);
        }
        const opt_str = opt_upper[0..opt_len];

        if (std.mem.eql(u8, opt_str, "EX")) {
            i += 1;
            if (i >= ca.args.len) {
                try ca.writer.write_error("ERR syntax error");
                return;
            }
            const secs_str = get_string_arg(ca.args[i]) orelse {
                try ca.writer.write_error("ERR value is not integer");
                return;
            };
            const secs = std.fmt.parseInt(u64, secs_str, 10) catch {
                try ca.writer.write_error("ERR value is not integer or out of range");
                return;
            };
            expires_at = ca.now_ms + secs * 1000;
        } else if (std.mem.eql(u8, opt_str, "PX")) {
            i += 1;
            if (i >= ca.args.len) {
                try ca.writer.write_error("ERR syntax error");
                return;
            }
            const ms_str = get_string_arg(ca.args[i]) orelse {
                try ca.writer.write_error("ERR value is not integer");
                return;
            };
            const ms = std.fmt.parseInt(u64, ms_str, 10) catch {
                try ca.writer.write_error("ERR value is not integer or out of range");
                return;
            };
            expires_at = ca.now_ms + ms;
        }
    }

    try ca.storage.set(key, value, expires_at);
    try ca.writer.write_simple_string("OK");
}

fn cmd_get(ca: CommandArgs) !void {
    if (ca.args.len < 2) {
        try ca.writer.write_error("ERR wrong number of arguments for 'get'");
        return;
    }
    const key = get_string_arg(ca.args[1]) orelse {
        try ca.writer.write_error("ERR invalid key");
        return;
    };
    const value = ca.storage.get(key, ca.now_ms);
    try ca.writer.write_bulk_string(value);
}

fn cmd_del(ca: CommandArgs) !void {
    if (ca.args.len < 2) {
        try ca.writer.write_error("ERR wrong number of arguments for 'del'");
        return;
    }
    var deleted: i64 = 0;
    for (ca.args[1..]) |arg| {
        const key = get_string_arg(arg) orelse continue;
        if (ca.storage.del(key)) deleted += 1;
    }
    try ca.writer.write_integer(deleted);
}

fn cmd_exists(ca: CommandArgs) !void {
    if (ca.args.len < 2) {
        try ca.writer.write_error("ERR wrong number of arguments for 'exists'");
        return;
    }
    var count: i64 = 0;
    for (ca.args[1..]) |arg| {
        const key = get_string_arg(arg) orelse continue;
        if (ca.storage.exists(key, ca.now_ms)) count += 1;
    }
    try ca.writer.write_integer(count);
}

fn cmd_expire(ca: CommandArgs) !void {
    if (ca.args.len < 3) {
        try ca.writer.write_error("ERR wrong number of arguments for 'expire'");
        return;
    }
    const key = get_string_arg(ca.args[1]) orelse {
        try ca.writer.write_error("ERR invalid key");
        return;
    };
    const secs_str = get_string_arg(ca.args[2]) orelse {
        try ca.writer.write_error("ERR value is not integer");
        return;
    };
    const secs = std.fmt.parseInt(i64, secs_str, 10) catch {
        try ca.writer.write_error("ERR value is not integer or out of range");
        return;
    };
    const set = ca.storage.expire(key, secs, ca.now_ms);
    try ca.writer.write_integer(if (set) 1 else 0);
}

fn cmd_ttl(ca: CommandArgs) !void {
    if (ca.args.len < 2) {
        try ca.writer.write_error("ERR wrong number of arguments for 'ttl'");
        return;
    }
    const key = get_string_arg(ca.args[1]) orelse {
        try ca.writer.write_error("ERR invalid key");
        return;
    };
    const ttl_ms = ca.storage.ttl(key, ca.now_ms);
    if (ttl_ms < 0) {
        try ca.writer.write_integer(ttl_ms);
    } else {
        try ca.writer.write_integer(@divFloor(ttl_ms, 1000));
    }
}

fn cmd_keys(ca: CommandArgs) !void {
    // KEYS pattern — we implement only "*" (all keys) for simplicity
    var keys = std.ArrayList([]const u8).init(ca.allocator);
    defer keys.deinit();

    var it = ca.storage.data.keyIterator();
    while (it.next()) |key| {
        const entry = ca.storage.data.getPtr(key.*).?;
        if (!entry.is_expired(ca.now_ms)) {
            try keys.append(key.*);
        }
    }

    try ca.writer.write_string_array(keys.items);
}

fn cmd_command(ca: CommandArgs) !void {
    // Minimal COMMAND response — enough for redis-cli to work
    try ca.writer.write_array_header(0);
}

fn cmd_quit(ca: CommandArgs) !void {
    try ca.writer.write_simple_string("OK");
    // Signal to close the connection after this response
    // (handled by the event loop checking the command name)
}

fn get_string_arg(val: RespValue) ?[]const u8 {
    return switch (val) {
        .bulk_string => |s| s,
        .simple_string => |s| s,
        else => null,
    };
}
```

---

## Part 6: The Event Loop

### 6.1 Assembling Everything

```zig
const std = @import("std");
const linux = std.os.linux;

const MAX_EVENTS = 1024;
const PORT: u16 = 6380;
const IDLE_TIMEOUT_MS: u64 = 30_000; // 30 seconds
const EXPIRE_INTERVAL_MS: u64 = 100; // run key expiry every 100ms

pub fn run_server(allocator: std.mem.Allocator) !void {
    // Storage engine
    var storage = Storage.init(allocator);
    defer storage.deinit();

    // Command table
    var commands = try CommandTable.init(allocator);
    defer commands.deinit();

    // Connection pool
    var pool = ConnectionPool.init(allocator);
    defer pool.deinit();

    // Server socket
    const server_fd = try create_server_socket(PORT);
    defer _ = linux.close(server_fd);

    // epoll
    const epfd = @as(i32, @intCast(linux.epoll_create1(linux.EPOLL_CLOEXEC)));
    defer _ = linux.close(epfd);

    var server_event = linux.epoll_event{
        .events = linux.EPOLL.IN,
        .data = .{ .fd = server_fd },
    };
    _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_ADD, server_fd, &server_event);

    std.debug.print("Redis-compatible server on port {d}\n", .{PORT});

    var events: [MAX_EVENTS]linux.epoll_event = undefined;
    var last_expire_ms: u64 = 0;
    var shutdown = false;

    while (!shutdown) {
        const now_ms = current_time_ms();

        // Periodic key expiry
        if (now_ms - last_expire_ms >= EXPIRE_INTERVAL_MS) {
            const expired = storage.expire_keys(now_ms);
            if (expired > 0) {
                std.debug.print("expired {d} keys\n", .{expired});
            }
            last_expire_ms = now_ms;
        }

        // Wait for events: max 100ms timeout for timer-driven work
        const n = @as(usize, @intCast(
            linux.epoll_wait(epfd, &events, MAX_EVENTS, 100)));

        for (events[0..n]) |ev| {
            const fd = ev.data.fd;

            if (fd == server_fd) {
                try accept_connections(server_fd, epfd, &pool,
                    current_time_ms(), allocator);
                continue;
            }

            if (ev.events & (linux.EPOLL.RDHUP | linux.EPOLL.HUP) != 0) {
                _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
                pool.remove(fd);
                maybe_resume_accepting(server_fd, epfd, &pool);
                continue;
            }

            if (ev.events & linux.EPOLL.IN != 0) {
                try handle_readable(fd, epfd, &pool, &storage,
                    &commands, allocator, &shutdown);
                maybe_resume_accepting(server_fd, epfd, &pool);
            }

            if (ev.events & linux.EPOLL.OUT != 0) {
                try handle_writable(fd, epfd, &pool);
            }
        }

        // Idle timeout: close connections inactive for too long
        check_idle_timeouts(epfd, &pool, now_ms, IDLE_TIMEOUT_MS);
    }
}

fn handle_readable(
    fd: i32,
    epfd: i32,
    pool: *ConnectionPool,
    storage: *Storage,
    commands: *CommandTable,
    allocator: std.mem.Allocator,
    shutdown: *bool,
) !void {
    const conn = pool.get(fd) orelse return;
    conn.last_activity_ms = current_time_ms();

    // Read available data into the read buffer
    while (true) {
        const space = conn.read_buf.len - conn.read_len;
        if (space == 0) {
            // Buffer full: close connection (request too large)
            _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
            pool.remove(fd);
            return;
        }

        const n = @as(isize, @bitCast(linux.read(
            fd,
            conn.read_buf[conn.read_len..].ptr,
            space)));

        if (n < 0) {
            const err = linux.getErrno(@bitCast(n));
            if (err == .AGAIN or err == .WOULDBLOCK) break;
            _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
            pool.remove(fd);
            return;
        }
        if (n == 0) {
            // Orderly disconnect
            _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
            pool.remove(fd);
            return;
        }

        conn.read_len += @intCast(n);
    }

    // Parse commands from the read buffer
    var offset: usize = 0;
    while (offset < conn.read_len) {
        const parse = try conn.parser.feed_slice(
            conn.read_buf[offset..conn.read_len]);
        offset += parse.consumed;

        switch (parse.result) {
            .incomplete => break,
            .err => |msg| {
                conn.writer.reset();
                try conn.writer.write_error(msg);
                try conn.queue_response(conn.writer.bytes());
                break;
            },
            .complete => |val| {
                // Dispatch command
                const args = switch (val) {
                    .array => |a| a orelse {
                        try conn.writer.write_error("ERR empty command");
                        break;
                    },
                    else => {
                        try conn.writer.write_error("ERR expected array");
                        break;
                    },
                };

                if (args.len == 0) {
                    try conn.writer.write_error("ERR empty command");
                    break;
                }

                conn.writer.reset();
                try commands.dispatch(.{
                    .args = args,
                    .storage = storage,
                    .writer = &conn.writer,
                    .now_ms = current_time_ms(),
                    .allocator = allocator,
                });

                try conn.queue_response(conn.writer.bytes());
                conn.requests_handled += 1;

                // Check for QUIT command
                const cmd_name = get_string_arg(args[0]) orelse "";
                var upper: [8]u8 = undefined;
                const upper_len = @min(cmd_name.len, upper.len);
                for (cmd_name[0..upper_len], 0..upper_len) |c, i| {
                    upper[i] = std.ascii.toUpper(c);
                }
                if (std.mem.eql(u8, upper[0..upper_len], "QUIT")) {
                    conn.state = .closing;
                }

                if (conn.state == .closing) break;
            },
        }
    }

    // Compact read buffer: move unprocessed bytes to front
    if (offset > 0 and offset < conn.read_len) {
        std.mem.copyForwards(u8,
            conn.read_buf[0..conn.read_len - offset],
            conn.read_buf[offset..conn.read_len]);
    }
    conn.read_len -= offset;

    // Flush pending writes
    const all_sent = try conn.flush();
    if (!all_sent) {
        // Register for EPOLLOUT to continue writing
        var ev = linux.epoll_event{
            .events = linux.EPOLL.IN | linux.EPOLL.OUT | linux.EPOLL.RDHUP,
            .data = .{ .fd = fd },
        };
        _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_MOD, fd, &ev);
        conn.state = .writing;
    } else if (conn.state == .closing) {
        _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
        pool.remove(fd);
    }

    _ = shutdown;
}

fn handle_writable(fd: i32, epfd: i32, pool: *ConnectionPool) !void {
    const conn = pool.get(fd) orelse return;

    const all_sent = try conn.flush();
    if (all_sent) {
        // Back to read-only mode
        var ev = linux.epoll_event{
            .events = linux.EPOLL.IN | linux.EPOLL.RDHUP,
            .data = .{ .fd = fd },
        };
        _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_MOD, fd, &ev);
        conn.state = .reading;

        if (conn.state == .closing) {
            _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
            pool.remove(fd);
        }
    }
}

fn check_idle_timeouts(
    epfd: i32,
    pool: *ConnectionPool,
    now_ms: u64,
    timeout_ms: u64,
) void {
    var to_close = std.ArrayList(i32).init(std.heap.page_allocator);
    defer to_close.deinit();

    var it = pool.connections.valueIterator();
    while (it.next()) |conn| {
        if (now_ms - conn.*.last_activity_ms > timeout_ms) {
            to_close.append(conn.*.fd) catch {};
        }
    }

    for (to_close.items) |fd| {
        _ = linux.epoll_ctl(epfd, linux.EPOLL.CTL_DEL, fd, null);
        pool.remove(fd);
    }
}

fn current_time_ms() u64 {
    var ts: linux.timespec = undefined;
    _ = linux.clock_gettime(linux.CLOCK.MONOTONIC, &ts);
    return @as(u64, @intCast(ts.sec)) * 1000 +
           @as(u64, @intCast(ts.nsec)) / 1_000_000;
}
```

---

## Part 7: Graceful Shutdown

### 7.1 Signal Handling

Production servers must handle `SIGTERM` and `SIGINT` gracefully: stop accepting new connections, finish processing in-flight requests, then exit cleanly.

```zig
const std = @import("std");
const linux = std.os.linux;

/// Global shutdown flag — set by signal handler
var g_shutdown = std.atomic.Value(bool).init(false);

fn signal_handler(sig: c_int) callconv(.C) void {
    _ = sig;
    g_shutdown.store(true, .release);
}

pub fn setup_signals() void {
    var sa: linux.Sigaction = std.mem.zeroes(linux.Sigaction);
    sa.handler = .{ .handler = signal_handler };
    _ = linux.sigaction(linux.SIG.TERM, &sa, null);
    _ = linux.sigaction(linux.SIG.INT, &sa, null);
}
```

In the event loop, check `g_shutdown.load(.acquire)` each iteration. When set:
1. Stop the `epoll_ctl_add` for new connections (stop accepting)
2. Drain remaining read events (finish in-flight requests)
3. Flush all write buffers
4. Exit the loop

### 7.2 The Main Entry Point

```zig
pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    setup_signals();

    std.debug.print("Starting ZigCache server on port {d}\n", .{PORT});
    std.debug.print("Connect with: redis-cli -p {d}\n", .{PORT});

    try run_server(allocator);

    std.debug.print("Server shutdown complete\n", .{});
}
```

---

## Part 8: Benchmarking Against Redis

### 8.1 redis-benchmark

Redis ships with `redis-benchmark`, a load testing tool that uses the RESP protocol. Because our server implements RESP, it works identically.

```bash
# Install redis-tools (includes redis-benchmark)
sudo apt install redis-tools

# Start our server
./zig-cache -O ReleaseFast

# Basic benchmark: 100k requests, 50 concurrent connections, pipeline=1
redis-benchmark -p 6380 -n 100000 -c 50 -t ping,set,get

# Pipeline benchmark: 16 commands per pipeline (tests batching)
redis-benchmark -p 6380 -n 100000 -c 50 --pipeline 16 -t set,get

# Compare against real Redis on port 6379
redis-benchmark -p 6379 -n 100000 -c 50 -t ping,set,get
redis-benchmark -p 6380 -n 100000 -c 50 -t ping,set,get
```

Expected output format:
```
====== PING_INLINE ======
  100000 requests completed in 1.23 seconds
  50 parallel clients
  3 bytes payload
  keep alive: 1

99.99% <= 1 milliseconds
100.00% <= 2 milliseconds
81300.81 requests per second
```

### 8.2 Profiling with perf

```bash
# Compile with frame pointers for good profiling
zig build-exe src/main.zig -O ReleaseSafe -fno-omit-frame-pointer

# Run server in background
./main &
SERVER_PID=$!

# Profile while running benchmark
perf record -F 99 -g --call-graph=fp -p $SERVER_PID sleep 10 &
redis-benchmark -p 6380 -n 1000000 -c 100 -t set,get
wait

# Generate flame graph
perf script | stackcollapse-perf.pl | flamegraph.pl > server-profile.svg
```

Look for:
- **RESP parser time:** Is parsing dominating? If so, consider SIMD optimizations for CRLF detection.
- **Hash map time:** Is storage lookup dominating? The `std.StringHashMap` should be fast for short keys.
- **epoll_wait time:** If this is significant, you are spending time in the kernel — expected for I/O-bound work.
- **write/send time:** If write syscalls dominate, add write coalescing (batch multiple responses before calling `write`).

---

## Part 9: The Module Project — ZigCache

### Putting It Together

Assemble all the components from Parts 1-7 into a complete, benchmarkable server called `ZigCache`. The full project structure:

```
zigcache/
├── build.zig
└── src/
    ├── main.zig          ← entry point, signal handling
    ├── server.zig        ← event loop, accept, connection lifecycle
    ├── connection.zig    ← ConnState, read/write buffering, backpressure
    ├── resp.zig          ← RespParser, RespWriter, RespValue
    ├── storage.zig       ← Storage engine, expiry
    ├── commands.zig      ← CommandTable, all command handlers
    └── timer.zig         ← TimerWheel for idle timeouts
```

### Acceptance Criteria

The server passes all of these:

```bash
# Basic connectivity
redis-cli -p 6380 PING             # → PONG
redis-cli -p 6380 PING "hello"     # → "hello"
redis-cli -p 6380 ECHO "world"     # → "world"

# String operations
redis-cli -p 6380 SET foo bar      # → OK
redis-cli -p 6380 GET foo          # → "bar"
redis-cli -p 6380 GET nonexistent  # → (nil)
redis-cli -p 6380 DEL foo          # → (integer) 1
redis-cli -p 6380 GET foo          # → (nil)

# Multiple arguments
redis-cli -p 6380 SET k1 v1
redis-cli -p 6380 SET k2 v2
redis-cli -p 6380 DEL k1 k2       # → (integer) 2
redis-cli -p 6380 EXISTS k1 k2    # → (integer) 0

# Expiry
redis-cli -p 6380 SET temp value EX 2
redis-cli -p 6380 TTL temp        # → (integer) 2 (approximately)
sleep 3
redis-cli -p 6380 GET temp        # → (nil)
redis-cli -p 6380 TTL temp        # → (integer) -2

# KEYS
redis-cli -p 6380 SET a 1
redis-cli -p 6380 SET b 2
redis-cli -p 6380 KEYS "*"        # → 1) "a" 2) "b" (order may vary)

# Benchmark
redis-benchmark -p 6380 -n 100000 -c 50 -t ping,set,get
```

### Extension Challenges

1. **Pipelining:** Redis clients send multiple commands without waiting for each response. Verify your server handles pipelined commands correctly by testing with `redis-benchmark --pipeline 16`.

2. **Pub/Sub:** Implement `SUBSCRIBE`, `UNSUBSCRIBE`, and `PUBLISH`. This requires tracking subscribed channels per connection and broadcasting messages to all subscribers — an interesting extension to the connection model.

3. **Persistence:** Add an append-only log (AOF) using the patterns from Module 9. Every `SET`, `DEL`, and `EXPIRE` command writes to the log. On startup, replay the log to restore state.

4. **Multi-threading:** Implement the multi-reactor pattern: N event loops, each on a dedicated thread pinned to a CPU core. The `accept` socket is shared with `SO_REUSEPORT` — the OS distributes connections across all N loops. Measure the scalability improvement on multi-core hardware.

---

## Summary

This module has built the complete picture of a production network server — not as separate components but as an integrated system.

**The Reactor pattern** — single-threaded event loop with `epoll` — is the architecture that powers Redis, nginx, and most other high-performance servers. It works because I/O is the bottleneck, not CPU, and a single thread can handle thousands of I/O-bound connections by never blocking.

**The RESP2 protocol** is a clean example of real-world protocol design: length-prefixed binary safety, five simple types covering all use cases, simple enough to implement from scratch, fast enough to parse at millions of operations per second.

**Connection management** requires explicit backpressure — stopping accepts when at capacity — and idle timeout enforcement. Without these, a server under load either exhausts memory or holds connections forever.

**Command dispatch** through a hash table of function pointers is the production pattern: O(1) lookup, easy extension, clean separation between parsing and execution.

**Graceful shutdown** is not optional in production. Signal handling, drain-on-exit, and clean resource release are the difference between a server that can be deployed and one that can only be killed.

**Benchmarking against Redis** gives you a real reference point. The gap between a naive implementation and Redis reveals where optimization opportunities exist — and `perf` flame graphs show exactly where CPU time goes.

---

## What's Next

Module 13 — The Network Stack — goes below the application layer. You have built a server that uses TCP sockets. Module 13 teaches what TCP actually is, how the network stack is organized, how IP routing works, and how to implement protocols at lower levels — all the way down to raw sockets and packet construction.

---

## Reference: ZigCache Command Summary

```
Command                Action                         Response type
────────────────────────────────────────────────────────────────────
PING [msg]             Returns PONG or msg             +PONG / $bulk
ECHO msg               Returns msg                     $bulk
SET key val [EX n]     Set key=val, optional TTL       +OK
GET key                Get value or nil                $bulk / $-1
DEL key [key...]       Delete keys                     :n (count)
EXISTS key [key...]    Count existing keys             :n (count)
EXPIRE key seconds     Set TTL in seconds              :0/:1
TTL key                Get TTL in seconds              :n/-1/-2
KEYS pattern           List matching keys              *array
COMMAND                Command introspection           *[] (empty)
QUIT                   Close connection                +OK

Response codes:
  +  = simple string (success messages)
  -  = error (all errors)
  :  = integer
  $  = bulk string ($-1 = nil)
  *  = array (*-1 = nil array)
```

---

*End of Module 12*
