# Module 17: Consistency, Transactions, and the Tradeoffs of Scale

## The Craft of Systems Programming — Teaching Material

---

> *"The reason isolation levels exist is that serializability is expensive and most applications don't actually need it — they just think they do until the day they don't have it and data gets corrupted."*
> — Martin Kleppmann

---

## Before You Begin

You have Raft. A single Raft group gives you linearizable reads and writes for one shard of data. But the real world does not fit in one shard.

Consider a bank. You want to transfer $100 from account A to account B. Both accounts live in your RaftKV cluster. The operation requires two writes: debit A, credit B. They must happen together — either both succeed or neither does. If the system crashes between them, you lose money or create money.

This is the transaction problem. And in a distributed system spread across multiple Raft groups — or multiple data centers — it is dramatically harder than in a single machine.

This module covers the machinery that makes distributed databases actually work: the transaction isolation hierarchy (what guarantees does a transaction provide?), multi-version concurrency control (how do you serve reads without blocking writes?), the two-phase commit protocol (how do you make writes atomic across multiple shards?), and the tradeoffs that determine which combination of these a production system chooses.

These are not academic topics. Every time you use a Postgres database, a CockroachDB deployment, or AWS DynamoDB, you are relying on the ideas in this module. Understanding them lets you choose the right tool, configure it correctly, and debug the subtle consistency bugs that arise when you choose wrong.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain the four classic isolation anomalies: dirty read, non-repeatable read, phantom read, and write skew
- Explain the isolation hierarchy: Read Uncommitted, Read Committed, Repeatable Read, Snapshot Isolation, Serializable
- Explain MVCC: how storing multiple versions of each value enables concurrent readers and writers
- Implement a simple MVCC storage layer in Zig with timestamp-based versioning
- Explain two-phase commit (2PC) and the coordinator-participant protocol
- Explain why 2PC is blocking and what happens when the coordinator crashes
- Implement a minimal 2PC coordinator in Zig
- Explain write skew and how Serializable Snapshot Isolation (SSI) detects it
- Explain read-your-writes, monotonic reads, and causal consistency in practical terms
- Choose the appropriate isolation level and consistency model for a given application requirement

---

## Part 1: Why Transactions Are Hard

### 1.1 The Bank Transfer Problem

The canonical motivation for transactions: transfer $100 from Alice to Bob.

Without transactions:
```
read(Alice) → 500
write(Alice, 400)          ← crash here
write(Bob, old_bob + 100)  ← never executes
```

After the crash: Alice has $400, Bob has his original amount. $100 vanished.

With transactions:
```
BEGIN
read(Alice) → 500
write(Alice, 400)
write(Bob, old_bob + 100)
COMMIT  ← atomic: both writes happen or neither does
```

A **transaction** is a sequence of operations that the database treats as a single unit with four properties — the ACID guarantees:

**Atomicity:** Either all operations in the transaction succeed, or none do. No partial states are visible.

**Consistency:** A transaction takes the database from one valid state to another. The database's integrity constraints are preserved.

**Isolation:** Concurrent transactions do not see each other's partial states. Each transaction appears to execute alone on the database.

**Durability:** Once a transaction commits, it is permanent — even if the system crashes immediately after.

Of these, **isolation** is the most nuanced. Full isolation (serializability) is expensive. Real systems offer a spectrum of weaker guarantees that trade correctness for performance.

### 1.2 Concurrency Problems Without Isolation

When transactions run concurrently without isolation, four classes of anomalies can occur:

**Dirty Read:** Transaction T1 reads data written by T2 that has not yet committed. If T2 rolls back, T1 has read data that never existed.

```
T1: read(x) → 100  (T2 has written 100 but not committed)
T2: rollback        (x reverts to 50)
T1 now has a "phantom" value of 100 that doesn't exist
```

**Non-Repeatable Read:** T1 reads x, T2 modifies and commits x, T1 reads x again and gets a different value.

```
T1: read(x) → 50
T2: write(x, 100); commit
T1: read(x) → 100  (changed during transaction!)
```

**Phantom Read:** T1 reads a set of rows matching a condition. T2 inserts a new row matching that condition. T1 reads again and sees the new row.

```
T1: SELECT * WHERE salary > 50000 → {Alice: 60000}
T2: INSERT Bob (salary: 70000); commit
T1: SELECT * WHERE salary > 50000 → {Alice: 60000, Bob: 70000}
```

**Write Skew:** T1 and T2 both read overlapping data and make writes based on what they read, resulting in a state that neither would have permitted on its own.

```
Constraint: at least one doctor must be on-call
T1: read(Alice: on-call, Bob: on-call) → both on-call, ok to go off-call
T1: write(Alice: off-call)
T2: read(Alice: on-call, Bob: on-call) → both on-call, ok to go off-call
T2: write(Bob: off-call)
Result: neither doctor on-call → constraint violated
Neither transaction individually was wrong based on what it saw
```

Write skew is particularly dangerous because it is invisible to snapshot isolation — both reads see a consistent state and both writes are non-conflicting. It requires serializable isolation to prevent.

