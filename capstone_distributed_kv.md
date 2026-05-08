# Final Capstone: Build a Distributed Key-Value Store

## The Craft of Systems Programming — Teaching Material

---

> *"Every module in this curriculum has been preparation for this. Not preparation for an exam. Preparation for building a real system — one that you can point to and say: I understand every line of this, every decision, every tradeoff, down to the machine instructions."*

---

## Overview

The final capstone integrates every concept from all 18 modules into a single, non-trivial distributed system. You will build **ZigKV** — a distributed, persistent, replicated key-value store that is compatible with the Redis protocol.

This is not a toy. When you are done, ZigKV will:
- Accept connections from any Redis client (`redis-cli`, any Redis library)
- Replicate writes across a cluster using Raft consensus
- Persist data to disk and recover correctly after crashes
- Handle node failures and network partitions gracefully
- Reject traffic gracefully under overload
- Serve 50,000+ operations per second on a three-node cluster

Every system in the curriculum lives inside ZigKV. The binary protocol parser from Module 2 and Module 14 parses client messages at the bit level. The epoll event loop from Module 11 handles thousands of concurrent connections. The Raft consensus engine from Module 16 replicates writes. The MVCC storage layer from Module 17 manages concurrent reads and writes. The circuit breakers and rate limiters from Module 18 prevent cascading failure.

---

## Learning Objectives for the Capstone

By the end of the capstone, you will have demonstrated:

- End-to-end ownership of a production-quality distributed system
- The ability to integrate independently-developed components into a coherent whole
- Systematic performance profiling and bottleneck identification using tools from Module 10
- Correct behavior under adversarial conditions: node crashes, network partitions, slow clients
- Written documentation of architectural decisions and tradeoffs

---

## Part 1: System Architecture

### 1.1 The Full Picture

```
Clients (redis-cli, redis-benchmark, custom clients)
         │ TCP, RESP2 protocol (Module 12, 13, 14)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ZigKV Node                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Network Layer (Modules 11-12)                          │    │
│  │  • epoll event loop (10,000 concurrent connections)     │    │
│  │  • RESP2 parser / serializer                            │    │
│  │  • Rate limiter (token bucket per client)               │    │
│  │  • Load shedding (priority-based admission)             │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│  ┌──────────────────────────▼──────────────────────────────┐    │
│  │  Command Router (Module 18)                             │    │
│  │  • If leader: execute command                           │    │
│  │  • If follower: redirect to leader                      │    │
│  │  • Consistent hashing for multi-shard clusters          │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│  ┌──────────────────────────▼──────────────────────────────┐    │
│  │  Raft Consensus Layer (Module 16)                       │    │
│  │  • Leader election (randomized timeouts, term tracking) │    │
│  │  • Log replication (AppendEntries, majority commit)     │    │
│  │  • Safety (persistence, Figure-8 rule)                  │    │
│  │  • ZigWire transport (Module 14)                        │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                   │
│  ┌──────────────────────────▼──────────────────────────────┐    │
│  │  Storage Engine (Modules 9, 17)                         │    │
│  │  • Append-only log (WAL, Module 9)                      │    │
│  │  • In-memory index (HashMap<key, log_offset>)           │    │
│  │  • MVCC for concurrent reads (Module 17)                │    │
│  │  • Compaction (background, log-structured)              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Durable Storage                                        │    │
│  │  • raft_state.bin (term, voted_for, log)                │    │
│  │  • data.log (append-only KV log)                        │    │
│  │  • snapshot.bin (compacted state, optional)             │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
         │ ZigWire protocol (Module 14)
         ▼
  Other ZigKV nodes (Raft peers)
```

### 1.2 Module-to-Component Mapping

Every module in the curriculum contributes a concrete component:

| Module | Component in ZigKV |
|--------|-------------------|
| 1 — Data Representation | Binary log entry format, integer encoding |
| 2 — The Processor | Understanding assembly output of hot paths |
| 3 — Programs | Process model, signal handling, fd management |
| 4 — Memory | DebugAllocator in dev, smp_allocator in prod |
| 5 — State Machines | RESP parser, Raft role state machine |
| 6 — Memory Hierarchy | Storage engine cache layout (hot/cold split) |
| 7 — Scheduling | Thread pool for background compaction |
| 8 — Concurrency | Mutex for storage, atomics for counters |
| 9 — File Systems | WAL, fsync discipline, mmap index |
| 10 — Performance | Flame graph profiling, perf stat analysis |
| 11 — Async I/O | epoll event loop, non-blocking sockets |
| 12 — Network Server | RESP protocol, connection pool, backpressure |
| 13 — Network Stack | TCP socket options, tcpdump debugging |
| 14 — Protocol Design | ZigWire for Raft RPCs |
| 15 — Distributed Systems | CAP choice (CP), Lamport clocks for ordering |
| 16 — Raft | Leader election, log replication, persistence |
| 17 — Transactions | MVCC reads, 2PC for multi-key ops |
| 18 — Systems Design | Rate limiting, circuit breakers, load shedding |

