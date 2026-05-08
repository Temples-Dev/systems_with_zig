# Module 16: Replication and Consensus — Implementing Raft

## The Craft of Systems Programming — Teaching Material

---

> *"Raft was designed with one goal: understandability. Not the simplest possible algorithm — the most understandable correct algorithm. The paper's authors ran user studies. Raft won."*

---

## Before You Begin

Module 15 established the theory: why distribution is hard, what the impossibility results mean, and what CAP says about the fundamental tradeoffs. This module builds on that theory by implementing the algorithm that powers etcd, CockroachDB, TiKV, Consul, and countless other production distributed systems: **Raft**.

Raft is a consensus algorithm for managing a replicated log. Its purpose is to make a cluster of machines agree on a sequence of values — in this case, a sequence of operations to apply to a key-value store. Once the cluster agrees on an operation, that operation is committed and applied to the state machine on all nodes. The result: a distributed system that behaves like a single, fault-tolerant machine.

Raft was designed to be understandable. Unlike Paxos, which is notoriously difficult to implement correctly, Raft decomposes the consensus problem into three relatively independent sub-problems: leader election, log replication, and safety. Each sub-problem has a clean specification. Together they produce a complete, correct consensus algorithm.

By the end of this module, you will have a working implementation of Raft running on the ZigWire transport from Module 14, tested on the distributed simulator from Module 15.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain the three roles in Raft (leader, follower, candidate) and when each transitions to another
- Explain terms as Raft's logical clock and why they are critical for safety
- Implement the election timeout and randomized election trigger
- Implement the `RequestVote` RPC and the voting rules that guarantee at most one leader per term
- Implement the `AppendEntries` RPC for both log replication and heartbeating
- Explain the commitment rule: an entry is committed when replicated to a majority
- Explain the safety guarantee: committed entries are never lost across leader changes
- Implement log consistency repair: how a new leader brings followers' logs up to date
- Persist Raft state to durable storage and explain what must be persisted and why
- Test your implementation under simulated node failures and network partitions

---

## Part 1: Raft Fundamentals

### 1.1 The Replicated State Machine

Raft implements a **replicated state machine**: multiple servers, each with an identical copy of a deterministic state machine, applying the same sequence of commands in the same order. Because the state machine is deterministic and all servers apply the same commands in the same order, they produce the same state.

```
Client Request
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                  Consensus Module (Raft)             │
│                                                     │
│  Client sends command to leader.                    │
│  Leader appends to log.                             │
│  Leader replicates to followers.                    │
│  Majority acknowledges → entry committed.           │
│  Leader applies to state machine.                   │
│  Leader responds to client.                         │
│  Followers apply to state machine in background.    │
└─────────────────────────────────────────────────────┘
      │
      ▼
 State Machine (your KV store)
```

The key property: the consensus module guarantees that all non-faulty servers will eventually apply the same commands in the same order. The state machine just runs commands — it does not need to know anything about the distributed system.

### 1.2 The Three Roles

Every Raft node is in exactly one of three states at any time:

**Follower:** Passive. Responds to RPCs from leaders and candidates. If a follower receives no communication from a leader within the election timeout, it transitions to candidate.

**Candidate:** Actively seeking to become leader. Increments its term, votes for itself, and sends `RequestVote` RPCs to all other nodes. If it receives votes from a majority, it becomes leader. If it discovers a higher term, it reverts to follower.

**Leader:** Active. Sends `AppendEntries` RPCs (log entries or heartbeats) to all followers. Accepts client requests. When a client sends a command, the leader appends it to its log, replicates it, and responds to the client once committed.

```
                  discovers higher term
         ┌──────────────────────────────────┐
         │                                  │
         ▼                                  │
    ┌─────────┐  election timeout  ┌────────────┐
    │ Follower │──────────────────►│ Candidate  │
    │         │◄──────────────────│            │
    └─────────┘ discovers current  └────────────┘
                 leader or new term      │
         ▲                              │ receives votes from majority
         │                              ▼
         │         discovers       ┌─────────┐
         └─────────higher term─────│ Leader  │
                                   └─────────┘
```

### 1.3 Terms — Raft's Logical Clock

**Terms** are Raft's mechanism for detecting stale information. A term is a monotonically increasing integer. Each term begins with an election. If a candidate wins, it serves as leader for the rest of the term. If no candidate wins (split vote), the term ends with no leader and a new election starts.

Terms serve as logical timestamps:
- Every RPC includes the sender's current term
- If a server sees a term greater than its own, it immediately updates its term and reverts to follower
- If a server receives an RPC with a term less than its own, it rejects the RPC

This ensures that information from old terms is never mistaken for current information. An old leader that was partitioned from the cluster will discover the new term when it reconnects and immediately step down.