---

## Part 2: The Isolation Hierarchy

### 2.1 Four Standard Isolation Levels

SQL defines four isolation levels, each preventing a specific set of anomalies:

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | Write Skew |
|-------|-----------|---------------------|--------------|------------|
| Read Uncommitted | ✓ possible | ✓ possible | ✓ possible | ✓ possible |
| Read Committed | prevented | ✓ possible | ✓ possible | ✓ possible |
| Repeatable Read | prevented | prevented | ✓ possible | ✓ possible |
| Serializable | prevented | prevented | prevented | prevented |

**Read Uncommitted:** No isolation. Transactions see uncommitted writes from other transactions. Rarely used in practice.

**Read Committed:** The default in PostgreSQL, Oracle, and SQL Server. A transaction only sees committed data. But the data may change during the transaction — non-repeatable reads are possible.

**Repeatable Read:** Once a transaction reads a value, that value does not change for the duration of the transaction. Phantom reads are still possible because new rows can appear.

**Serializable:** Full isolation. Transactions execute as if they ran serially, one at a time. The most expensive level.

### 2.2 Snapshot Isolation — The Practical Standard

Between Repeatable Read and Serializable lives **Snapshot Isolation (SI)**, not part of the SQL standard but implemented by most major databases (PostgreSQL's "Repeatable Read" is actually SI, Oracle's "Serializable" is actually SI, etc.).

In SI:
- Each transaction reads from a consistent snapshot of the database taken at transaction start time
- Writes succeed if no conflicting write has been committed since the snapshot
- A transaction commits only if no other transaction modified any of the rows it read or wrote

SI prevents dirty reads, non-repeatable reads, and phantom reads. It does **not** prevent write skew — the doctor on-call example above is a classic SI anomaly.

SI is the practical default for most applications because:
- It is much cheaper than serializable isolation
- It prevents almost all common anomalies
- Write skew only affects a narrow class of constraints (constraints that span multiple rows and depend on the absence of writes)

### 2.3 Serializable Snapshot Isolation (SSI)

SSI extends SI to prevent write skew by tracking read-write dependencies between concurrent transactions. When a transaction reads data that another concurrent transaction wrote (or vice versa), a dependency cycle creates the potential for write skew. SSI detects these cycles and aborts one of the transactions.

PostgreSQL implemented SSI in version 9.1 (2011). CockroachDB uses SSI by default. It adds approximately 10-30% overhead compared to plain SI for typical workloads — a reasonable cost for correctness.

The detection mechanism is elegant: for each transaction, track which versions of each key it read and which it wrote. When two transactions have mutual rw-dependencies (T1 reads what T2 wrote, T2 reads what T1 wrote), one must be aborted to prevent the cycle.

---

## Part 3: Multi-Version Concurrency Control

### 3.1 The Core Idea

Traditional locking: readers and writers conflict. A writer locks the row; readers must wait.

MVCC: instead of updating a value in place, write a new version with a new timestamp. Readers read the version that was current at their snapshot timestamp — they never conflict with writers because they are reading different versions.

```
Timeline of key "x":
Version 1: value=50,  written_at_ts=10, deleted_at_ts=30
Version 2: value=100, written_at_ts=30, deleted_at_ts=∞ (current)

Transaction with snapshot_ts=20 reads: Version 1 (value=50)
Transaction with snapshot_ts=35 reads: Version 2 (value=100)
Both read without blocking each other or blocking writers
```

MVCC enables:
- **Consistent snapshots at any point in time** — read the state of the database as it existed at timestamp T
- **Non-blocking reads** — readers never wait for writers
- **Time travel queries** — SELECT ... AS OF SYSTEM TIME 30s ago

The cost: storage grows as versions accumulate. A **vacuum** or **garbage collection** process periodically removes versions that no transaction can ever read again.

### 3.2 Implementing MVCC in Zig