---

## Part 2: Project Structure

### 2.1 Directory Layout

```
zigkv/
├── build.zig                  ← Zig build system configuration
├── build.zig.zon              ← Dependencies
├── README.md                  ← Architecture documentation
├── DESIGN.md                  ← Design decisions and tradeoffs
│
├── src/
│   ├── main.zig               ← Entry point, CLI argument parsing
│   ├── config.zig             ← Configuration: ports, timeouts, tuning
│   │
│   ├── network/
│   │   ├── event_loop.zig     ← epoll event loop (Module 11)
│   │   ├── connection.zig     ← Connection state, read/write buffers
│   │   ├── resp.zig           ← RESP2 parser and serializer (Module 12)
│   │   └── server.zig         ← Accept loop, connection lifecycle
│   │
│   ├── protocol/
│   │   ├── zigwire.zig        ← ZigWire frame reader/writer (Module 14)
│   │   └── handshake.zig      ← ZigWire HELLO/HELLO_ACK
│   │
│   ├── raft/
│   │   ├── node.zig           ← RaftNode: state, roles, term (Module 16)
│   │   ├── election.zig       ← RequestVote, randomized timeouts
│   │   ├── replication.zig    ← AppendEntries, commit index
│   │   ├── persistence.zig    ← Durable state: term, vote, log
│   │   └── server.zig         ← Raft RPC server over ZigWire
│   │
│   ├── storage/
│   │   ├── log.zig            ← Append-only log (Module 9)
│   │   ├── index.zig          ← In-memory HashMap index
│   │   ├── mvcc.zig           ← MVCC version chains (Module 17)
│   │   ├── engine.zig         ← Storage engine: get/set/del
│   │   └── compaction.zig     ← Background log compaction
│   │
│   ├── commands/
│   │   ├── dispatch.zig       ← Command routing table
│   │   ├── kv.zig             ← SET, GET, DEL, EXISTS, EXPIRE, TTL
│   │   ├── server_info.zig    ← PING, INFO, COMMAND, QUIT
│   │   └── transactions.zig   ← MULTI, EXEC, WATCH
│   │
│   ├── safety/
│   │   ├── rate_limiter.zig   ← Token bucket per client (Module 18)
│   │   ├── circuit_breaker.zig← Circuit breaker for dependencies
│   │   └── admission.zig      ← Priority-based load shedding
│   │
│   └── util/
│       ├── timer_wheel.zig    ← Timer wheel for timeouts (Module 11)
│       ├── consistent_hash.zig← Hash ring (Module 18)
│       └── metrics.zig        ← Counters, histograms for observability
│
└── tests/
    ├── unit/
    │   ├── resp_test.zig      ← RESP parser tests
    │   ├── raft_test.zig      ← Raft correctness tests
    │   ├── storage_test.zig   ← Storage engine tests
    │   └── mvcc_test.zig      ← MVCC concurrency tests
    └── integration/
        ├── cluster_test.zig   ← Multi-node cluster tests
        ├── fault_test.zig     ← Crash and partition tests
        └── perf_test.zig      ← Performance benchmarks
```

### 2.2 Build Configuration

```zig
// build.zig
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Main server binary
    const server = b.addExecutable(.{
        .name = "zigkv",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(server);

    // Unit tests
    const unit_tests = b.addTest(.{
        .root_source_file = b.path("tests/unit/resp_test.zig"),
        .target = target,
        .optimize = optimize,
    });
    const run_unit_tests = b.addRunArtifact(unit_tests);

    // Integration tests (require a running cluster)
    const integration_tests = b.addTest(.{
        .root_source_file = b.path("tests/integration/cluster_test.zig"),
        .target = target,
        .optimize = optimize,
    });
    const run_integration_tests = b.addRunArtifact(integration_tests);

    // Test step
    const test_step = b.step("test", "Run all tests");
    test_step.dependOn(&run_unit_tests.step);

    const integration_step = b.step("test-integration", "Run integration tests");
    integration_step.dependOn(&run_integration_tests.step);
}
```

---

## Part 3: The Storage Engine

### 3.1 Log Format

Each log entry is a fixed-size header followed by variable-length key and value:

```
Log Entry Wire Format:
┌──────────────────────────────────────────────────────┐
│  Magic    (4 bytes): 0x4B564C47 "GKVL"               │
│  CRC32    (4 bytes): checksum of everything after it  │
│  Timestamp(8 bytes): write timestamp (monotonic)     │
│  Op Type  (1 byte):  0x01=SET, 0x02=DEL              │
│  Key Len  (4 bytes): key length in bytes              │
│  Val Len  (4 bytes): value length in bytes (0 for DEL)│
│  Key      (Key Len bytes)                             │
│  Value    (Val Len bytes)                             │
└──────────────────────────────────────────────────────┘
```

The CRC32 checksum protects against partial writes and corruption. On startup, the log is scanned sequentially; entries with invalid checksums indicate an incomplete write (crash during write) and are truncated.

```zig
const std = @import("std");

pub const LOG_MAGIC: u32 = 0x4B564C47; // "GKVL"

pub const LogOp = enum(u8) {
    set = 0x01,
    del = 0x02,
};

pub const LogEntryHeader = extern struct {
    magic:     u32,
    crc32:     u32,
    timestamp: u64,
    op:        u8,
    key_len:   u32,
    val_len:   u32,

    comptime { std.debug.assert(@sizeOf(LogEntryHeader) == 25); }
};

pub const AppendLog = struct {
    file: std.fs.File,
    write_pos: u64,
    allocator: std.mem.Allocator,

    pub fn init(path: []const u8, allocator: std.mem.Allocator) !AppendLog {
        const file = try std.fs.cwd().createFile(path, .{
            .read = true,
            .truncate = false,
        });
        const stat = try file.stat();
        return .{
            .file = file,
            .write_pos = stat.size,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *AppendLog) void {
        self.file.close();
    }

    pub fn append_set(self: *AppendLog, key: []const u8,
                       value: []const u8, ts: u64) !u64 {
        return self.append_entry(.set, key, value, ts);
    }

    pub fn append_del(self: *AppendLog, key: []const u8, ts: u64) !u64 {
        return self.append_entry(.del, key, &[_]u8{}, ts);
    }

    fn append_entry(self: *AppendLog, op: LogOp,
                    key: []const u8, value: []const u8, ts: u64) !u64 {
        const offset = self.write_pos;

        var hdr = LogEntryHeader{
            .magic     = LOG_MAGIC,
            .crc32     = 0,
            .timestamp = ts,
            .op        = @intFromEnum(op),
            .key_len   = @intCast(key.len),
            .val_len   = @intCast(value.len),
        };

        // Compute CRC over everything after the CRC field
        var crc = std.hash.Crc32.init();
        crc.update(std.mem.asBytes(&hdr)[8..]); // skip magic and crc fields
        crc.update(key);
        crc.update(value);
        hdr.crc32 = crc.final();

        // Write atomically: seek to end, write all bytes, fsync
        try self.file.seekTo(self.write_pos);
        try self.file.writeAll(std.mem.asBytes(&hdr));
        try self.file.writeAll(key);
        try self.file.writeAll(value);
        try self.file.sync(); // MUST fsync before acknowledging write

        self.write_pos += @sizeOf(LogEntryHeader) + key.len + value.len;
        return offset;
    }

    /// Rebuild the in-memory index by scanning the log from the beginning.
    /// Returns the number of valid entries found.
    pub fn rebuild_index(self: *AppendLog,
                          index: *std.StringHashMap(u64)) !usize {
        try self.file.seekTo(0);
        var count: usize = 0;
        var pos: u64 = 0;

        while (true) {
            var hdr: LogEntryHeader = undefined;
            const n = self.file.read(std.mem.asBytes(&hdr)) catch break;
            if (n < @sizeOf(LogEntryHeader)) break;

            if (hdr.magic != LOG_MAGIC) break; // corrupted or truncated

            // Read key
            const key = try self.allocator.alloc(u8, hdr.key_len);
            defer self.allocator.free(key);
            _ = try self.file.read(key);

            // Skip value
            try self.file.seekBy(hdr.val_len);

            const entry_size = @sizeOf(LogEntryHeader) + hdr.key_len + hdr.val_len;

            switch (@as(LogOp, @enumFromInt(hdr.op))) {
                .set => {
                    const key_copy = try self.allocator.dupe(u8, key);
                    // Remove old entry if it exists
                    if (index.fetchRemove(key)) |old| {
                        self.allocator.free(old.key);
                    }
                    try index.put(key_copy, pos);
                },
                .del => {
                    if (index.fetchRemove(key)) |old| {
                        self.allocator.free(old.key);
                    }
                },
            }

            pos += entry_size;
            count += 1;
        }

        // Truncate any partial entry at the end (crash during write)
        try self.file.setEndPos(pos);
        self.write_pos = pos;

        return count;
    }
};
```