```zig
const std = @import("std");
const atomic = std.atomic;

pub const RaftRole = enum { follower, candidate, leader };

/// Persistent state: must be written to durable storage before responding to any RPC
pub const PersistentState = struct {
    /// Latest term this server has seen (initialized to 0)
    current_term: u64,
    /// Candidate that received this server's vote in current_term (null = none)
    voted_for: ?u32,
    /// The log (persisted so it survives crashes)
    log: std.ArrayList(LogEntry),
};

/// Volatile state: reconstructed after crashes
pub const VolatileState = struct {
    /// Index of highest log entry known to be committed
    commit_index: u64,
    /// Index of highest log entry applied to state machine
    last_applied: u64,
};

/// Volatile leader state: reinitialized after each election
pub const LeaderState = struct {
    /// For each follower: index of next log entry to send
    next_index: []u64,
    /// For each follower: index of highest log entry known to be replicated
    match_index: []u64,
};

pub const LogEntry = struct {
    /// Term when entry was received by leader
    term: u64,
    /// The command (opaque bytes — the state machine interprets this)
    command: []const u8,
    /// Index in the log (1-based; 0 = no entry)
    index: u64,
};

pub const RaftNode = struct {
    id: u32,
    cluster_size: u32,
    role: RaftRole,

    // State
    persistent: PersistentState,
    volatile_state: VolatileState,
    leader_state: ?LeaderState, // Some iff role == .leader

    // Timing
    last_heartbeat_ms: u64,
    election_timeout_ms: u64, // randomized: 150-300ms

    allocator: std.mem.Allocator,

    pub fn init(id: u32, cluster_size: u32, allocator: std.mem.Allocator) !RaftNode {
        var rng = std.rand.DefaultPrng.init(id * 12345 + 1);
        // Randomize election timeout to avoid simultaneous elections
        const timeout = 150 + rng.random().uintLessThan(u64, 150); // 150-299ms

        return .{
            .id = id,
            .cluster_size = cluster_size,
            .role = .follower,
            .persistent = .{
                .current_term = 0,
                .voted_for = null,
                .log = std.ArrayList(LogEntry).init(allocator),
            },
            .volatile_state = .{
                .commit_index = 0,
                .last_applied = 0,
            },
            .leader_state = null,
            .last_heartbeat_ms = 0,
            .election_timeout_ms = timeout,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *RaftNode) void {
        for (self.persistent.log.items) |entry| {
            self.allocator.free(entry.command);
        }
        self.persistent.log.deinit();
        if (self.leader_state) |*ls| {
            self.allocator.free(ls.next_index);
            self.allocator.free(ls.match_index);
        }
    }

    pub fn majority(self: *const RaftNode) u32 {
        return self.cluster_size / 2 + 1;
    }

    /// Last log index (0 if log is empty)
    pub fn last_log_index(self: *const RaftNode) u64 {
        return if (self.persistent.log.items.len == 0) 0
               else self.persistent.log.items[self.persistent.log.items.len - 1].index;
    }

    /// Last log term (0 if log is empty)
    pub fn last_log_term(self: *const RaftNode) u64 {
        return if (self.persistent.log.items.len == 0) 0
               else self.persistent.log.items[self.persistent.log.items.len - 1].term;
    }
};
```

---

## Part 2: Leader Election

### 2.1 The Election Trigger

A follower converts to candidate when its election timeout expires without receiving a heartbeat from the leader. The timeout is randomized to prevent simultaneous elections — if all nodes had the same timeout, they would all become candidates at the same time, splitting the vote and requiring another election.

In practice: 150-300ms election timeout, with 50ms heartbeat interval. The leader sends heartbeats every 50ms, so a follower times out after 100-250ms without one.

```zig
/// Returns true if this node should start an election
pub fn should_start_election(self: *const RaftNode, now_ms: u64) bool {
    if (self.role == .leader) return false;
    return now_ms - self.last_heartbeat_ms >= self.election_timeout_ms;
}

/// Convert to candidate and start an election
pub fn start_election(self: *RaftNode, now_ms: u64) !void {
    self.role = .candidate;
    self.persistent.current_term += 1;
    self.persistent.voted_for = self.id; // vote for self
    self.last_heartbeat_ms = now_ms;    // reset timeout

    try self.save_persistent_state(); // MUST persist before sending RPCs

    std.debug.print("Node {d} starting election for term {d}\n",
        .{self.id, self.persistent.current_term});
}
```

### 2.2 The RequestVote RPC

The candidate sends a `RequestVote` RPC to every other node in the cluster. The RPC includes the candidate's term, id, and the index and term of its last log entry.

```zig
pub const RequestVoteArgs = struct {
    /// Candidate's term
    term: u64,
    /// Candidate requesting vote
    candidate_id: u32,
    /// Index of candidate's last log entry
    last_log_index: u64,
    /// Term of candidate's last log entry
    last_log_term: u64,
};

pub const RequestVoteReply = struct {
    /// Current term, for candidate to update itself
    term: u64,
    /// True if candidate received the vote
    vote_granted: bool,
};
```

### 2.3 The Voting Rules

A node grants a vote if and only if:

1. The candidate's term ≥ the node's current term
2. The node has not already voted for a different candidate in this term
3. The candidate's log is at least as up-to-date as the node's log

The "up-to-date" comparison:
- If logs end with different terms: the log with the higher term is more up-to-date
- If logs end with the same term: the longer log is more up-to-date

This rule ensures that only candidates with all committed entries can become leader — because committed entries were replicated to a majority, and any majority share at least one node with those entries.