```zig
const std = @import("std");

/// A timestamped version of a value.
/// Versions are stored in reverse chronological order for fast current-value access.
pub const Version = struct {
    /// When this version was written (monotonically increasing transaction timestamp)
    write_ts: u64,
    /// When this version was superseded (0 = still current)
    delete_ts: u64,
    /// The value (null = this is a deletion tombstone)
    value: ?[]const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *Version) void {
        if (self.value) |v| self.allocator.free(v);
    }

    pub fn is_visible_at(self: *const Version, snapshot_ts: u64) bool {
        return self.write_ts <= snapshot_ts and
               (self.delete_ts == 0 or self.delete_ts > snapshot_ts);
    }
};

/// A key's entire version history
pub const VersionChain = struct {
    key: []const u8,
    /// Versions in reverse order: newest first
    versions: std.ArrayList(Version),
    /// Write lock: only one writer at a time
    write_lock: std.Thread.Mutex,
    allocator: std.mem.Allocator,

    pub fn init(key: []const u8, allocator: std.mem.Allocator) !VersionChain {
        return .{
            .key = try allocator.dupe(u8, key),
            .versions = std.ArrayList(Version).init(allocator),
            .write_lock = .{},
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *VersionChain) void {
        for (self.versions.items) |*v| v.deinit();
        self.versions.deinit();
        self.allocator.free(self.key);
    }

    /// Read the value visible at snapshot_ts
    pub fn read_at(self: *const VersionChain, snapshot_ts: u64) ?[]const u8 {
        for (self.versions.items) |*v| {
            if (v.is_visible_at(snapshot_ts)) return v.value;
        }
        return null;
    }

    /// Write a new version at write_ts
    pub fn write(self: *VersionChain, value: ?[]const u8, write_ts: u64) !void {
        self.write_lock.lock();
        defer self.write_lock.unlock();

        // Mark the previous current version as superseded
        if (self.versions.items.len > 0) {
            self.versions.items[0].delete_ts = write_ts;
        }

        const owned_value: ?[]const u8 = if (value) |v|
            try self.allocator.dupe(u8, v)
        else
            null;

        // Prepend (newest first)
        try self.versions.insert(0, .{
            .write_ts = write_ts,
            .delete_ts = 0, // current
            .value = owned_value,
            .allocator = self.allocator,
        });
    }

    /// Remove versions that no transaction can ever read
    /// (all active transaction timestamps are above min_active_ts)
    pub fn vacuum(self: *VersionChain, min_active_ts: u64) void {
        self.write_lock.lock();
        defer self.write_lock.unlock();

        var i: usize = self.versions.items.len;
        while (i > 0) {
            i -= 1;
            const v = &self.versions.items[i];
            if (v.delete_ts != 0 and v.delete_ts <= min_active_ts) {
                v.deinit();
                _ = self.versions.orderedRemove(i);
            }
        }
    }
};

/// A transaction context: all reads see the snapshot at start_ts
pub const Transaction = struct {
    /// Snapshot timestamp: reads see this point in time
    start_ts: u64,
    /// Commit timestamp: writes are stamped with this (assigned at commit time)
    commit_ts: ?u64,
    /// Reads: track which keys and versions were read (for SSI)
    read_set: std.StringHashMap(u64), // key → version timestamp read
    /// Writes: buffered, applied on commit
    write_set: std.StringHashMap(?[]const u8), // key → new value (null=delete)
    status: enum { active, committed, aborted },
    allocator: std.mem.Allocator,

    pub fn init(start_ts: u64, allocator: std.mem.Allocator) Transaction {
        return .{
            .start_ts = start_ts,
            .commit_ts = null,
            .read_set = std.StringHashMap(u64).init(allocator),
            .write_set = std.StringHashMap(?[]const u8).init(allocator),
            .status = .active,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Transaction) void {
        self.read_set.deinit();
        var it = self.write_set.valueIterator();
        while (it.next()) |v| {
            if (v.*) |val| self.allocator.free(val);
        }
        self.write_set.deinit();
    }

    /// Record that we read key at version version_ts
    pub fn record_read(self: *Transaction, key: []const u8,
                        version_ts: u64) !void {
        const key_copy = try self.allocator.dupe(u8, key);
        try self.read_set.put(key_copy, version_ts);
    }

    /// Buffer a write (applied on commit)
    pub fn buffer_write(self: *Transaction, key: []const u8,
                         value: ?[]const u8) !void {
        const key_copy = try self.allocator.dupe(u8, key);
        const val_copy = if (value) |v| try self.allocator.dupe(u8, v) else null;
        try self.write_set.put(key_copy, val_copy);
    }
};

/// The MVCC storage engine
pub const MvccStore = struct {
    /// All version chains, keyed by the key
    chains: std.StringHashMap(VersionChain),
    /// Monotonically increasing timestamp counter
    timestamp: std.atomic.Value(u64),
    /// Active transactions (for vacuum purposes)
    active_txns: std.AutoHashMap(u64, *Transaction),
    mu: std.Thread.Mutex,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) MvccStore {
        return .{
            .chains = std.StringHashMap(VersionChain).init(allocator),
            .timestamp = std.atomic.Value(u64).init(1),
            .active_txns = std.AutoHashMap(u64, *Transaction).init(allocator),
            .mu = .{},
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *MvccStore) void {
        var it = self.chains.valueIterator();
        while (it.next()) |chain| chain.deinit();
        self.chains.deinit();
        self.active_txns.deinit();
    }

    pub fn new_timestamp(self: *MvccStore) u64 {
        return self.timestamp.fetchAdd(1, .monotonic);
    }

    /// Begin a new transaction
    pub fn begin(self: *MvccStore) !*Transaction {
        const ts = self.new_timestamp();
        const txn = try self.allocator.create(Transaction);
        txn.* = Transaction.init(ts, self.allocator);

        self.mu.lock();
        try self.active_txns.put(ts, txn);
        self.mu.unlock();

        return txn;
    }

    /// Read key within transaction txn
    pub fn read(self: *MvccStore, txn: *Transaction, key: []const u8) !?[]const u8 {
        // Check write buffer first (read-your-writes)
        if (txn.write_set.get(key)) |val| {
            return val;
        }

        // Read from the appropriate version
        self.mu.lock();
        const chain = self.chains.getPtr(key);
        self.mu.unlock();

        if (chain == null) {
            try txn.record_read(key, 0);
            return null;
        }

        const value = chain.?.read_at(txn.start_ts);
        // Record the version timestamp for SSI conflict detection
        const version_ts = blk: {
            for (chain.?.versions.items) |v| {
                if (v.is_visible_at(txn.start_ts)) break :blk v.write_ts;
            }
            break :blk 0;
        };
        try txn.record_read(key, version_ts);

        return value;
    }

    /// Write within transaction (buffered until commit)
    pub fn write(self: *MvccStore, txn: *Transaction, key: []const u8,
                 value: ?[]const u8) !void {
        try txn.buffer_write(key, value);
        _ = self;
    }

    /// Commit a transaction.
    /// Returns error.WriteConflict if another transaction committed
    /// conflicting writes since this transaction's start.
    pub fn commit(self: *MvccStore, txn: *Transaction) !void {
        self.mu.lock();
        defer self.mu.unlock();

        // Snapshot Isolation conflict check:
        // For each key we intend to write, check if another transaction
        // committed a write to that key between our start_ts and now.
        var write_it = txn.write_set.keyIterator();
        while (write_it.next()) |key| {
            if (self.chains.getPtr(key.*)) |chain| {
                for (chain.versions.items) |v| {
                    if (v.write_ts > txn.start_ts) {
                        // Another transaction wrote this key after we started
                        txn.status = .aborted;
                        return error.WriteConflict;
                    }
                }
            }
        }

        // Assign commit timestamp
        const commit_ts = self.new_timestamp();
        txn.commit_ts = commit_ts;

        // Apply writes
        var it = txn.write_set.iterator();
        while (it.next()) |entry| {
            const key = entry.key_ptr.*;
            const value = entry.value_ptr.*;

            const chain = self.chains.getPtr(key) orelse blk: {
                try self.chains.put(
                    try self.allocator.dupe(u8, key),
                    try VersionChain.init(key, self.allocator));
                break :blk self.chains.getPtr(key).?;
            };

            try chain.write(value, commit_ts);
        }

        txn.status = .committed;
        _ = self.active_txns.remove(txn.start_ts);
    }

    pub fn abort(self: *MvccStore, txn: *Transaction) void {
        txn.status = .aborted;
        self.mu.lock();
        _ = self.active_txns.remove(txn.start_ts);
        self.mu.unlock();
    }
};
```