### 3.2 The Index

```zig
pub const StorageEngine = struct {
    log: AppendLog,
    /// Maps key → file offset of the most recent log entry for that key
    index: std.StringHashMap(u64),
    /// Monotonically increasing write timestamp
    write_ts: u64,
    mu: std.Thread.RwLock,
    allocator: std.mem.Allocator,

    pub fn init(log_path: []const u8, allocator: std.mem.Allocator) !StorageEngine {
        var engine = StorageEngine{
            .log = try AppendLog.init(log_path, allocator),
            .index = std.StringHashMap(u64).init(allocator),
            .write_ts = 0,
            .mu = .{},
            .allocator = allocator,
        };
        // Rebuild index from existing log
        const count = try engine.log.rebuild_index(&engine.index);
        std.debug.print("Storage: recovered {d} keys from log\n", .{count});
        return engine;
    }

    pub fn deinit(self: *StorageEngine) void {
        var it = self.index.keyIterator();
        while (it.next()) |key| self.allocator.free(key.*);
        self.index.deinit();
        self.log.deinit();
    }

    pub fn set(self: *StorageEngine, key: []const u8,
               value: []const u8) !void {
        self.mu.lock();
        defer self.mu.unlock();

        self.write_ts += 1;
        const offset = try self.log.append_set(key, value, self.write_ts);

        // Update index
        const key_copy = try self.allocator.dupe(u8, key);
        if (self.index.fetchRemove(key)) |old| {
            self.allocator.free(old.key);
        }
        try self.index.put(key_copy, offset);
    }

    pub fn get(self: *StorageEngine, key: []const u8,
               buf: []u8) !?[]const u8 {
        self.mu.lockShared();
        defer self.mu.unlockShared();

        const offset = self.index.get(key) orelse return null;

        // Read the entry from the log at the stored offset
        try self.log.file.seekTo(offset);
        var hdr: LogEntryHeader = undefined;
        _ = try self.log.file.read(std.mem.asBytes(&hdr));

        // Skip key bytes
        try self.log.file.seekBy(hdr.key_len);

        // Read value
        const val_len = hdr.val_len;
        if (val_len > buf.len) return error.BufferTooSmall;
        _ = try self.log.file.read(buf[0..val_len]);
        return buf[0..val_len];
    }

    pub fn del(self: *StorageEngine, key: []const u8) !bool {
        self.mu.lock();
        defer self.mu.unlock();

        if (!self.index.contains(key)) return false;

        self.write_ts += 1;
        _ = try self.log.append_del(key, self.write_ts);

        if (self.index.fetchRemove(key)) |old| {
            self.allocator.free(old.key);
        }
        return true;
    }

    pub fn key_count(self: *StorageEngine) usize {
        self.mu.lockShared();
        defer self.mu.unlockShared();
        return self.index.count();
    }
};
```

---

## Part 4: The Raft Integration

### 4.1 Connecting Raft to the Storage Engine

The Raft log stores serialized commands. When an entry is committed, the storage engine applies it. This is the state machine application interface from Module 16:

```zig
pub const Command = union(enum) {
    set: struct { key: []const u8, value: []const u8, ttl_ms: ?u64 },
    del: struct { key: []const u8 },
    noop,  // leader sends this on election to commit previous-term entries

    pub fn serialize(self: Command, allocator: std.mem.Allocator) ![]u8 {
        var buf = std.ArrayList(u8).init(allocator);
        switch (self) {
            .set => |s| {
                try buf.append(1);
                var kl: [4]u8 = undefined; var vl: [4]u8 = undefined;
                std.mem.writeInt(u32, &kl, @intCast(s.key.len), .little);
                std.mem.writeInt(u32, &vl, @intCast(s.value.len), .little);
                try buf.appendSlice(&kl);
                try buf.appendSlice(s.key);
                try buf.appendSlice(&vl);
                try buf.appendSlice(s.value);
                if (s.ttl_ms) |ttl| {
                    try buf.append(1);
                    var tb: [8]u8 = undefined;
                    std.mem.writeInt(u64, &tb, ttl, .little);
                    try buf.appendSlice(&tb);
                } else {
                    try buf.append(0);
                }
            },
            .del => |d| {
                try buf.append(2);
                var kl: [4]u8 = undefined;
                std.mem.writeInt(u32, &kl, @intCast(d.key.len), .little);
                try buf.appendSlice(&kl);
                try buf.appendSlice(d.key);
            },
            .noop => try buf.append(0),
        }
        return buf.toOwnedSlice();
    }

    pub fn deserialize(data: []const u8, allocator: std.mem.Allocator) !Command {
        if (data.len == 0) return .noop;
        switch (data[0]) {
            0 => return .noop,
            1 => {
                const kl = std.mem.readInt(u32, data[1..5], .little);
                const key = data[5..][0..kl];
                const vl = std.mem.readInt(u32, data[5+kl..][0..4], .little);
                const value = data[9+kl..][0..vl];
                const has_ttl = data[9+kl+vl];
                const ttl_ms: ?u64 = if (has_ttl == 1)
                    std.mem.readInt(u64, data[10+kl+vl..][0..8], .little)
                else null;

                return .{ .set = .{
                    .key = try allocator.dupe(u8, key),
                    .value = try allocator.dupe(u8, value),
                    .ttl_ms = ttl_ms,
                }};
            },
            2 => {
                const kl = std.mem.readInt(u32, data[1..5], .little);
                const key = data[5..][0..kl];
                return .{ .del = .{
                    .key = try allocator.dupe(u8, key),
                }};
            },
            else => return error.UnknownCommand,
        }
    }
};

/// Apply a committed Raft log entry to the storage engine
pub fn apply_command(engine: *StorageEngine, cmd_bytes: []const u8,
                      allocator: std.mem.Allocator) !void {
    const cmd = try Command.deserialize(cmd_bytes, allocator);
    defer switch (cmd) {
        .set => |s| { allocator.free(s.key); allocator.free(s.value); },
        .del => |d| allocator.free(d.key),
        .noop => {},
    };

    switch (cmd) {
        .set => |s| try engine.set(s.key, s.value),
        .del => |d| _ = try engine.del(d.key),
        .noop => {},
    }
}
```