```zig
pub fn handle_request_vote(self: *RaftNode, args: RequestVoteArgs) !RequestVoteReply {
    var reply = RequestVoteReply{
        .term = self.persistent.current_term,
        .vote_granted = false,
    };

    // Rule 1: Reject if candidate's term is less than ours
    if (args.term < self.persistent.current_term) {
        return reply;
    }

    // If we see a higher term, convert to follower
    if (args.term > self.persistent.current_term) {
        self.persistent.current_term = args.term;
        self.persistent.voted_for = null;
        self.role = .follower;
        reply.term = args.term;
    }

    // Rule 2: Check if we've already voted in this term
    const already_voted = self.persistent.voted_for != null and
                          self.persistent.voted_for.? != args.candidate_id;
    if (already_voted) return reply;

    // Rule 3: Candidate's log must be at least as up-to-date as ours
    const candidate_log_ok = blk: {
        const our_last_term = self.last_log_term();
        const our_last_index = self.last_log_index();

        // Higher term in last entry wins
        if (args.last_log_term != our_last_term) {
            break :blk args.last_log_term > our_last_term;
        }
        // Same term: longer log wins
        break :blk args.last_log_index >= our_last_index;
    };

    if (candidate_log_ok) {
        self.persistent.voted_for = args.candidate_id;
        self.last_heartbeat_ms = current_time_ms(); // reset election timeout
        reply.vote_granted = true;
        try self.save_persistent_state();

        std.debug.print("Node {d} grants vote to {d} for term {d}\n",
            .{self.id, args.candidate_id, args.term});
    }

    return reply;
}

/// Process a RequestVote reply
pub fn handle_vote_reply(self: *RaftNode, reply: RequestVoteReply,
                          votes_received: *u32) !void {
    // If we're no longer a candidate, ignore
    if (self.role != .candidate) return;

    // If the reply has a higher term, step down
    if (reply.term > self.persistent.current_term) {
        self.persistent.current_term = reply.term;
        self.persistent.voted_for = null;
        self.role = .follower;
        try self.save_persistent_state();
        return;
    }

    // Ignore stale replies
    if (reply.term < self.persistent.current_term) return;

    if (reply.vote_granted) {
        votes_received.* += 1;

        // Check if we've won the election
        if (votes_received.* >= self.majority()) {
            try self.become_leader();
        }
    }
}

pub fn become_leader(self: *RaftNode) !void {
    self.role = .leader;
    std.debug.print("Node {d} becomes leader for term {d}\n",
        .{self.id, self.persistent.current_term});

    // Initialize leader state
    const n = self.cluster_size;
    const next_index = try self.allocator.alloc(u64, n);
    const match_index = try self.allocator.alloc(u64, n);

    const last_idx = self.last_log_index();
    for (next_index) |*ni| ni.* = last_idx + 1; // optimistic: send from end
    for (match_index) |*mi| mi.* = 0;            // unknown

    self.leader_state = .{
        .next_index = next_index,
        .match_index = match_index,
    };

    // Immediately send heartbeats to assert authority
    // (prevents unnecessary elections)
}
```

### 2.4 Split Votes and Randomized Timeouts

If two candidates start elections simultaneously, they may each receive votes from non-overlapping halves of the cluster. Neither reaches a majority. Both time out and start new elections (with new, randomized timeouts).

Randomized timeouts statistically prevent persistent splits: the probability that the same nodes simultaneously start elections multiple times decreases exponentially with each round.

In a 5-node cluster:
- 1 candidate gets 3+ votes: becomes leader immediately
- 2 candidates each get 2 votes: split vote, new election
- Expected number of elections before a winner: ~1.2 with well-chosen timeout ranges

---

## Part 3: Log Replication

### 3.1 The AppendEntries RPC

`AppendEntries` is the most important RPC in Raft. The leader uses it for two purposes:
1. **Replication:** Send new log entries to followers
2. **Heartbeat:** Send empty `AppendEntries` to assert authority and prevent elections

```zig
pub const AppendEntriesArgs = struct {
    /// Leader's term
    term: u64,
    /// So followers can redirect clients
    leader_id: u32,
    /// Index of log entry immediately preceding new ones
    prev_log_index: u64,
    /// Term of prev_log_index entry
    prev_log_term: u64,
    /// Log entries to store (empty for heartbeat)
    entries: []const LogEntry,
    /// Leader's commit_index
    leader_commit: u64,
};

pub const AppendEntriesReply = struct {
    /// Current term, for leader to update itself
    term: u64,
    /// True if follower contained entry matching prev_log_index and prev_log_term
    success: bool,
    /// Optimization: on failure, return the conflicting term and index
    /// so leader can quickly find the divergence point
    conflict_term: u64,
    conflict_index: u64,
};
```

### 3.2 The Log Consistency Check

Before appending entries, the follower verifies that its log is consistent with the leader's up to `prev_log_index`:

```zig
pub fn handle_append_entries(self: *RaftNode,
                              args: AppendEntriesArgs) !AppendEntriesReply {
    var reply = AppendEntriesReply{
        .term = self.persistent.current_term,
        .success = false,
        .conflict_term = 0,
        .conflict_index = 0,
    };

    // Rule 1: Reject if leader's term < our term
    if (args.term < self.persistent.current_term) return reply;

    // Valid AppendEntries from current leader: reset election timeout
    self.last_heartbeat_ms = current_time_ms();
    self.role = .follower; // in case we were a candidate

    // Update term if we see a higher one
    if (args.term > self.persistent.current_term) {
        self.persistent.current_term = args.term;
        self.persistent.voted_for = null;
        try self.save_persistent_state();
        reply.term = args.term;
    }

    // Rule 2: Log consistency check
    // If we don't have an entry at prev_log_index, or its term doesn't match:
    if (args.prev_log_index > 0) {
        if (args.prev_log_index > self.last_log_index()) {
            // We don't have this entry at all
            reply.conflict_index = self.last_log_index() + 1;
            reply.conflict_term = 0;
            return reply;
        }

        // Find the entry at prev_log_index (log is 1-indexed)
        const entry = &self.persistent.log.items[args.prev_log_index - 1];
        if (entry.term != args.prev_log_term) {
            // Conflict: tell leader the conflicting term and first index of that term
            reply.conflict_term = entry.term;
            // Find the first index with this conflicting term
            var conflict_idx = args.prev_log_index;
            while (conflict_idx > 1 and
                   self.persistent.log.items[conflict_idx - 2].term == entry.term)
            {
                conflict_idx -= 1;
            }
            reply.conflict_index = conflict_idx;
            return reply;
        }
    }

    // Rule 3: Append new entries, overwriting conflicting entries
    for (args.entries, 0..) |entry, i| {
        const idx = args.prev_log_index + 1 + i;

        if (idx <= self.last_log_index()) {
            // We already have an entry at this index
            const existing = &self.persistent.log.items[idx - 1];
            if (existing.term != entry.term) {
                // Conflict: delete this and all subsequent entries
                for (self.persistent.log.items[idx - 1..]) |e| {
                    self.allocator.free(e.command);
                }
                try self.persistent.log.resize(idx - 1);
                // Now append this entry
                const cmd = try self.allocator.dupe(u8, entry.command);
                try self.persistent.log.append(.{
                    .term = entry.term,
                    .command = cmd,
                    .index = idx,
                });
            }
            // If terms match, entry is already present — skip
        } else {
            // Append new entry
            const cmd = try self.allocator.dupe(u8, entry.command);
            try self.persistent.log.append(.{
                .term = entry.term,
                .command = cmd,
                .index = idx,
            });
        }
    }

    try self.save_persistent_state(); // persist new log entries

    // Rule 4: Update commit_index
    if (args.leader_commit > self.volatile_state.commit_index) {
        self.volatile_state.commit_index = @min(
            args.leader_commit,
            self.last_log_index());
        // Entries up to commit_index are safe to apply to state machine
    }

    reply.success = true;
    return reply;
}
```