### 3.3 Demonstrating MVCC Properties

```zig
pub fn demonstrate_mvcc(allocator: std.mem.Allocator) !void {
    var store = MvccStore.init(allocator);
    defer store.deinit();

    // Set up initial state
    const setup = try store.begin();
    try store.write(setup, "balance_alice", "500");
    try store.write(setup, "balance_bob", "300");
    try store.commit(setup);
    setup.deinit();
    allocator.destroy(setup);

    // T1: Long-running read transaction (snapshot at ts=2)
    const t1 = try store.begin();

    // T2: Write transaction that commits during T1's lifetime
    const t2 = try store.begin();
    try store.write(t2, "balance_alice", "400"); // Alice pays $100
    try store.write(t2, "balance_bob", "400");   // Bob receives $100
    try store.commit(t2);
    t2.deinit();
    allocator.destroy(t2);

    // T1 reads: sees original values (snapshot isolation)
    const alice_in_t1 = try store.read(t1, "balance_alice");
    const bob_in_t1 = try store.read(t1, "balance_bob");
    std.debug.print("T1 sees alice={s}, bob={s} (snapshot from before T2)\n",
        .{alice_in_t1 orelse "nil", bob_in_t1 orelse "nil"});
    // T1 sees 500 and 300 — the values at its snapshot time
    // Even though T2 has already committed 400 and 400

    // T3: New transaction reads after T2
    const t3 = try store.begin();
    const alice_in_t3 = try store.read(t3, "balance_alice");
    std.debug.print("T3 sees alice={s} (after T2)\n", .{alice_in_t3 orelse "nil"});
    // T3 sees 400 — T2's committed value

    try store.commit(t1);
    t1.deinit(); allocator.destroy(t1);
    try store.commit(t3);
    t3.deinit(); allocator.destroy(t3);
}
```

---

## Part 4: Two-Phase Commit

### 4.1 The Problem: Atomic Writes Across Shards

The bank transfer spans two keys. In a sharded system, different keys live on different Raft groups (shards). Committing atomically across shards requires coordinating two separate consensus groups.

You cannot simply commit to each shard independently:
- If shard A commits but shard B fails: money deducted but not added
- If shard B commits but shard A fails: money added but not deducted

You need all-or-nothing across multiple shards. This is the distributed transaction problem.

### 4.2 The Two-Phase Commit Protocol

2PC uses a **coordinator** (typically the node that received the client request) and **participants** (the shards involved in the transaction):