### 4.2 The Write Path: Client → Raft → Storage

When a client sends `SET foo bar`:

1. **Network layer** receives the RESP-encoded command, parses it
2. **Command router** checks: am I the Raft leader?
   - If not: redirect client to the current leader
   - If yes: proceed
3. **Rate limiter** checks: is this client within their quota?
   - If not: respond `429` (or Redis error)
4. **Admission controller** checks: is the system capacity available?
   - If not: respond with load-shedding error
5. **Raft layer** appends a `SET foo bar` command to the log
6. **Raft layer** sends `AppendEntries` to all followers
7. **Raft layer** waits for majority acknowledgment
8. **Raft layer** advances `commit_index`; notifies waiting client requests
9. **Storage engine** applies the command: writes to WAL, updates index
10. **Network layer** sends `+OK\r\n` to the client

The read path is simpler for eventual consistency:
1. Command router receives `GET foo`
2. Storage engine reads from index → log → value
3. Respond immediately (no Raft round-trip needed for reads)

For linearizable reads (required for strong consistency):
1. Leader sends a heartbeat to confirm still leader
2. Wait for state machine to apply all entries up to `commit_index`
3. Read and respond

---

## Part 5: Configuration and Startup

### 5.1 Command-Line Interface

```zig
// Usage:
// zigkv --id 0 --port 6380 --raft-port 7380 --peers 1:7381,2:7382 --data-dir ./data/0
// zigkv --id 1 --port 6381 --raft-port 7381 --peers 0:7380,2:7382 --data-dir ./data/1
// zigkv --id 2 --port 6382 --raft-port 7382 --peers 0:7380,1:7381 --data-dir ./data/2

pub const Config = struct {
    // Node identity
    node_id:    u32,
    client_port: u16,   // RESP protocol port (Redis-compatible)
    raft_port:   u16,   // ZigWire protocol port (Raft RPCs)
    data_dir:    []const u8,
    peers:       []PeerConfig,

    // Raft tuning
    election_timeout_min_ms: u64 = 150,
    election_timeout_max_ms: u64 = 300,
    heartbeat_interval_ms:   u64 = 50,

    // Network tuning
    max_connections:  u32 = 10_000,
    read_timeout_ms:  u64 = 30_000,

    // Rate limiting
    rate_limit_per_client_rps: f64 = 10_000.0,
    rate_limit_burst:          f64 = 1_000.0,

    // Compaction
    compaction_threshold_mb: u64 = 100,

    pub const PeerConfig = struct {
        id:        u32,
        raft_addr: std.net.Address,
    };

    pub fn parse(args: []const []const u8, allocator: std.mem.Allocator) !Config {
        var cfg = Config{
            .node_id = 0,
            .client_port = 6379,
            .raft_port = 7379,
            .data_dir = "./data",
            .peers = &[_]PeerConfig{},
        };

        var i: usize = 0;
        while (i < args.len) : (i += 1) {
            if (std.mem.eql(u8, args[i], "--id")) {
                i += 1;
                cfg.node_id = try std.fmt.parseInt(u32, args[i], 10);
            } else if (std.mem.eql(u8, args[i], "--port")) {
                i += 1;
                cfg.client_port = try std.fmt.parseInt(u16, args[i], 10);
            } else if (std.mem.eql(u8, args[i], "--raft-port")) {
                i += 1;
                cfg.raft_port = try std.fmt.parseInt(u16, args[i], 10);
            } else if (std.mem.eql(u8, args[i], "--data-dir")) {
                i += 1;
                cfg.data_dir = try allocator.dupe(u8, args[i]);
            }
            // ... parse --peers
        }
        return cfg;
    }
};

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    const cfg = try Config.parse(args[1..], allocator);

    // Set up signal handling for graceful shutdown
    setup_signals();

    // Initialize components
    var storage = try StorageEngine.init(
        try std.fs.path.join(allocator, &.{cfg.data_dir, "data.log"}),
        allocator);
    defer storage.deinit();

    var raft = try RaftNode.init(cfg.node_id, @intCast(cfg.peers.len + 1), allocator);
    defer raft.deinit();

    // Load persisted Raft state
    _ = try raft.load_persistent_state();

    // Start Raft RPC server (ZigWire on raft_port)
    // Start client server (RESP on client_port)
    // Run event loop

    std.debug.print("ZigKV node {d} started\n", .{cfg.node_id});
    std.debug.print("  Client port: {d} (RESP/Redis-compatible)\n",
        .{cfg.client_port});
    std.debug.print("  Raft port:   {d} (ZigWire)\n", .{cfg.raft_port});
    std.debug.print("  Data dir:    {s}\n", .{cfg.data_dir});
    std.debug.print("  Cluster size: {d} nodes\n", .{cfg.peers.len + 1});
}
```