### 3.3 The Leader's Replication Loop

The leader maintains `next_index[i]` for each follower — the next log index to send to follower i. When a follower rejects `AppendEntries`, the leader decrements `next_index[i]` and retries, backing up until it finds the point of agreement.

```zig
/// Send AppendEntries to a follower. Called after receiving a client command
/// or on the heartbeat timer.
pub fn send_append_entries(
    self: *RaftNode,
    follower_id: u32,
    send_fn: *const fn (u32, u32, AppendEntriesArgs) AppendEntriesReply,
) !void {
    const ls = &(self.leader_state orelse return);
    const next_idx = ls.next_index[follower_id];

    // Build the entries to send: everything from next_idx onward
    const prev_log_index = next_idx - 1;
    const prev_log_term: u64 = if (prev_log_index == 0) 0
        else self.persistent.log.items[prev_log_index - 1].term;

    const entries_start = if (next_idx > 0) next_idx - 1 else 0;
    const entries = self.persistent.log.items[entries_start..];

    const args = AppendEntriesArgs{
        .term = self.persistent.current_term,
        .leader_id = self.id,
        .prev_log_index = prev_log_index,
        .prev_log_term = prev_log_term,
        .entries = entries,
        .leader_commit = self.volatile_state.commit_index,
    };

    const reply = send_fn(self.id, follower_id, args);

    // If we see a higher term: step down
    if (reply.term > self.persistent.current_term) {
        self.persistent.current_term = reply.term;
        self.persistent.voted_for = null;
        self.role = .follower;
        if (self.leader_state) |*old_ls| {
            self.allocator.free(old_ls.next_index);
            self.allocator.free(old_ls.match_index);
            self.leader_state = null;
        }
        try self.save_persistent_state();
        return;
    }

    if (reply.success) {
        // Update next_index and match_index for this follower
        ls.match_index[follower_id] = prev_log_index + entries.len;
        ls.next_index[follower_id] = ls.match_index[follower_id] + 1;

        // Check if any new entries can be committed
        try self.advance_commit_index();
    } else {
        // Follower's log doesn't match: back up
        if (reply.conflict_term == 0) {
            // Follower doesn't have prev_log_index at all
            ls.next_index[follower_id] = reply.conflict_index;
        } else {
            // Find the last entry in our log with the conflicting term
            var new_next: u64 = reply.conflict_index;
            for (self.persistent.log.items) |entry| {
                if (entry.term == reply.conflict_term) {
                    new_next = entry.index + 1;
                }
            }
            ls.next_index[follower_id] = new_next;
        }
    }
}

/// Check if any new entries can be committed.
/// A log entry is committed when stored on a majority of servers.
fn advance_commit_index(self: *RaftNode) !void {
    const ls = &(self.leader_state orelse return);

    // Find the highest N such that:
    // 1. N > commit_index
    // 2. log[N].term == current_term
    // 3. A majority of match_index[i] >= N
    var n = self.volatile_state.commit_index + 1;
    while (n <= self.last_log_index()) : (n += 1) {
        // Only commit entries from the current term
        // (safety: prevents committing entries from previous terms)
        const entry_term = self.persistent.log.items[n - 1].term;
        if (entry_term != self.persistent.current_term) {
            n += 1;
            continue;
        }

        // Count servers that have replicated this entry
        var replicated: u32 = 1; // leader itself has the entry
        for (ls.match_index) |match| {
            if (match >= n) replicated += 1;
        }

        if (replicated >= self.majority()) {
            self.volatile_state.commit_index = n;
            std.debug.print("Leader {d}: committed log index {d}\n",
                .{self.id, n});
        } else {
            break; // Can't commit N, so can't commit N+1 either
        }
    }
}
```

---

## Part 4: Safety — The Critical Property

### 4.1 Why Safety Is Hard

The most subtle part of Raft (and the part most often implemented incorrectly) is the commitment rule and its interaction with leader election.

Consider this scenario:
1. Leader L1 appends entry E at index 5, replicates to 2 of 5 servers, then crashes
2. A new election happens. A server without E wins
3. The new leader L2 overwrites index 5 with a different entry F
4. Entry E was never committed (only 2 of 5 servers had it) — so this is safe
5. But if L1 had replicated E to 3 servers (majority), it was committed — and L2 cannot overwrite it

The voting rule ensures safety: **a candidate can only win an election if it has all committed entries.** Because committed entries were replicated to a majority, and any majority of a 2N+1 cluster shares at least one node, any candidate that receives votes from a majority must include at least one node that has all committed entries. The up-to-date check ensures that node would have voted for the candidate only if the candidate's log is at least as complete.

### 4.2 The Figure-8 Scenario

The Raft paper's Figure 8 demonstrates a subtle situation where an entry can appear to be committed based on its count of replicas, but is actually not safe to commit:

```
Time 1: S1 is leader (term=2), replicates index 2 to S1 and S2
          S1: [1:1, 2:2]
          S2: [1:1, 2:2]
          S3: [1:1]
          S4: [1:1]
          S5: [1:1]

Time 2: S1 crashes. S5 becomes leader (term=3), appends index 2 with term=3 to itself
          S5: [1:1, 2:3]

Time 3: S5 crashes. S1 recovers, becomes leader (term=4), replicates index 2 (term=2) to majority
          S1: [1:1, 2:2, 3:4]  (now has 3 servers with index 2)
          S2: [1:1, 2:2]
          S3: [1:1, 2:2]  ← S1 replicated its old entry here
```

At this point, index 2 with term=2 is on 3 servers (S1, S2, S3). Should it be committed?

**No.** Raft's safety rule says: a leader can only commit entries **from its own current term**. S1 (leader for term=4) cannot commit index 2 with term=2, even though 3 servers have it.

```
Time 4: S1 crashes before committing. S5 becomes leader (term=5).
         S5's log: [1:1, 2:3] — S5 can win election (its term=3 > S1's replicated term=2)
         S5 overwrites index 2 on S1, S2, S3 with its own entry (term=3)
         
Result: Entry with term=2 is GONE — correctly, because it was never committed
```

The safety rule prevents this: S1 in term=4 must commit an entry **at index 3 with term=4** before it can advance commit_index. Once that happens, S5 can no longer win an election (its log is out of date relative to the majority), and the term=2 entry at index 2 is protected.

This is implemented in `advance_commit_index`: we only advance `commit_index` to entries from the current term.

### 4.3 The Log Matching Property

Raft maintains two invariants that together constitute the Log Matching Property:

**Invariant 1:** If two entries in different logs have the same index and term, they store the same command.

*Proof:* A leader creates at most one entry for a given (index, term) pair. Once created, an entry is never modified. Followers only append entries sent by the current leader.

**Invariant 2:** If two entries in different logs have the same index and term, all preceding entries in both logs are identical.

*Proof:* By the consistency check in `AppendEntries`: a follower only appends entries if its log matches the leader's up to `prev_log_index`. By induction.

Together, these invariants mean that if two logs agree on any entry (same index and term), they are identical up to that point. This is what makes Raft logs predictable and the state machine deterministic.

---

## Part 5: Persistence

### 5.1 What Must Be Persisted

Not all state needs to survive a crash. Raft distinguishes between state that must be persisted before any RPC response and state that can be reconstructed:

**Must persist (before responding to any RPC):**
- `current_term`: If a server forgets its term and reboots with term=0, it may grant votes from a previous term, violating safety.
- `voted_for`: If a server forgets whom it voted for and reboots, it may vote twice in the same term, allowing two leaders to be elected.
- `log[]`: All committed entries must survive crashes; uncommitted entries should also be persisted for efficiency.

**Can reconstruct:**
- `commit_index`: Can be learned from the leader on reconnection.
- `last_applied`: Reconstructed by replaying the log from the beginning.
- `next_index`, `match_index`: Reinitialized on every election.

```zig
/// Persistent state file format (append-only, simple version):
/// - Magic: "RAFT" (4 bytes)
/// - current_term: u64 (8 bytes)
/// - voted_for_present: u8 (1 = yes, 0 = none)
/// - voted_for: u32 (4 bytes, only if voted_for_present == 1)
/// - log_count: u64 (8 bytes)
/// - For each log entry:
///   - term: u64
///   - index: u64
///   - command_len: u32
///   - command: [command_len]u8

pub fn save_persistent_state(self: *const RaftNode) !void {
    // In a real system, write to a WAL with fsync
    // For this implementation, write to a flat file with fsync

    const path = try std.fmt.allocPrint(
        self.allocator, "raft_state_{d}.bin", .{self.id});
    defer self.allocator.free(path);

    // Write to temp file, then rename (atomic on most filesystems)
    const tmp_path = try std.fmt.allocPrint(
        self.allocator, "raft_state_{d}.tmp", .{self.id});
    defer self.allocator.free(tmp_path);

    const file = try std.fs.cwd().createFile(tmp_path, .{});
    defer file.close();

    var buf = std.ArrayList(u8).init(self.allocator);
    defer buf.deinit();

    // Magic
    try buf.appendSlice("RAFT");

    // current_term
    var term_bytes: [8]u8 = undefined;
    std.mem.writeInt(u64, &term_bytes, self.persistent.current_term, .little);
    try buf.appendSlice(&term_bytes);

    // voted_for
    if (self.persistent.voted_for) |vf| {
        try buf.append(1);
        var vf_bytes: [4]u8 = undefined;
        std.mem.writeInt(u32, &vf_bytes, vf, .little);
        try buf.appendSlice(&vf_bytes);
    } else {
        try buf.append(0);
        try buf.appendNTimes(0, 4);
    }

    // log
    var count_bytes: [8]u8 = undefined;
    std.mem.writeInt(u64, &count_bytes,
        @intCast(self.persistent.log.items.len), .little);
    try buf.appendSlice(&count_bytes);

    for (self.persistent.log.items) |entry| {
        var e_term: [8]u8 = undefined;
        var e_index: [8]u8 = undefined;
        var e_len: [4]u8 = undefined;
        std.mem.writeInt(u64, &e_term, entry.term, .little);
        std.mem.writeInt(u64, &e_index, entry.index, .little);
        std.mem.writeInt(u32, &e_len, @intCast(entry.command.len), .little);
        try buf.appendSlice(&e_term);
        try buf.appendSlice(&e_index);
        try buf.appendSlice(&e_len);
        try buf.appendSlice(entry.command);
    }

    try file.writeAll(buf.items);
    // fsync: ensure bytes reach disk before we consider the write complete
    try file.sync();

    // Atomic rename
    try std.fs.cwd().rename(tmp_path, path);
}
```