**Phase 1 — Prepare:**
1. Coordinator sends `PREPARE(transaction_id, writes)` to all participants
2. Each participant:
   - Durably logs the transaction's writes to its WAL (write-ahead log) in a "prepared" state
   - Acquires locks on the rows it will write
   - Responds `VOTE_COMMIT` if it can commit, `VOTE_ABORT` if it cannot (conflict, constraint violation, etc.)

**Phase 2 — Commit or Abort:**
3. If **all** participants voted commit: Coordinator sends `COMMIT(transaction_id)` to all participants
4. If **any** participant voted abort: Coordinator sends `ABORT(transaction_id)` to all participants
5. Each participant applies or discards the prepared writes and releases locks
6. Coordinator considers the transaction complete

```zig
pub const TwoPCStatus = enum {
    preparing,
    committed,
    aborted,
};

pub const Participant = struct {
    shard_id: u32,
    addr: std.net.Address,
};

pub const PrepareResult = struct {
    shard_id: u32,
    vote: enum { commit, abort },
    reason: ?[]const u8,
};

pub const TwoPCCoordinator = struct {
    txn_id: u64,
    participants: []const Participant,
    writes: std.StringHashMap([]const u8), // key → value, grouped by shard
    status: TwoPCStatus,
    allocator: std.mem.Allocator,

    pub fn init(txn_id: u64, participants: []const Participant,
                allocator: std.mem.Allocator) TwoPCCoordinator {
        return .{
            .txn_id = txn_id,
            .participants = participants,
            .writes = std.StringHashMap([]const u8).init(allocator),
            .status = .preparing,
            .allocator = allocator,
        };
    }

    /// Phase 1: Send PREPARE to all participants.
    /// Returns true if all voted commit.
    pub fn phase_1_prepare(self: *TwoPCCoordinator,
                            send_prepare: PrepareFunc) !bool {
        // Durably log the decision point BEFORE sending prepare
        // (coordinator crash recovery depends on this)
        try self.log_prepare_sent();

        var all_commit = true;
        for (self.participants) |participant| {
            const result = try send_prepare(participant, self.txn_id);
            if (result.vote == .abort) {
                all_commit = false;
                std.debug.print("Shard {d} voted ABORT: {s}\n",
                    .{participant.shard_id, result.reason orelse "unknown"});
                break;
            }
            std.debug.print("Shard {d} voted COMMIT\n", .{participant.shard_id});
        }

        return all_commit;
    }

    /// Phase 2: Send COMMIT or ABORT to all participants.
    pub fn phase_2_decide(self: *TwoPCCoordinator,
                           commit: bool,
                           send_decision: DecisionFunc) !void {
        // Durably log the decision BEFORE sending
        // (must be atomic so coordinator can recover if it crashes here)
        self.status = if (commit) .committed else .aborted;
        try self.log_decision();

        // Send to all participants — retry indefinitely until all acknowledge
        for (self.participants) |participant| {
            var attempts: u32 = 0;
            while (true) : (attempts += 1) {
                const ack = send_decision(participant, self.txn_id, commit) catch {
                    // Participant unavailable: retry after backoff
                    std.time.sleep(@as(u64, @min(1000, attempts * 100)) * 1_000_000);
                    continue;
                };
                if (ack) break; // acknowledged
            }
        }
    }

    fn log_prepare_sent(self: *TwoPCCoordinator) !void {
        // In production: write to WAL with fsync
        std.debug.print("[WAL] txn={d}: prepare sent to {d} participants\n",
            .{self.txn_id, self.participants.len});
    }

    fn log_decision(self: *TwoPCCoordinator) !void {
        // In production: write to WAL with fsync
        std.debug.print("[WAL] txn={d}: decision={s}\n",
            .{self.txn_id, @tagName(self.status)});
    }
};

const PrepareFunc = *const fn (Participant, u64) anyerror!PrepareResult;
const DecisionFunc = *const fn (Participant, u64, bool) anyerror!bool;

/// Orchestrate a complete 2PC transaction
pub fn execute_2pc(
    txn_id: u64,
    participants: []const Participant,
    send_prepare: PrepareFunc,
    send_decision: DecisionFunc,
    allocator: std.mem.Allocator,
) !bool {
    var coord = TwoPCCoordinator.init(txn_id, participants, allocator);

    const should_commit = try coord.phase_1_prepare(send_prepare);
    try coord.phase_2_decide(should_commit, send_decision);

    return should_commit;
}
```

### 4.3 The 2PC Blocking Problem

2PC has a critical flaw: it is **blocking**. If the coordinator crashes after sending PREPARE but before sending the decision, participants are stuck:

```
Coordinator:
  1. Log prepare_sent ← crashes here
  2. → PREPARE to participants (all vote COMMIT)
  3. ← all ACK
  4. [CRASH HERE]
  5. Log decision
  6. → COMMIT to participants
  
Participant state: received PREPARE, voted COMMIT, now waiting for decision
- Cannot commit (decision might be ABORT)
- Cannot abort (decision might be COMMIT)
- Cannot serve requests on locked rows
- BLOCKED until coordinator recovers
```