---

## Part 6: Testing Requirements

### 6.1 Unit Tests

Every component must have unit tests. The following are the minimum required:

**RESP Parser (`tests/unit/resp_test.zig`):**
```zig
test "parse PING command" {
    // Feed "*1\r\n$4\r\nPING\r\n" one byte at a time
    // Verify complete parse after final byte
}

test "parse fragmented SET command" {
    // Feed "*3\r\n$3\r\nSET\r\n" in one call
    // Feed "$3\r\nfoo\r\n$3\r\nbar\r\n" in second call
    // Verify complete parse after second call
}

test "nil bulk string" { /* $-1\r\n */ }
test "nested array" { /* *2\r\n*2\r\n:1\r\n:2\r\n:3\r\n */ }
test "error response" { /* -ERR something went wrong\r\n */ }
```

**Raft State Machine (`tests/unit/raft_test.zig`):**
```zig
test "follower converts to candidate on election timeout" { ... }
test "candidate votes for itself" { ... }
test "candidate wins with majority votes" { ... }
test "candidate loses with minority votes" { ... }
test "leader sends heartbeats" { ... }
test "follower rejects vote for lower term" { ... }
test "follower rejects vote for less up-to-date log" { ... }
test "AppendEntries consistency check passes" { ... }
test "AppendEntries rejects mismatched prev_log_term" { ... }
test "commit_index advances when majority replicates" { ... }
test "no commit for old-term entries (Figure-8 safety)" { ... }
```

**Storage Engine (`tests/unit/storage_test.zig`):**
```zig
test "set and get" { ... }
test "set overwrites previous value" { ... }
test "del removes key" { ... }
test "get returns nil for missing key" { ... }
test "log recovery after simulated crash" {
    // Write entries, close without syncing last entry (truncate last bytes)
    // Reopen and verify: all entries before truncation are recovered
    // Truncated entry is silently discarded
}
test "concurrent reads do not block writes" { ... }
```

### 6.2 Integration Tests

**Cluster formation (`tests/integration/cluster_test.zig`):**
```zig
test "three-node cluster elects a leader" {
    // Start 3 nodes in the same process using the simulator
    // Wait 500ms
    // Verify exactly one leader
}

test "leader election after crash" {
    // Start 3 nodes
    // Kill the leader
    // Wait 600ms
    // Verify new leader elected from remaining nodes
}

test "writes replicated to all nodes" {
    // Start 3 nodes
    // Write 100 keys via leader
    // Verify all 3 nodes have the same data
}

test "reads work after leader change" {
    // Write "foo" = "bar"
    // Kill leader
    // Wait for new election
    // Read "foo" from any surviving node
    // Verify "bar" returned
}
```