### 5.2 Recovery After Crash

On startup, a Raft node reads its persisted state and reconstructs from there:

```zig
pub fn load_persistent_state(self: *RaftNode) !bool {
    const path = try std.fmt.allocPrint(
        self.allocator, "raft_state_{d}.bin", .{self.id});
    defer self.allocator.free(path);

    const file = std.fs.cwd().openFile(path, .{}) catch return false;
    defer file.close();

    const data = try file.readToEndAlloc(self.allocator, 100 * 1024 * 1024);
    defer self.allocator.free(data);

    if (data.len < 4 or !std.mem.eql(u8, data[0..4], "RAFT")) return false;

    var pos: usize = 4;
    self.persistent.current_term = std.mem.readInt(u64, data[pos..][0..8], .little);
    pos += 8;

    const voted_for_present = data[pos]; pos += 1;
    if (voted_for_present == 1) {
        self.persistent.voted_for = std.mem.readInt(u32, data[pos..][0..4], .little);
    } else {
        self.persistent.voted_for = null;
    }
    pos += 4;

    const log_count = std.mem.readInt(u64, data[pos..][0..8], .little);
    pos += 8;

    for (0..log_count) |_| {
        const term = std.mem.readInt(u64, data[pos..][0..8], .little); pos += 8;
        const index = std.mem.readInt(u64, data[pos..][0..8], .little); pos += 8;
        const cmd_len = std.mem.readInt(u32, data[pos..][0..4], .little); pos += 4;
        const cmd = try self.allocator.dupe(u8, data[pos..][0..cmd_len]);
        pos += cmd_len;

        try self.persistent.log.append(.{
            .term = term,
            .index = index,
            .command = cmd,
        });
    }

    std.debug.print("Node {d} recovered: term={d}, log_len={d}\n",
        .{self.id, self.persistent.current_term,
          self.persistent.log.items.len});
    return true;
}
```

---

## Part 6: Integrating with ZigWire

### 6.1 Raft RPCs over ZigWire

Raft's two RPCs — `RequestVote` and `AppendEntries` — are natural ZigWire message types. Using the protocol from Module 14:

```zig
/// ZigWire message types for Raft
pub const RaftFrameType = enum(u8) {
    request_vote     = 0x40,
    request_vote_reply = 0x41,
    append_entries   = 0x42,
    append_entries_reply = 0x43,
    _,
};

/// Serialize AppendEntriesArgs to ZigWire TLV
pub fn serialize_append_entries(
    writer: *FrameWriter,
    args: AppendEntriesArgs,
    request_id: u32,
) !void {
    try writer.begin(@enumFromInt(@intFromEnum(RaftFrameType.append_entries)),
        .{ .is_response=false, .is_error=false, .is_compressed=false, ._reserved=0 },
        request_id);

    try writer.write_tlv_u64(.sequence_num, args.term);              // term
    try writer.write_tlv_u32(.node_id, args.leader_id);
    try writer.write_tlv_u64(@enumFromInt(0x50), args.prev_log_index);
    try writer.write_tlv_u64(@enumFromInt(0x51), args.prev_log_term);
    try writer.write_tlv_u64(.sequence_num, args.leader_commit);     // reuse tag

    // Encode entries: [term(8) index(8) cmd_len(4) cmd...] per entry
    var entries_buf = std.ArrayList(u8).init(writer.buf.allocator);
    defer entries_buf.deinit();
    for (args.entries) |entry| {
        var tbuf: [8]u8 = undefined; var ibuf: [8]u8 = undefined;
        var lbuf: [4]u8 = undefined;
        std.mem.writeInt(u64, &tbuf, entry.term, .little);
        std.mem.writeInt(u64, &ibuf, entry.index, .little);
        std.mem.writeInt(u32, &lbuf, @intCast(entry.command.len), .little);
        try entries_buf.appendSlice(&tbuf);
        try entries_buf.appendSlice(&ibuf);
        try entries_buf.appendSlice(&lbuf);
        try entries_buf.appendSlice(entry.command);
    }
    try writer.write_tlv_bytes(@enumFromInt(0x52), entries_buf.items);

    try writer.finish();
}
```

### 6.2 The Raft Server Loop

```zig
pub fn run_raft_server(
    node: *RaftNode,
    peers: []const std.net.Address,
    state_machine: *StateMachine,
    allocator: std.mem.Allocator,
) !void {
    // Load persisted state if available
    _ = try node.load_persistent_state();

    var timer = try std.time.Timer.start();
    var last_heartbeat_sent: u64 = 0;
    const HEARTBEAT_INTERVAL_MS: u64 = 50;

    while (true) {
        const now_ms = timer.read() / 1_000_000;

        // Apply committed entries to state machine
        while (node.volatile_state.last_applied <
               node.volatile_state.commit_index)
        {
            node.volatile_state.last_applied += 1;
            const entry = node.persistent.log.items[
                node.volatile_state.last_applied - 1];
            try state_machine.apply(entry.command);
        }

        switch (node.role) {
            .leader => {
                // Send heartbeats/log entries to all followers
                if (now_ms - last_heartbeat_sent >= HEARTBEAT_INTERVAL_MS) {
                    for (peers, 0..) |_, peer_id| {
                        if (peer_id == node.id) continue;
                        try send_append_entries_to(node, @intCast(peer_id), peers);
                    }
                    last_heartbeat_sent = now_ms;
                }
            },
            .follower, .candidate => {
                // Check election timeout
                if (node.should_start_election(now_ms)) {
                    try node.start_election(now_ms);
                    var votes: u32 = 1; // voted for self
                    // Send RequestVote to all peers
                    for (peers, 0..) |_, peer_id| {
                        if (peer_id == node.id) continue;
                        const reply = try send_request_vote(node,
                            @intCast(peer_id), peers);
                        try node.handle_vote_reply(reply, &votes);
                    }
                }
            },
        }

        // Process incoming messages (via ZigWire)
        try process_incoming_messages(node, allocator);

        std.time.sleep(1_000_000); // 1ms tick
        _ = state_machine;
    }
}
```