This is the fundamental limitation of 2PC. When the coordinator crashes between phases, all participants holding locks are stuck until recovery.

The recovery procedure:
1. Coordinator restarts, reads its WAL
2. If WAL shows prepare_sent but no decision: re-run phase 2 (if it knows all voted commit) or send abort
3. If WAL shows decision: resend the decision to any participant that did not acknowledge

In practice, coordinator crashes are rare and recovery is fast. But "rare" is not "never" — a system that cannot tolerate coordinator crashes is fragile.

### 4.4 Alternatives to 2PC

**Percolator (Google):** Stores the transaction commit state in the data store itself (using a "lock" column). Allows coordinators to crash and recover because the commit state is durable in the data rather than the coordinator's WAL. Used by CockroachDB and TiKV.

**Saga pattern:** Break a long transaction into a sequence of smaller transactions, each with a compensating transaction that can undo it. Instead of atomic commit, implement a sequence of forward operations and a sequence of compensating operations. If any step fails, execute the compensating operations for all completed steps. No 2PC, no coordinator crash risk — but compensating operations must be carefully designed.

**Avoid distributed transactions:** Design your data model so that related data that must be atomically updated lives in the same shard. This is often achievable with careful key design and eliminates the need for 2PC entirely.

---

## Part 5: The Tradeoffs of Scale

### 5.1 The CRDT Alternative

When strong consistency is too expensive, **Conflict-free Replicated Data Types (CRDTs)** offer eventual consistency with guaranteed merge. A CRDT is a data structure designed so that any two replicas can always be merged without conflicts.

Classic CRDTs:

**G-Counter (grow-only counter):** Each node has its own counter. The value is the sum of all node counters. Increment is local. Merge takes the max of each node's counter.

```zig
pub const GCounter = struct {
    /// One counter per node in the cluster
    counts: []u64,
    node_id: u32,
    allocator: std.mem.Allocator,

    pub fn init(node_id: u32, cluster_size: u32, allocator: std.mem.Allocator) !GCounter {
        const counts = try allocator.alloc(u64, cluster_size);
        @memset(counts, 0);
        return .{ .counts = counts, .node_id = node_id, .allocator = allocator };
    }

    pub fn deinit(self: *GCounter) void {
        self.allocator.free(self.counts);
    }

    pub fn increment(self: *GCounter) void {
        self.counts[self.node_id] += 1;
    }

    pub fn value(self: *const GCounter) u64 {
        var total: u64 = 0;
        for (self.counts) |c| total += c;
        return total;
    }

    /// Merge two replicas: take the max of each node's counter
    pub fn merge(self: *GCounter, other: *const GCounter) void {
        for (self.counts, other.counts) |*s, o| {
            s.* = @max(s.*, o);
        }
    }
};

/// PN-Counter: supports both increment and decrement
pub const PNCounter = struct {
    increments: GCounter,
    decrements: GCounter,

    pub fn value(self: *const PNCounter) i64 {
        return @as(i64, @intCast(self.increments.value())) -
               @as(i64, @intCast(self.decrements.value()));
    }

    pub fn increment(self: *PNCounter) void { self.increments.increment(); }
    pub fn decrement(self: *PNCounter) void { self.decrements.increment(); }

    pub fn merge(self: *PNCounter, other: *const PNCounter) void {
        self.increments.merge(&other.increments);
        self.decrements.merge(&other.decrements);
    }
};
```

CRDTs are appropriate for:
- Like/vote counts (PN-Counter)
- Shopping carts (add-wins set: merging two carts keeps all items)
- Collaborative text editing (sequence CRDTs: Logoot, LSEQ)
- Distributed presence/availability tracking

CRDTs are not appropriate for:
- Bank balances (you cannot prevent overdraft without coordination)
- Inventory (you cannot prevent overselling without coordination)
- Anything requiring a global constraint

### 5.2 Choosing Consistency for Your Application

The practical decision tree:

```
Is your data a single shard / single Raft group?
├─ YES → Use Raft's linearizable reads/writes directly
│       Cost: ~5ms per write (replication round-trip)
│       
└─ NO → Do operations span multiple shards?
        ├─ YES → Can you redesign keys to co-locate related data?
        │        ├─ YES → Do it. Avoid distributed transactions.
        │        └─ NO → Use 2PC
        │                Cost: ~10-20ms (two round-trips + fsync)
        │                Risk: coordinator blocking
        │
        └─ NO (single-shard operations) →
                Do you need linearizability?
                ├─ YES → Read from leader (adds latency)
                └─ NO → Can you tolerate slightly stale reads?
                         ├─ YES → Read from any replica
                         │        (lower latency, possibly stale)
                         └─ NO → Use linearizable reads (read-index)
```

### 5.3 Consistency vs Latency — The Numbers

This is not abstract. The choice of consistency level directly determines latency:

| Operation | Single-DC (10ms RTT) | Multi-DC (100ms RTT) |
|-----------|---------------------|---------------------|
| Linearizable write (Raft) | ~10ms | ~100ms |
| Linearizable read (read-index) | ~10ms | ~100ms |
| Eventual read (from replica) | ~1ms | ~1ms |
| 2PC transaction | ~20ms | ~200ms |
| CRDT merge | ~0ms (local) | ~0ms (local) |

A service with p99 < 50ms SLA cannot use 2PC across data centers. It must either redesign to avoid cross-DC transactions, accept eventual consistency, or use a specialized protocol like Spanner's external consistency (which requires GPS-disciplined atomic clocks).

---

## Part 6: Read-Your-Writes and Session Guarantees

### 6.1 The Session Guarantee Hierarchy

Below the formal isolation levels, there is a set of practical guarantees called **session guarantees** that matter for real application correctness:

**Read-your-writes:** After a write, subsequent reads in the same session see that write. Obvious requirement — but violated by naive load balancers that route reads to a different replica than the one that received the write.

**Monotonic reads:** If you read a value at time T, all subsequent reads see values at least as recent as T. Prevents going back in time — seeing an older value than you previously saw.

**Monotonic writes:** Writes in a session are applied in order. If you write X then write Y, no server applies Y before X.

**Writes follow reads:** If you read X and then write Y, Y is applied after X. Ensures causal order: your write is based on what you read.

**Causal consistency:** The combination of all four guarantees above. Events that are causally related are seen in causal order by all processes.

### 6.2 Implementing Read-Your-Writes

```zig
/// Client-side session tracking for read-your-writes
pub const Session = struct {
    /// The timestamp of the last write by this session
    last_write_ts: std.atomic.Value(u64),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Session {
        return .{
            .last_write_ts = std.atomic.Value(u64).init(0),
            .allocator = allocator,
        };
    }

    pub fn record_write(self: *Session, commit_ts: u64) void {
        var current = self.last_write_ts.load(.monotonic);
        while (commit_ts > current) {
            current = self.last_write_ts.cmpxchgWeak(
                current, commit_ts, .monotonic, .monotonic) orelse break;
        }
    }

    /// When issuing a read, include this timestamp so the server
    /// can ensure it reads data at least this fresh
    pub fn read_min_ts(self: *const Session) u64 {
        return self.last_write_ts.load(.monotonic);
    }
};

/// Server-side: handle a read request with min_ts requirement
pub fn read_with_min_ts(
    store: *MvccStore,
    key: []const u8,
    min_ts: u64,
) !?[]const u8 {
    // If our state machine has not yet applied up to min_ts,
    // we must wait or redirect to a more up-to-date replica
    const current_ts = store.timestamp.load(.monotonic);
    if (current_ts < min_ts) {
        // Option 1: Wait for state to catch up
        var wait_count: u32 = 0;
        while (store.timestamp.load(.monotonic) < min_ts) : (wait_count += 1) {
            if (wait_count > 100) return error.TimeoutWaitingForFreshness;
            std.time.sleep(1_000_000); // 1ms
        }
    }

    // Read at min_ts (or current if current > min_ts)
    const read_ts = @max(min_ts, current_ts - 1);
    const chain = store.chains.getPtr(key) orelse return null;
    return chain.read_at(read_ts);
}
```

---

## Part 7: The Module Project — Transactional RaftKV

### Project Specification

Extend the RaftKV from Module 16 with MVCC and multi-key transactions using 2PC.

### New Capabilities

```
// Single-key operations (as before)
redis-cli -p 7380 SET foo bar    # → OK
redis-cli -p 7380 GET foo        # → "bar"

// Multi-key atomic transaction (new)
redis-cli -p 7380 MULTI
redis-cli -p 7380 SET alice 400
redis-cli -p 7380 SET bob 400
redis-cli -p 7380 EXEC           # → OK (atomic)

// Read-modify-write with optimistic concurrency
redis-cli -p 7380 WATCH balance
redis-cli -p 7380 MULTI
redis-cli -p 7380 DECRBY balance 100
redis-cli -p 7380 EXEC           # → OK if balance unchanged since WATCH
                                  # → nil if balance changed (retry needed)
```

### Implementation Plan

**Step 1: MVCC layer on top of the KV state machine**

Replace the simple `HashMap<key, value>` storage with the `MvccStore` from Part 3. Each `SET`/`DEL` command appended to the Raft log creates a new version with the log index as the timestamp. Reads take a snapshot at the commit_index visible to the reader.

**Step 2: MULTI/EXEC commands**

`MULTI` begins a transaction. Subsequent commands are buffered, not executed. `EXEC` commits the transaction — atomically for single-shard transactions, via 2PC for multi-shard.

**Step 3: WATCH/MULTI/EXEC (optimistic concurrency)**

`WATCH key` records the current version of `key`. If `key`'s version changes before `EXEC`, the transaction is aborted (returns nil). This implements optimistic concurrency: clients retry on conflict.

**Step 4: 2PC for multi-shard transactions**