**Fault tolerance (`tests/integration/fault_test.zig`):**
```zig
test "data survives leader crash" {
    // Write data
    // Kill leader (SIGKILL — no graceful shutdown)
    // Restart on same node
    // Verify data is still present
}

test "no split brain during partition" {
    // Partition: isolate leader from 2 followers
    // Write to minority (should fail — no quorum)
    // Write to majority (should succeed)
    // Heal partition
    // Verify all nodes converge on majority's data
}

test "linearizable reads return latest write" {
    // Write "key" = "v1" and confirm committed
    // Write "key" = "v2" and confirm committed
    // Linearizable read must return "v2", never "v1"
}
```

### 6.3 Performance Tests

**Throughput baseline (`tests/integration/perf_test.zig`):**

```bash
# 3-node cluster, all on localhost
./zigkv --id 0 --port 6380 --raft-port 7380 --peers 1:7381,2:7382 &
./zigkv --id 1 --port 6381 --raft-port 7381 --peers 0:7380,2:7382 &
./zigkv --id 2 --port 6382 --raft-port 7382 --peers 0:7380,1:7381 &
sleep 1

# Baseline: redis-benchmark against single node (for comparison)
redis-benchmark -p 6379 -c 50 -n 1000000 -t set,get

# ZigKV: same benchmark
redis-benchmark -p 6380 -c 50 -n 1000000 -t set,get

# ZigKV with pipelining
redis-benchmark -p 6380 -c 50 -n 1000000 --pipeline 16 -t set,get

# Expected: ZigKV ≥ 50% of Redis throughput for SET
#           ZigKV ≈ Redis throughput for GET (no Raft involved)
```

---

## Part 7: Acceptance Criteria

ZigKV passes the capstone when it satisfies all of the following:

### Functional Correctness

```bash
# All basic operations work
redis-cli -p 6380 PING            # PONG
redis-cli -p 6380 SET foo bar     # OK
redis-cli -p 6380 GET foo         # "bar"
redis-cli -p 6380 DEL foo         # (integer) 1
redis-cli -p 6380 GET foo         # (nil)
redis-cli -p 6380 EXISTS foo      # (integer) 0
redis-cli -p 6380 SET k v EX 2   # OK
sleep 3
redis-cli -p 6380 GET k           # (nil) — expired
redis-cli -p 6380 KEYS "*"       # lists all keys

# Persistence
redis-cli -p 6380 SET persist "I survive crashes"
pkill -KILL zigkv                 # simulate crash
sleep 1
./zigkv --id 0 ... &              # restart
redis-cli -p 6380 GET persist    # "I survive crashes"

# Replication
redis-cli -p 6380 SET replicated "yes"  # write to leader
redis-cli -p 6381 GET replicated        # "yes" (read from follower)
redis-cli -p 6382 GET replicated        # "yes" (read from follower)

# Fault tolerance
pkill -9 -n zigkv                 # kill the leader
sleep 1
redis-cli -p 6381 SET after_failover "works"  # write to new leader
redis-cli -p 6382 GET after_failover           # "works"

# Load shedding (should not crash under overload)
redis-benchmark -p 6380 -c 1000 -n 100000 -t set --quiet
# Expect: some 429 responses under heavy load, but no crashes
```

### Performance Requirements

On a three-node cluster running on modern hardware:

| Metric | Requirement |
|--------|-------------|
| GET throughput | ≥ 50,000 ops/sec |
| SET throughput | ≥ 20,000 ops/sec (Raft adds latency) |
| GET p99 latency | < 10ms at 50k ops/sec |
| SET p99 latency | < 30ms at 20k ops/sec |
| Memory per key | < 1KB overhead |
| Recovery time | < 5 seconds after single node crash |

### Reliability Requirements

| Test | Requirement |
|------|-------------|
| Leader crash | New leader elected within 600ms |
| Crash recovery | All committed data recovered on restart |
| Partition | Minority side cannot commit writes |
| Partition heal | All nodes converge within 5 seconds |
| 1000 writes, leader crash mid-way | No committed writes lost |

---

## Part 8: The Performance Report

The capstone deliverable is not just working code. It is working code plus a written performance report.

### Required Report Sections

**1. Architecture Overview (1 page)**
- Component diagram
- Data flow for read and write paths
- Which modules contributed which components

**2. Capacity Analysis (1 page)**
- What is the theoretical throughput limit, and what resource constrains it?
- How many connections can the event loop handle?
- How much memory does the cluster use per key?
- When would you need to add another node?

**3. Flame Graph Analysis (1 page)**
- Generate a CPU flame graph under `redis-benchmark` load
- Annotate: the hottest function, the second hottest, unexpected entries
- What is the next optimization target if you needed to double throughput?

**4. The Bottleneck (1 page)**
- What limits throughput in the current implementation?
- CPU, memory, I/O, or lock contention?
- Evidence: `perf stat` output at peak load