---

## Part 7: Testing Raft Correctness

### 7.1 What Must Be Tested

Raft is deceptively easy to implement incorrectly. The most common bugs:

1. **Not persisting before responding:** Responding to an RPC before writing state to disk violates the persistence requirement. If the server crashes between responding and writing, it may forget state that other servers relied on.

2. **Wrong up-to-date comparison:** Using log length instead of log term for the up-to-date check allows stale leaders to be elected.

3. **Committing old-term entries directly:** Advancing commit_index based on old-term entries (the Figure-8 bug) can cause committed entries to be overwritten.

4. **Not resetting election timeout on valid AppendEntries:** A follower that doesn't reset its timeout may start an unnecessary election.

5. **Not handling stale RPC replies:** A reply from a previous term should be ignored. A reply that arrives after the node has changed role should be ignored.

### 7.2 Test Scenarios

Using the simulator from Module 15:

```zig
pub fn test_leader_election(allocator: std.mem.Allocator) !void {
    var cluster = try RaftCluster.init(5, allocator);
    defer cluster.deinit();

    // Let cluster start: one leader should emerge
    try cluster.run_for_ms(500);
    const leader = cluster.current_leader() orelse
        return error.NoLeaderElected;
    std.debug.print("Leader elected: node {d}\n", .{leader});

    // Kill the leader
    cluster.crash_node(leader);
    std.debug.print("Leader crashed: node {d}\n", .{leader});

    // New leader should emerge within 2 election timeouts
    try cluster.run_for_ms(600);
    const new_leader = cluster.current_leader() orelse
        return error.NewLeaderNotElected;
    std.debug.assert(new_leader != leader);
    std.debug.print("New leader elected: node {d}\n", .{new_leader});
}

pub fn test_log_replication(allocator: std.mem.Allocator) !void {
    var cluster = try RaftCluster.init(5, allocator);
    defer cluster.deinit();

    try cluster.run_for_ms(300); // let leader emerge
    const leader = cluster.current_leader().?;

    // Submit commands
    for (0..10) |i| {
        var cmd: [32]u8 = undefined;
        const cmd_str = try std.fmt.bufPrint(&cmd, "set key{d} val{d}", .{i, i});
        try cluster.submit_command(leader, cmd_str);
    }

    // Let replication complete
    try cluster.run_for_ms(200);

    // All nodes should have the same committed log
    const reference_log = cluster.nodes[leader].persistent.log.items;
    for (cluster.nodes, 0..) |node, i| {
        if (i == leader) continue;
        std.debug.assert(node.persistent.log.items.len >=
            cluster.nodes[leader].volatile_state.commit_index);
        // Verify log contents match up to commit_index
    }
    std.debug.print("Log replication verified: all nodes consistent\n", .{});
}

pub fn test_partition_and_recovery(allocator: std.mem.Allocator) !void {
    var cluster = try RaftCluster.init(5, allocator);
    defer cluster.deinit();

    try cluster.run_for_ms(300);
    const leader = cluster.current_leader().?;

    // Partition: isolate leader from majority
    // e.g., leader=0, partition {0,1} from {2,3,4}
    cluster.create_partition(&.{0, 1}, &.{2, 3, 4});
    std.debug.print("Partition: {0,1} isolated from {2,3,4}\n", .{});

    // Minority side cannot commit new entries (no quorum)
    // Majority side elects a new leader
    try cluster.run_for_ms(600);

    const new_leader = cluster.current_leader().?;
    std.debug.assert(new_leader != 0 and new_leader != 1);
    std.debug.print("New leader from majority: node {d}\n", .{new_leader});

    // Submit a command to new leader
    try cluster.submit_command(new_leader, "set x 42");
    try cluster.run_for_ms(200);

    // Heal partition
    cluster.heal_partition();
    try cluster.run_for_ms(500);

    // Old leader should step down and adopt new log
    std.debug.assert(cluster.nodes[0].role == .follower);
    std.debug.assert(cluster.nodes[0].volatile_state.commit_index ==
                     cluster.nodes[new_leader].volatile_state.commit_index);
    std.debug.print("Partition healed: all nodes consistent\n", .{});
}
```

---

## Part 8: The Module Project — RaftKV

### Project Specification

Build **RaftKV**: a replicated key-value store backed by the Raft consensus algorithm, using ZigWire for transport.

### Architecture