When `EXEC` is called and the transaction writes span multiple shards:
1. Coordinator (the leader of the shard that received the client request) runs 2PC
2. PREPARE phase: send prepared writes to each shard's Raft leader
3. Each shard appends a "prepared" entry to its Raft log
4. COMMIT/ABORT phase: send decision to all shards
5. Each shard appends "committed"/"aborted" to its log

### Verification Tests

```bash
# Test 1: Atomicity — bank transfer must be atomic
redis-cli -p 7380 SET alice 500
redis-cli -p 7380 SET bob 300
redis-cli -p 7380 MULTI
redis-cli -p 7380 DECRBY alice 100
redis-cli -p 7380 INCRBY bob 100
redis-cli -p 7380 EXEC
redis-cli -p 7380 GET alice  # → 400
redis-cli -p 7380 GET bob    # → 400
# alice + bob = 800 (conservation enforced)

# Test 2: Isolation — concurrent transactions don't see partial state
# (use two concurrent redis-cli sessions)

# Test 3: Durability — crash after EXEC, data survives restart
redis-cli -p 7380 SET durable_key "I survive"
redis-cli -p 7380 EXEC
pkill raftkv
./raftkv --id 0 --recover ...  # restart
redis-cli -p 7380 GET durable_key  # → "I survive"

# Test 4: WATCH conflict detection
redis-cli -p 7380 SET counter 0
redis-cli -p 7380 WATCH counter
# Another client increments counter here
redis-cli -p 7380 MULTI
redis-cli -p 7380 INCR counter
redis-cli -p 7380 EXEC  # → nil (conflict detected)
```

---

## Summary

Transactions solve the atomicity and isolation problems that arise when multiple operations must be performed as a unit, or when multiple clients concurrently access the same data.

**The isolation hierarchy** — from Read Uncommitted through Read Committed, Repeatable Read, and Snapshot Isolation to full Serializable — offers a spectrum of tradeoffs between correctness and performance. Most production databases default to Read Committed or Snapshot Isolation because they prevent the most common anomalies while remaining fast.

**Write skew** — the anomaly that Snapshot Isolation permits but Serializable prevents — affects a specific class of constraints (invariants that span multiple rows). Applications relying on such constraints must use Serializable isolation or implement application-level locking.

**MVCC** enables concurrent readers and writers by storing multiple timestamped versions of each value. Readers take a snapshot at a timestamp and see the database as it existed at that point, never blocking writers. Writers create new versions without overwriting existing ones. A vacuum process periodically removes versions that no transaction can read.

**Two-phase commit** extends atomic commits to multiple shards. The prepare phase collects votes; the commit phase applies or discards the transaction based on the vote. 2PC is correct but blocking — a coordinator crash can leave participants stuck until recovery. For latency-sensitive workloads, redesigning data models to avoid cross-shard transactions is usually preferable.

**The tradeoffs of scale** are real: linearizable writes cost one replication round-trip per write; 2PC costs two; cross-DC 2PC costs two cross-DC round-trips. CRDTs eliminate coordination entirely for data types that support conflict-free merging. The right choice depends on the application's correctness requirements and latency budget.

---

## What's Next

Module 18 — Systems Design Under Load — is the final module before the capstone. It synthesizes everything: how do you design a system that handles millions of requests per second? How do you think about capacity, bottlenecks, and graceful degradation? How do you break down a vague requirement ("build a system like Twitter") into a concrete design with justified choices at every layer?

---

## Reference: Consistency Tradeoffs Quick Reference

```
Isolation Anomalies:
  Dirty read:          reading uncommitted writes (prevented by RC+)
  Non-repeatable read: value changes during transaction (prevented by RR+)
  Phantom read:        new rows appear during transaction (prevented by SI+)
  Write skew:          two txns read same data, write conflicting values
                       (only prevented by Serializable)

Isolation Levels:
  Read Uncommitted:  no protection (don't use)
  Read Committed:    default for Postgres, Oracle, SQL Server
  Repeatable Read:   Postgres RR is actually Snapshot Isolation
  Snapshot Isolation: most databases' practical "strong" level
  Serializable:      Postgres SSI, CockroachDB default, expensive

MVCC Properties:
  - Readers never block writers; writers never block readers
  - Reads see consistent snapshot at start timestamp
  - Writes create new versions; old versions retained until vacuumed
  - Write conflict = two txns write same key; first committer wins

2PC States:
  PREPARING → (all VOTE_COMMIT) → COMMITTED
  PREPARING → (any VOTE_ABORT) → ABORTED
  Coordinator crash in PREPARING: participants blocked until recovery

Session Guarantees (weakest to strongest):
  Read-your-writes: see your own writes
  Monotonic reads: don't go back in time
  Causal consistency: see events in causal order
  Linearizability: global real-time order (strongest)

CRDT Use Cases:
  G-Counter: page views, event counts (monotonically increasing)
  PN-Counter: votes, inventory (can decrease)
  LWW-Register: user profile (last-write-wins, acceptable for most fields)
  OR-Set: shopping carts, tags (add wins over concurrent remove)
```

---

*End of Module 17*