**5. Tradeoffs Made (1 page)**
- Consistency model chosen (CP, not AP — why?)
- Isolation level for concurrent reads
- What the system sacrifices for the guarantees it provides
- One thing you would do differently in a production deployment

**6. Test Results (1 page)**
- Unit test pass rate
- Integration test scenarios and outcomes
- Performance benchmark results vs. requirements

---

## Part 9: Extension Challenges

The following extensions transform ZigKV from a demonstration into a system approaching production readiness:

**1. Log Compaction**
The append-only log grows without bound. Implement background compaction: periodically write a snapshot of the current in-memory index plus all live key-value pairs to a new log file, then atomically replace the old log. After compaction, old log entries are gone — only the current state remains. Implement snapshot integration with Raft (the leader can send a snapshot to a follower that has fallen too far behind to receive incremental log entries).

**2. Multi-Key Transactions**
Implement `MULTI`/`EXEC` for atomic multi-key operations using 2PC as described in Module 17. A `MULTI` block touching keys on the same Raft group is committed as a single Raft log entry. A block touching keys on multiple Raft groups requires 2PC coordination.

**3. Read Replicas**
Add a `--read-replica` flag that starts a node in read-only mode. Read replicas receive the Raft log from the leader and apply it to their local storage, but do not participate in elections or voting. Client reads are load-balanced across all replicas for the relevant partition.

**4. TLS**
Wrap all TCP connections (both client-facing RESP and inter-node ZigWire) with TLS using Zig's C interop to call OpenSSL or mbedTLS. Add certificate-based authentication so only authorized nodes can join the cluster.

**5. Metrics and Observability**
Implement a `/metrics` HTTP endpoint (separate port) that exposes Prometheus-format metrics:
- `zigkv_operations_total{op="set|get|del", result="ok|error"}`
- `zigkv_latency_seconds{op="set|get", quantile="0.5|0.95|0.99"}`
- `zigkv_raft_term`, `zigkv_raft_commit_index`, `zigkv_raft_role`
- `zigkv_connections_active`, `zigkv_rate_limited_total`
- `zigkv_storage_keys_total`, `zigkv_storage_log_bytes`

---

## Closing Note

You have built ZigKV. Let's take stock of what that means.

The RESP parser you wrote handles arbitrary TCP fragmentation using the state machine pattern from Module 5, backed by the allocator model from Module 4. The event loop handles thousands of concurrent connections using the epoll primitives from Module 11. The storage engine writes to a write-ahead log with `fsync` discipline from Module 9. The Raft consensus engine implements the algorithm from Module 16, using ZigWire from Module 14 as its transport, all built with the concurrency primitives from Module 8. The MVCC layer from Module 17 enables concurrent readers without blocking writers. The rate limiter and circuit breaker from Module 18 prevent cascading failure.

Every component connects back to something you built and understood from first principles. There is no magic in ZigKV. There is no part of it you cannot explain — not the wire format, not the consensus protocol, not the storage engine, not the memory management.

That is what this curriculum was always for.

---

## Reference: Startup and Testing Cheatsheet

```bash
# Build
zig build -Doptimize=ReleaseFast

# Start a 3-node cluster (three terminals)
mkdir -p data/{0,1,2}

./zig-out/bin/zigkv --id 0 --port 6380 --raft-port 7380 \
    --peers 1:127.0.0.1:7381,2:127.0.0.1:7382 \
    --data-dir ./data/0

./zig-out/bin/zigkv --id 1 --port 6381 --raft-port 7381 \
    --peers 0:127.0.0.1:7380,2:127.0.0.1:7382 \
    --data-dir ./data/1

./zig-out/bin/zigkv --id 2 --port 6382 --raft-port 7382 \
    --peers 0:127.0.0.1:7380,1:127.0.0.1:7381 \
    --data-dir ./data/2

# Verify cluster
redis-cli -p 6380 PING
redis-cli -p 6380 INFO server

# Run unit tests
zig build test

# Run integration tests
zig build test-integration

# Benchmark
redis-benchmark -p 6380 -c 50 -n 100000 -t set,get

# Profile
perf record -F 99 -g --call-graph=fp -p $(pgrep zigkv | head -1) sleep 30
perf script | stackcollapse-perf.pl | flamegraph.pl > zigkv.svg

# Watch cluster state
watch -n 1 'redis-cli -p 6380 INFO replication'

# Simulate leader crash
kill -9 $(redis-cli -p 6380 INFO replication | grep master_port | awk -F: '{print $2}' | xargs -I{} pgrep -f "raft-port {}")
```

---

*End of Final Capstone*

---

*This concludes The Craft of Systems Programming — 18 Modules + Final Capstone.*
*Every concept, from a single bit to a distributed consensus cluster, built from first principles in Zig.*