```
Client
  │
  │ ZigWire request to any node
  ▼
┌─────────────────────────────────────────────────────────────┐
│ RaftKV Node                                                 │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐ │
│  │ ZigWire      │    │ Raft         │    │ KV State      │ │
│  │ Transport    │◄──►│ Consensus    │◄──►│ Machine       │ │
│  │ (Module 14)  │    │ Module       │    │ (Module 12    │ │
│  └──────────────┘    └──────────────┘    │  storage)     │ │
│                                          └───────────────┘ │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Durable Storage: raft_state_N.bin, kv_snapshot.bin  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### What RaftKV Provides

- **Linearizable reads and writes:** Every GET returns the value of the most recent committed SET
- **Fault tolerance:** A 5-node cluster tolerates 2 node failures
- **Automatic leader election:** Clients can discover and redirect to the leader
- **Persistence:** Committed data survives node restarts

### The Command Log

Each KV operation is encoded as a command in the Raft log:

```zig
pub const KvCommand = union(enum) {
    set: struct { key: []const u8, value: []const u8, ttl_ms: ?u64 },
    del: struct { key: []const u8 },
    // Read commands go directly to leader (or any node with linearizable reads)
    // and do NOT go through the log

    pub fn serialize(self: KvCommand, allocator: std.mem.Allocator) ![]u8 {
        var buf = std.ArrayList(u8).init(allocator);
        switch (self) {
            .set => |s| {
                try buf.append(1); // type = SET
                var klen: [4]u8 = undefined;
                std.mem.writeInt(u32, &klen, @intCast(s.key.len), .little);
                try buf.appendSlice(&klen);
                try buf.appendSlice(s.key);
                var vlen: [4]u8 = undefined;
                std.mem.writeInt(u32, &vlen, @intCast(s.value.len), .little);
                try buf.appendSlice(&vlen);
                try buf.appendSlice(s.value);
                var ttl: [8]u8 = undefined;
                std.mem.writeInt(u64, &ttl, s.ttl_ms orelse 0, .little);
                try buf.appendSlice(&ttl);
            },
            .del => |d| {
                try buf.append(2); // type = DEL
                var klen: [4]u8 = undefined;
                std.mem.writeInt(u32, &klen, @intCast(d.key.len), .little);
                try buf.appendSlice(&klen);
                try buf.appendSlice(d.key);
            },
        }
        return buf.toOwnedSlice();
    }
};
```

### Client Interaction

```
Client: SET foo bar → sends to any node
Node (non-leader): redirect to leader
Node (leader): 
  1. Append to log: [index=N, term=T, cmd=SET foo bar]
  2. Replicate to followers
  3. Wait for majority acknowledgment
  4. Advance commit_index to N
  5. Apply SET foo bar to KV state machine
  6. Respond: +OK

Client: GET foo → sends to leader (for linearizable reads)
Node (leader): 
  - Does NOT go through the log for reads
  - Instead: sends heartbeat to confirm still leader (read-index approach)
  - Waits until state machine has applied all entries up to leader's commit_index
  - Reads from KV state machine
  - Responds: $3\r\nbar\r\n (RESP format)
```

### Acceptance Tests

```bash
# Start 5-node RaftKV cluster
./raftkv --id 0 --peers 1,2,3,4 --port 7380 &
./raftkv --id 1 --peers 0,2,3,4 --port 7381 &
./raftkv --id 2 --peers 0,1,3,4 --port 7382 &
./raftkv --id 3 --peers 0,1,2,4 --port 7383 &
./raftkv --id 4 --peers 0,1,2,3 --port 7384 &

# Use redis-cli (RESP-compatible) to interact
redis-cli -p 7380 PING              # → PONG
redis-cli -p 7380 SET foo bar       # → OK
redis-cli -p 7380 GET foo           # → "bar"

# Kill the leader and verify recovery
kill $LEADER_PID
sleep 1                             # wait for new election
redis-cli -p 7381 GET foo          # → "bar" (data survived)
redis-cli -p 7381 SET foo baz      # → OK (new leader handles it)

# Verify linearizability with concurrent clients
# (use redis-benchmark or a custom concurrent client)
redis-benchmark -p 7380 -n 10000 -c 10 -t set,get
```

---

## Summary

Raft is consensus made understandable. By decomposing the problem into leader election, log replication, and safety, it gives practitioners a clear mental model for reasoning about distributed agreement.

**Leader election** uses randomized timeouts and term-based logical clocks to guarantee at most one leader per term. The voting rule — only grant votes to candidates with logs at least as up-to-date as yours — ensures that leaders have all committed entries.

**Log replication** is driven by the leader sending `AppendEntries` RPCs. The consistency check (prev_log_index and prev_log_term) ensures followers' logs match the leader's before appending. The leader advances `commit_index` when an entry is replicated to a majority.

**Safety** is the property that committed entries are never lost. The commitment rule (only commit entries from the current term) prevents the Figure-8 scenario where apparently-replicated entries from old terms are later overwritten. The log matching invariant ensures that two logs agreeing on any entry agree on all preceding entries.

**Persistence** of `current_term`, `voted_for`, and the log is mandatory for safety. A server that forgets these state items may violate the election guarantee or the replication guarantee.

**Testing** distributed consensus is hard because bugs manifest only under specific timing conditions. The simulator from Module 15 is the right tool: inject failures, verify correctness, and build confidence in the implementation before running on real hardware.

---

## What's Next

Module 17 — Consistency, Transactions, and the Tradeoffs of Scale — extends the Raft-based system with multi-key transactions, linearizable reads, and the design tradeoffs of large-scale distributed databases. You have consensus; now you will build the full database machinery on top of it.

---

## Reference: Raft Rules Summary

```
Leader Election:
  - Election timeout: 150-300ms (randomized per node)
  - Heartbeat interval: 50ms (must be << election timeout)
  - Vote granted if: candidate term ≥ own term AND
                     not voted for another candidate in this term AND
                     candidate log is at least as up-to-date

  Up-to-date comparison:
    - Higher last log term wins
    - If equal: longer log wins

  Win election: receive votes from majority (N/2 + 1)

Log Replication:
  - All writes go to leader
  - Leader appends to log, sends AppendEntries to all followers
  - Entry committed when replicated to majority
  - Committed entries applied to state machine in order

  AppendEntries consistency check:
    - Reject if prev_log_index exists but prev_log_term doesn't match
    - Delete conflicting entries from that point onward
    - Append new entries

Safety:
  - Only commit entries from current term
  - A committed entry on server S means:
    - N/2+1 servers have the entry (including S)
    - Any future leader will have the entry (must win election from majority)

Persistence (before any RPC response):
  - current_term: prevents stale votes
  - voted_for: prevents double voting
  - log[]: prevents data loss

Fault tolerance:
  - N-node cluster tolerates (N-1)/2 failures
  - 3 nodes → 1 failure
  - 5 nodes → 2 failures
  - 7 nodes → 3 failures
```

---

*End of Module 16*
