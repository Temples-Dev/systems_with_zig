# Module 15: The Nature of Distributed Systems

## The Craft of Systems Programming — Teaching Material

---

> *"A distributed system is one in which the failure of a computer you didn't even know existed can render your own computer unusable."*
> — Leslie Lamport

---

## Before You Begin

Every module so far has dealt with a single machine. The processor, the OS, memory, concurrency, the network stack — all within one physical system. This module crosses the boundary into territory that is qualitatively different.

A distributed system is a collection of computers that communicate over a network to provide a service that appears unified to users. This definition hides a great deal of difficulty. The computers may fail independently. The network may drop messages, duplicate them, delay them arbitrarily, or partition the system into isolated groups. Clocks on different machines drift apart — there is no global "now." There is no shared memory. There is no atomic operation that spans machines.

These constraints are not engineering failures — they are physics. The speed of light limits how fast information travels. Hardware fails. Networks are imperfect. Any system built on multiple machines must work *in spite of* these realities, not by pretending they do not exist.

This module covers the theoretical foundations of distributed systems: the impossibility results that tell you what cannot be built, the formal models for reasoning about time and causality without a global clock, and the fundamental tradeoffs between consistency, availability, and partition tolerance. These are not academic curiosities — they directly determine what your distributed ZigWire store can and cannot promise its clients.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain the Two Generals Problem and what it proves about distributed coordination
- Explain the FLP impossibility result and what it means for consensus algorithms
- Explain CAP theorem correctly — including the common misconceptions about it
- Implement Lamport clocks and use them to establish event ordering across processes
- Implement vector clocks and use them to detect causality and concurrency
- Explain why physical clocks cannot be trusted in distributed systems
- Explain the difference between crash-stop, crash-recovery, and Byzantine fault models
- Implement a simulated distributed system with message delays and node crashes in Zig
- Use the simulation to demonstrate the CAP tradeoff concretely
- Explain PACELC — the more precise version of CAP that accounts for latency

---

## Part 1: Why Distribution Is Fundamentally Hard

### 1.1 The Single Machine Assumption

When you write a program on a single machine, you rely on a set of guarantees that feel natural because you have never had to think about them:

**Shared memory is coherent.** If thread A writes 42 to address X, thread B reading address X (with proper synchronization) will see 42. Not 0. Not a previous value. Not an inconsistent intermediate state.

**Time is monotonic.** `clock_gettime()` returns a value that is always greater than or equal to the previous call. Events can be placed on a timeline.

**Operations are either complete or not.** A function either returns or it doesn't — there is no state where a function has "half-returned."

**Failure is detectable.** If a function crashes, the process dies. The caller knows something went wrong.

In a distributed system, every one of these assumptions breaks.

**Shared memory does not exist.** Two machines share no memory. To communicate, they send messages. Messages may be lost, duplicated, or reordered.

**Time cannot be trusted.** Each machine has its own clock. Clocks drift at different rates. The Network Time Protocol (NTP) synchronizes clocks to within ~10ms under good conditions; GPS-disciplined clocks do better, but still not perfect. A clock that was synchronized an hour ago may have drifted by milliseconds.

**Operations may be partially complete.** A machine may fail halfway through processing a request. Did the operation succeed? Did it not? The caller cannot tell — the network ate the response.

**Failure is indistinguishable from slowness.** If you send a message to another machine and receive no reply, you cannot tell whether the machine has crashed, the network dropped your message, or the machine is busy and will reply soon. In an asynchronous network, you can never be certain.

### 1.2 The Two Generals Problem

The Two Generals Problem is a thought experiment that proves an impossibility result about distributed coordination.

Two armies want to attack a city simultaneously. They are separated by enemy territory. Each general can only communicate by sending messengers through the enemy territory. Messengers may be captured — messages may be lost. The two generals must agree on an attack time: if both attack, they win; if only one attacks, they lose.

The question: can the generals ever be certain they have agreed?

The answer is: **no algorithm can guarantee agreement in the presence of message loss.** Here is why:

Suppose General A sends: "Attack at dawn." For A to be certain the attack will be coordinated, A needs to know that B received the message. So B sends back: "Acknowledged — attack at dawn." But now B is not certain that A received the acknowledgment. So A sends: "Acknowledged your acknowledgment." But now A is not certain B received *that* message...

This chain of acknowledgments is infinite. No finite number of messages can give either general certainty, because the last message in any finite sequence is not acknowledged — and if it is lost, the receiver cannot know whether the sender received anything.

The Two Generals Problem maps directly to TCP connection teardown: a four-way FIN handshake cannot guarantee that both sides agree the connection is closed. This is why TCP has `TIME_WAIT` — the last ACK may be lost, and the sender must wait to retransmit if needed.

**The lesson for distributed systems:** Absolute certainty of coordination in the presence of message loss is impossible. Every protocol must decide how much uncertainty is acceptable and design accordingly.

### 1.3 The FLP Impossibility Result

The FLP impossibility result (Fischer, Lynch, Paterson, 1985) is one of the most important theorems in distributed systems. It states:

> **In an asynchronous network where any process may crash, it is impossible for a distributed consensus algorithm to simultaneously guarantee Safety, Liveness, and Fault-Tolerance.**

**Safety:** All non-faulty processes agree on the same value.
**Liveness:** The algorithm eventually terminates and produces a decision.
**Fault-Tolerance:** The algorithm works correctly even if some processes crash.

FLP says you can have at most two of these three simultaneously in an asynchronous system.

The proof exploits the indistinguishability of a crashed process and a slow one. In an asynchronous system with no bounds on message delays, you cannot tell whether a process that has not responded has crashed or is merely slow. This uncertainty is precisely the condition that makes guaranteed termination impossible — an algorithm waiting for a response that never comes (from a crashed process) will wait forever, violating liveness.

**What FLP means in practice:** You cannot build a consensus algorithm that always terminates in the presence of any number of process failures in a fully asynchronous system. Real consensus algorithms (Raft, Paxos, PBFT) get around FLP by adding timing assumptions — they assume messages are eventually delivered within some unknown but finite time, and use timeouts and leader election to make progress. They sacrifice the guarantee of always terminating (they may not terminate during periods of severe instability) in exchange for terminating during normal operation.

### 1.4 The Fault Model Matters

Before building any distributed system, you must choose a fault model — what kinds of failures you are designing to tolerate.

**Crash-stop (fail-stop):** A failed process stops permanently. It never sends incorrect messages. Other processes can eventually detect the failure (though not instantly). This is the simplest model and the one Raft assumes.

**Crash-recovery:** A failed process may restart, potentially with its state restored from durable storage. This is more realistic — real servers restart after crashes. Raft handles crash-recovery by requiring that durable writes (to disk) precede any acknowledgment.

**Byzantine:** A failed process may behave arbitrarily — sending conflicting messages to different nodes, sending incorrect values, or acting deliberately malicious. This is the hardest fault model to tolerate. Byzantine Fault Tolerance (BFT) requires more than 2/3 of nodes to be correct and is dramatically more expensive than crash-stop tolerance. Blockchain consensus algorithms (PBFT, Tendermint) are designed for Byzantine faults.

**Network faults:** In addition to node faults, networks can:
- Drop messages (omission faults)
- Delay messages arbitrarily
- Reorder messages
- Duplicate messages
- Partition the network (some nodes cannot communicate with others)

Most practical systems assume crash-recovery fault tolerance for nodes and best-effort delivery for the network (messages may be lost or delayed, but not forged).

---

## Part 2: Time Without a Clock

### 2.1 The Problem with Physical Clocks

Physical clocks on different machines drift apart. Two machines synchronized to within 1ms at time T may be 10ms apart at time T + 1 hour, depending on their crystal oscillators, temperature, and load.

This causes a fundamental problem: you cannot use timestamps to determine the order of events across machines. An event on machine A with timestamp 100 may have happened *after* an event on machine B with timestamp 102, if machine A's clock is running fast.

The consequences are real:

- Database transactions that span machines cannot use timestamps to determine order
- A last-write-wins conflict resolution strategy ("the write with the higher timestamp wins") may choose the wrong write
- Audit logs across machines may show events in the wrong order

The solution, pioneered by Leslie Lamport in his 1978 paper "Time, Clocks, and the Ordering of Events in a Distributed System," is to reason about ordering without relying on physical clocks.

### 2.2 The Happens-Before Relation

The **happens-before** relation (→) defines a partial order on events in a distributed system, based purely on causality:

1. If events a and b are in the same process, and a happens before b in execution order, then a → b.

2. If process P sends a message and process Q receives it, then the send event → the receive event.

3. If a → b and b → c, then a → c (transitivity).

Two events are **concurrent** if neither a → b nor b → a. Concurrency means neither can have caused the other.

This relation captures something real: if a → b, then b might have been influenced by a. If a and b are concurrent, neither can have affected the other.

### 2.3 Lamport Clocks

A **Lamport clock** is a simple mechanism for assigning timestamps that are consistent with the happens-before relation.

**Rules:**
1. Each process maintains a counter `t`, initially 0
2. Before each event, increment `t`: `t = t + 1`
3. When sending a message, include the current `t` in the message
4. When receiving a message with timestamp `t_msg`, set `t = max(t, t_msg) + 1`

**Key property:** If a → b, then `timestamp(a) < timestamp(b)`.

**Limitation:** The converse is not guaranteed. `timestamp(a) < timestamp(b)` does NOT imply a → b. Two concurrent events may have any relative timestamp ordering.

```zig
const std = @import("std");
const atomic = std.atomic;

/// Lamport clock: thread-safe monotonic counter
pub const LamportClock = struct {
    time: atomic.Value(u64),

    pub fn init() LamportClock {
        return .{ .time = atomic.Value(u64).init(0) };
    }

    /// Increment before each local event. Returns the new timestamp.
    pub fn tick(self: *LamportClock) u64 {
        return self.time.fetchAdd(1, .monotonic) + 1;
    }

    /// Call when sending a message. Returns the timestamp to embed.
    pub fn send(self: *LamportClock) u64 {
        return self.tick();
    }

    /// Call when receiving a message with the given sender timestamp.
    /// Returns the updated local timestamp.
    pub fn receive(self: *LamportClock, sender_time: u64) u64 {
        // Set to max(local, sender) + 1
        var current = self.time.load(.monotonic);
        const target = @max(current, sender_time) + 1;

        // CAS loop to atomically update
        while (true) {
            const result = self.time.cmpxchgWeak(
                current, target, .monotonic, .monotonic);
            if (result == null) return target; // success
            current = result.?; // someone else updated it
            if (current >= target) return current; // already at or ahead of target
        }
    }

    pub fn get(self: *const LamportClock) u64 {
        return self.time.load(.monotonic);
    }
};

/// Message with Lamport timestamp
pub fn Message(comptime Payload: type) type {
    return struct {
        sender_id: u32,
        lamport_time: u64,
        payload: Payload,
    };
}

/// Demonstration: three processes with Lamport clocks
pub fn demonstrate_lamport() void {
    var clock_a = LamportClock.init();
    var clock_b = LamportClock.init();
    var clock_c = LamportClock.init();

    // Process A performs a local event, then sends to B
    const a_event1 = clock_a.tick();
    std.debug.print("A local event: t={d}\n", .{a_event1});

    const a_send_to_b = clock_a.send();
    std.debug.print("A sends to B: t={d}\n", .{a_send_to_b});

    // Process B receives from A
    const b_recv_from_a = clock_b.receive(a_send_to_b);
    std.debug.print("B receives from A: t={d}\n", .{b_recv_from_a});

    // Process B sends to C
    const b_send_to_c = clock_b.send();
    std.debug.print("B sends to C: t={d}\n", .{b_send_to_c});

    // Process C does a local event (concurrent with B's send)
    const c_local = clock_c.tick();
    std.debug.print("C local event (concurrent): t={d}\n", .{c_local});

    // Process C receives from B
    const c_recv_from_b = clock_c.receive(b_send_to_c);
    std.debug.print("C receives from B: t={d}\n", .{c_recv_from_b});

    // Verify happens-before:
    // a_event1 → a_send_to_b → b_recv_from_a → b_send_to_c → c_recv_from_b
    // timestamps should be strictly increasing along this chain
    std.debug.assert(a_event1 < a_send_to_b);
    std.debug.assert(a_send_to_b < b_recv_from_a);
    std.debug.assert(b_recv_from_a < b_send_to_c);
    std.debug.assert(b_send_to_c < c_recv_from_b);
    std.debug.print("All happens-before relationships verified.\n", .{});
}
```

### 2.4 Vector Clocks

Lamport clocks establish a total order that is consistent with happens-before, but they cannot detect concurrency. If `timestamp(a) < timestamp(b)`, you cannot tell whether a → b or they are concurrent.

**Vector clocks** solve this. Each process maintains a vector of N integers, one per process. The rules:

1. Each process Pi initializes its vector `V` to all zeros: `V[j] = 0` for all j
2. Before each event, Pi increments its own entry: `V[i] = V[i] + 1`
3. When Pi sends a message, it includes its current vector
4. When Pi receives a message with vector `V_msg`, Pi sets `V[j] = max(V[j], V_msg[j])` for all j, then increments `V[i]`

**Key property:** a → b if and only if `V(a) < V(b)` (every component of V(a) is ≤ the corresponding component of V(b), with at least one strictly less).

**Concurrent detection:** Events a and b are concurrent if neither `V(a) ≤ V(b)` nor `V(b) ≤ V(a)`.

```zig
const std = @import("std");

pub fn VectorClock(comptime N: usize) type {
    return struct {
        const Self = @This();

        process_id: usize,
        clock: [N]u64,

        pub fn init(process_id: usize) Self {
            return .{
                .process_id = process_id,
                .clock = [_]u64{0} ** N,
            };
        }

        /// Increment before a local event or send.
        pub fn tick(self: *Self) [N]u64 {
            self.clock[self.process_id] += 1;
            return self.clock;
        }

        /// Update when receiving a message with the given vector.
        pub fn receive(self: *Self, msg_vector: [N]u64) [N]u64 {
            for (0..N) |i| {
                self.clock[i] = @max(self.clock[i], msg_vector[i]);
            }
            self.clock[self.process_id] += 1;
            return self.clock;
        }

        pub fn get(self: *const Self) [N]u64 {
            return self.clock;
        }

        /// Returns true if a strictly happened-before b:
        /// all components of a ≤ b, with at least one strictly <
        pub fn happened_before(a: [N]u64, b: [N]u64) bool {
            var all_leq = true;
            var any_lt = false;
            for (0..N) |i| {
                if (a[i] > b[i]) { all_leq = false; break; }
                if (a[i] < b[i]) any_lt = true;
            }
            return all_leq and any_lt;
        }

        /// Returns true if a and b are concurrent (neither happened-before)
        pub fn concurrent(a: [N]u64, b: [N]u64) bool {
            return !happened_before(a, b) and !happened_before(b, a);
        }
    };
}

const VC3 = VectorClock(3); // 3-process system

pub fn demonstrate_vector_clocks() void {
    var p0 = VC3.init(0);
    var p1 = VC3.init(1);
    var p2 = VC3.init(2);

    // P0 does a local event
    const p0_e1 = p0.tick();
    std.debug.print("P0 event1: {any}\n", .{p0_e1});

    // P0 sends to P1
    const p0_send = p0.tick();
    std.debug.print("P0 sends: {any}\n", .{p0_send});

    // P2 does a local event (concurrent with P0's send)
    const p2_e1 = p2.tick();
    std.debug.print("P2 event1 (concurrent): {any}\n", .{p2_e1});

    // P1 receives from P0
    const p1_recv = p1.receive(p0_send);
    std.debug.print("P1 receives: {any}\n", .{p1_recv});

    // Check relationships
    std.debug.print("\np0_e1 → p0_send: {}\n",
        .{VC3.happened_before(p0_e1, p0_send)}); // true
    std.debug.print("p0_send → p1_recv: {}\n",
        .{VC3.happened_before(p0_send, p1_recv)}); // true
    std.debug.print("p0_send || p2_e1 (concurrent): {}\n",
        .{VC3.concurrent(p0_send, p2_e1)}); // true
    std.debug.print("p2_e1 → p1_recv: {}\n",
        .{VC3.happened_before(p2_e1, p1_recv)}); // false
}
```

### 2.5 Physical Clocks and Hybrid Logical Clocks

For practical systems, purely logical clocks have a drawback: they lose the relationship to wall-clock time. You cannot use a Lamport timestamp to answer "did event A happen in the last hour?"

**Hybrid Logical Clocks (HLC)** combine physical and logical time. Each timestamp is a pair `(physical_time, logical_counter)`. The physical component tracks wall-clock time; the logical component breaks ties and captures causality within the same millisecond.

CockroachDB, Google Spanner (using TrueTime), and YugabyteDB all use variants of this approach. The key insight: if physical clocks are synchronized within a bounded error ε, you can use physical time for coarse ordering and logical clocks for fine ordering within that ε window.

```zig
/// Hybrid Logical Clock timestamp
pub const HlcTimestamp = struct {
    /// Wall clock time in milliseconds (from monotonic clock)
    physical_ms: u64,
    /// Logical counter: distinguishes events within the same millisecond
    logical: u32,
    /// Node ID: distinguishes events with same physical+logical (for total order)
    node_id: u16,

    pub fn less_than(self: HlcTimestamp, other: HlcTimestamp) bool {
        if (self.physical_ms != other.physical_ms)
            return self.physical_ms < other.physical_ms;
        if (self.logical != other.logical)
            return self.logical < other.logical;
        return self.node_id < other.node_id;
    }
};

pub const HlcClock = struct {
    last: HlcTimestamp,
    node_id: u16,

    pub fn init(node_id: u16) HlcClock {
        return .{
            .last = .{ .physical_ms = 0, .logical = 0, .node_id = node_id },
            .node_id = node_id,
        };
    }

    fn now_ms() u64 {
        var ts: std.os.linux.timespec = undefined;
        _ = std.os.linux.clock_gettime(std.os.linux.CLOCK.REALTIME, &ts);
        return @as(u64, @intCast(ts.sec)) * 1000 +
               @as(u64, @intCast(ts.nsec)) / 1_000_000;
    }

    /// Generate a new timestamp for a local event or send
    pub fn tick(self: *HlcClock) HlcTimestamp {
        const pt = now_ms();
        if (pt > self.last.physical_ms) {
            self.last = .{ .physical_ms = pt, .logical = 0, .node_id = self.node_id };
        } else {
            self.last.logical += 1;
        }
        return self.last;
    }

    /// Update when receiving a message with the given timestamp
    pub fn receive(self: *HlcClock, msg_ts: HlcTimestamp) HlcTimestamp {
        const pt = now_ms();
        const max_physical = @max(pt, msg_ts.physical_ms);

        if (max_physical > self.last.physical_ms) {
            if (max_physical == pt) {
                self.last = .{ .physical_ms = pt, .logical = 0, .node_id = self.node_id };
            } else {
                self.last = .{ .physical_ms = msg_ts.physical_ms,
                               .logical = msg_ts.logical + 1,
                               .node_id = self.node_id };
            }
        } else {
            // max_physical == self.last.physical_ms
            self.last.logical = @max(self.last.logical, msg_ts.logical) + 1;
        }
        return self.last;
    }
};
```

---

## Part 3: CAP Theorem — What It Actually Says

### 3.1 The Three Properties

The CAP theorem (Brewer 2000, Gilbert & Lynch 2002) states that a distributed data store cannot simultaneously guarantee all three of:

**Consistency (C):** Every read receives the most recent write or an error. More precisely: linearizability — the system behaves as if there is a single copy of the data and all operations on it happen atomically at some point in real time.

**Availability (A):** Every request to a non-failing node receives a response (not a timeout or error). The response may not contain the most recent data.

**Partition tolerance (P):** The system continues to operate even when the network splits into groups of nodes that cannot communicate with each other.

### 3.2 Why P is Not Optional

Network partitions happen. Hardware fails, cables are cut, switches crash, BGP routes flap. The question is not whether to support partition tolerance — it is whether to continue operating during a partition or to halt.

A system that halts during a partition is partition-intolerant. This is sometimes the right choice (a single-machine database has no partitions to tolerate), but for a distributed system deployed on multiple machines or across data centers, partition tolerance is necessary for availability.

Therefore, the real tradeoff is between **C and A during a partition**:

**CP system:** During a partition, the system refuses to respond (or returns errors) to maintain consistency. No stale reads. No split-brain writes. But some clients see unavailability. Examples: ZooKeeper, etcd, HBase.

**AP system:** During a partition, the system continues serving requests using whatever data it has, accepting that responses may be stale or that writes may conflict. All clients get a response, but it may not be the most recent. Examples: Cassandra, DynamoDB (in eventual consistency mode), CouchDB.

### 3.3 CAP is Too Coarse — Enter PACELC

The CAP theorem only describes behavior during partitions. But partitions are rare in well-operated data centers. Most of the time, a system operates without partition. What are the tradeoffs then?

The **PACELC theorem** (Daniel Abadi, 2012) fills this gap:

> If there is a **P**artition, choose between **A**vailability and **C**onsistency. **E**lse (during normal operation), choose between **L**atency and **C**onsistency.

The latency-consistency tradeoff is real even without partitions: to achieve strong consistency, a write must be confirmed by a quorum of replicas before acknowledging to the client. This takes time — at least one round-trip to replicas. Weaker consistency (acknowledging before replication is complete) reduces latency but allows stale reads.

| System | Partition behavior | Normal behavior |
|--------|-------------------|-----------------|
| MySQL/InnoDB | CP | LC (low latency, moderate consistency) |
| etcd | CP | EC (high consistency, higher latency) |
| Cassandra | AP | EL (low latency, eventual consistency) |
| DynamoDB | AP | EL (tunable) |
| Spanner | CP | EC (uses TrueTime for strong consistency) |

### 3.4 A Common Misconception

CAP is often stated as "choose 2 of 3." This framing is misleading because:

1. As discussed, P is not really optional for distributed systems. The choice is C vs A *during partitions*.

2. Consistency in CAP means linearizability — not the "C" in ACID, which means something different (data integrity constraints are maintained).

3. Availability in CAP has a precise definition (non-failing nodes must respond) that differs from the colloquial "the system is available."

4. The theorem applies to individual operations, not to the system as a whole. A system can make different tradeoffs for different operations.

Martin Kleppmann's critique of CAP argues that it provides limited guidance for practical system design precisely because its definitions are too formal to match real-world systems. The PACELC framework and the formal consistency hierarchy (linearizability → sequential consistency → causal consistency → eventual consistency) provide more actionable guidance.

---

## Part 4: A Distributed System Simulator

### 4.1 Simulation as a Learning Tool

Before building real distributed systems, build a simulator. A simulator lets you inject faults — message delays, dropped messages, node crashes, network partitions — in a controlled way, observe the consequences, and verify that your algorithms handle them correctly.

The simulator models a network of nodes connected by unreliable links. It is single-threaded (sequential simulation) but models the behavior of a concurrent distributed system by explicitly representing the state of each node, the messages in flight, and the simulated clock.

### 4.2 The Simulator Core

```zig
const std = @import("std");

/// A message in the simulated network
pub const SimMessage = struct {
    from: u32,
    to: u32,
    data: []const u8,
    /// Simulated delivery time (in simulator ticks)
    deliver_at: u64,
};

/// Node states
pub const NodeState = enum {
    running,
    crashed,
    recovering,
};

/// A simulated node
pub const SimNode = struct {
    id: u32,
    state: NodeState,
    /// Lamport clock for this node
    clock: LamportClock,
    /// Node's local KV store (simplified)
    kv: std.StringHashMap([]const u8),
    /// Messages received but not yet processed
    inbox: std.ArrayList(SimMessage),
    allocator: std.mem.Allocator,

    pub fn init(id: u32, allocator: std.mem.Allocator) SimNode {
        return .{
            .id = id,
            .state = .running,
            .clock = LamportClock.init(),
            .kv = std.StringHashMap([]const u8).init(allocator),
            .inbox = std.ArrayList(SimMessage).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *SimNode) void {
        self.kv.deinit();
        self.inbox.deinit();
    }

    pub fn crash(self: *SimNode) void {
        self.state = .crashed;
        // On crash, in-memory state is lost (crash-recovery model:
        // durable state on disk is preserved)
        std.debug.print("Node {d} crashed at clock={d}\n",
            .{self.id, self.clock.get()});
    }

    pub fn recover(self: *SimNode) void {
        self.state = .running;
        // In a real crash-recovery system, state would be restored from disk
        std.debug.print("Node {d} recovered at clock={d}\n",
            .{self.id, self.clock.get()});
    }
};

/// The network: models message passing with configurable reliability
pub const SimNetwork = struct {
    nodes: []SimNode,
    /// Messages in flight
    in_flight: std.ArrayList(SimMessage),
    /// Current simulation tick
    tick: u64,
    /// Random number generator for fault injection
    rng: std.rand.DefaultPrng,
    allocator: std.mem.Allocator,

    /// Fault parameters
    drop_probability: f32,      // 0.0 = no drops, 1.0 = always drop
    max_delay_ticks: u32,       // maximum message delay in ticks
    /// Partitioned node pairs: messages between these nodes are dropped
    partitions: std.ArrayList([2]u32),

    pub fn init(
        n_nodes: usize,
        drop_prob: f32,
        max_delay: u32,
        seed: u64,
        allocator: std.mem.Allocator,
    ) !SimNetwork {
        const nodes = try allocator.alloc(SimNode, n_nodes);
        for (nodes, 0..) |*node, i| {
            node.* = SimNode.init(@intCast(i), allocator);
        }

        return .{
            .nodes = nodes,
            .in_flight = std.ArrayList(SimMessage).init(allocator),
            .tick = 0,
            .rng = std.rand.DefaultPrng.init(seed),
            .allocator = allocator,
            .drop_probability = drop_prob,
            .max_delay_ticks = max_delay,
            .partitions = std.ArrayList([2]u32).init(allocator),
        };
    }

    pub fn deinit(self: *SimNetwork) void {
        for (self.nodes) |*node| node.deinit();
        self.allocator.free(self.nodes);
        self.in_flight.deinit();
        self.partitions.deinit();
    }

    /// Create a network partition between node a and node b.
    /// Messages between them are dropped until heal_partition is called.
    pub fn partition(self: *SimNetwork, a: u32, b: u32) !void {
        try self.partitions.append(.{a, b});
        std.debug.print("Partition created: node {d} ↔ node {d} disconnected\n",
            .{a, b});
    }

    pub fn heal_partition(self: *SimNetwork, a: u32, b: u32) void {
        var i: usize = 0;
        while (i < self.partitions.items.len) {
            const p = self.partitions.items[i];
            if ((p[0] == a and p[1] == b) or (p[0] == b and p[1] == a)) {
                _ = self.partitions.swapRemove(i);
            } else {
                i += 1;
            }
        }
        std.debug.print("Partition healed: node {d} ↔ node {d} reconnected\n",
            .{a, b});
    }

    fn is_partitioned(self: *const SimNetwork, from: u32, to: u32) bool {
        for (self.partitions.items) |p| {
            if ((p[0] == from and p[1] == to) or
                (p[0] == to and p[1] == from)) return true;
        }
        return false;
    }

    /// Send a message from node `from` to node `to`.
    /// The message may be dropped or delayed based on fault parameters.
    pub fn send(self: *SimNetwork, from: u32, to: u32,
                data: []const u8) !void {
        if (from >= self.nodes.len or to >= self.nodes.len) return;
        if (self.nodes[from].state == .crashed) return;

        // Check partition
        if (self.is_partitioned(from, to)) {
            std.debug.print("  Message dropped (partition): {d} → {d}\n",
                .{from, to});
            return;
        }

        // Random drop
        if (self.rng.random().float(f32) < self.drop_probability) {
            std.debug.print("  Message dropped (random): {d} → {d}\n",
                .{from, to});
            return;
        }

        // Random delay
        const delay = self.rng.random().uintLessThan(u32, self.max_delay_ticks + 1);
        const deliver_at = self.tick + delay;

        try self.in_flight.append(.{
            .from = from,
            .to = to,
            .data = data,
            .deliver_at = deliver_at,
        });
    }

    /// Advance simulation by one tick.
    /// Delivers all messages whose deliver_at <= current tick.
    pub fn advance(self: *SimNetwork) !void {
        self.tick += 1;

        var i: usize = 0;
        while (i < self.in_flight.items.len) {
            const msg = self.in_flight.items[i];
            if (msg.deliver_at <= self.tick) {
                _ = self.in_flight.swapRemove(i);

                // Deliver to recipient if not crashed
                if (self.nodes[msg.to].state == .running) {
                    try self.nodes[msg.to].inbox.append(msg);
                }
            } else {
                i += 1;
            }
        }
    }

    /// Process all pending inbox messages for a node.
    pub fn process_inbox(self: *SimNetwork, node_id: u32,
                          handler: *const fn (*SimNode, SimMessage) void) void {
        const node = &self.nodes[node_id];
        if (node.state != .running) return;

        for (node.inbox.items) |msg| {
            handler(node, msg);
        }
        node.inbox.clearRetainingCapacity();
    }
};
```

### 4.3 Demonstrating CAP with the Simulator

```zig
/// A simple replicated register: demonstrates CP vs AP behavior during partition
pub fn demonstrate_cap(allocator: std.mem.Allocator) !void {
    // Two-node system: node 0 (primary), node 1 (replica)
    var net = try SimNetwork.init(2, 0.0, 1, 42, allocator);
    defer net.deinit();

    std.debug.print("\n=== CP Behavior: Consistency over Availability ===\n", .{});
    {
        // CP: A write succeeds only when acknowledged by BOTH nodes.
        // During partition: writes that cannot be confirmed are rejected.

        // Normal operation: write "hello" to key "x"
        // Primary writes, waits for replica ACK
        std.debug.print("Normal: write x=hello\n", .{});
        std.debug.print("  Primary writes locally\n", .{});
        std.debug.print("  Primary sends to replica\n", .{});
        try net.advance(); // deliver replication message
        std.debug.print("  Replica acknowledges\n", .{});
        std.debug.print("  Write committed: x=hello visible to all\n", .{});

        // Create partition
        try net.partition(0, 1);

        // CP behavior during partition: REJECT the write
        std.debug.print("\nDuring partition: write x=world\n", .{});
        std.debug.print("  Primary tries to replicate... timeout\n", .{});
        std.debug.print("  CP system: REJECT write (cannot confirm replica)\n", .{});
        std.debug.print("  Client receives: error: unavailable\n", .{});
        std.debug.print("  x still = hello (no stale read possible)\n", .{});

        net.heal_partition(0, 1);
    }

    std.debug.print("\n=== AP Behavior: Availability over Consistency ===\n", .{});
    {
        // AP: writes always succeed locally; replicas sync eventually.
        // During partition: both sides accept writes independently.

        try net.partition(0, 1);

        std.debug.print("During partition: client A writes x=v1 to node 0\n", .{});
        std.debug.print("  Node 0 accepts (AP: serve even during partition)\n", .{});
        std.debug.print("  Node 0: x=v1\n", .{});

        std.debug.print("During partition: client B writes x=v2 to node 1\n", .{});
        std.debug.print("  Node 1 accepts (AP: serve even during partition)\n", .{});
        std.debug.print("  Node 1: x=v2\n", .{});

        std.debug.print("  INCONSISTENCY: nodes disagree on x\n", .{});

        net.heal_partition(0, 1);

        std.debug.print("\nAfter heal: conflict resolution needed\n", .{});
        std.debug.print("  Last-write-wins? Merge? Application-defined?\n", .{});
        std.debug.print("  AP systems must handle this — there is no free lunch\n", .{});
    }
}
```

---

## Part 5: The Consistency Spectrum

### 5.1 Not Binary — A Spectrum

Consistency is not a binary choice between "strongly consistent" and "eventually consistent." There is a rich spectrum of consistency models between these extremes, each offering different guarantees and different performance characteristics.

From strongest to weakest:

**Linearizability (strict consistency):** The strongest model. Every operation appears to take effect instantaneously at some point between its invocation and completion. A read always returns the most recent write. This is what you get from a single-machine mutex-protected data structure. To implement in a distributed system, every operation must coordinate with a quorum.

**Sequential consistency:** Operations from each individual process appear in that process's program order, and all processes see the same total order of operations. Weaker than linearizability — the order seen does not have to correspond to real time. Allows some reordering across processes.

**Causal consistency:** Operations that are causally related appear in the same order to all processes. Concurrent operations (those with no causal relationship) may appear in any order. Implementable without global coordination.

**Read-your-writes (session consistency):** A client always reads values it has written, even if those writes have not yet propagated to all replicas. Requires routing reads to the replica that has the client's writes.

**Eventual consistency:** If no new writes occur, all replicas will eventually converge to the same value. No guarantee of how long "eventually" takes. The weakest useful consistency model.

### 5.2 Choosing a Consistency Level

The right consistency level depends on the application:

**Financial systems (bank balances, inventory counts):** Linearizability or serializable transactions. An incorrect balance is worse than unavailability.

**Social media likes/views:** Eventual consistency. Whether a post has 10,000 or 10,001 likes does not matter for correctness. High availability and low latency matter more.

**User session data:** Read-your-writes. A user who logs in must see their own data, but seeing another user's stale profile is acceptable.

**Collaborative editing:** Causal consistency (plus conflict-free data structures). Operations by the same user must appear in order; concurrent edits by different users may be merged.

**Leaderboards/rankings:** Eventual consistency with periodic reconciliation. Rankings can be approximate and updated in batches.

### 5.3 Quorums

Many distributed systems use **quorum-based** coordination to achieve a tunable consistency-availability tradeoff. In a system with N replicas:

**Write quorum W:** A write is acknowledged after W replicas have confirmed it.
**Read quorum R:** A read is satisfied after R replicas respond.

If W + R > N, reads and writes overlap — any read quorum includes at least one node that participated in the last write, guaranteeing that the read sees the latest write.

Classic configurations:
- W=N, R=1: Strong consistency for reads, high write latency (must contact all N)
- W=1, R=N: Strong consistency for reads, low write latency (only 1 write needed), high read latency
- W=N/2+1, R=N/2+1: Balanced — majority quorum, tolerates N/2 failures

Cassandra exposes these as tunable consistency levels: `ONE`, `QUORUM`, `ALL`. Different operations can use different consistency levels — a user's profile read might use `ONE` (low latency), while an account balance might use `QUORUM` (strong consistency).

```zig
/// Quorum calculator
pub const QuorumConfig = struct {
    n_replicas: u32,
    write_quorum: u32,
    read_quorum: u32,

    pub fn majority(n: u32) QuorumConfig {
        const majority = n / 2 + 1;
        return .{ .n_replicas = n, .write_quorum = majority, .read_quorum = majority };
    }

    pub fn is_valid(self: QuorumConfig) bool {
        // Must overlap: W + R > N
        return self.write_quorum + self.read_quorum > self.n_replicas;
    }

    pub fn max_tolerable_failures(self: QuorumConfig) u32 {
        return self.n_replicas - self.write_quorum;
    }

    pub fn print_analysis(self: QuorumConfig) void {
        std.debug.print("Quorum config: N={d} W={d} R={d}\n", .{
            self.n_replicas, self.write_quorum, self.read_quorum});
        std.debug.print("  Valid (W+R > N): {}\n", .{self.is_valid()});
        std.debug.print("  Max failures tolerated: {d}\n",
            .{self.max_tolerable_failures()});
        std.debug.print("  Read latency: proportional to {}th slowest replica\n",
            .{self.read_quorum});
        std.debug.print("  Write latency: proportional to {}th slowest replica\n",
            .{self.write_quorum});
    }
};
```

---

## Part 6: The Module Project — Distributed Simulation Suite

### Project Specification

Build a complete distributed system simulation environment that demonstrates the concepts from this module with observable, measurable behavior.

### Simulation 1: Two Generals Impossibility

Show that no finite protocol achieves certainty:

```zig
pub fn simulate_two_generals(net: *SimNetwork, rounds: usize) !void {
    // Two nodes: 0 and 1
    // They try to coordinate via message exchange
    // Each round: 0 sends, 1 acks, 0 acks the ack, ...
    // Measure: confidence level after N rounds
    // Show: confidence asymptotically approaches 1 but never reaches it

    for (1..rounds + 1) |round| {
        const drop_prob = 0.1; // 10% message loss
        // Probability both receive the last message: (1 - drop_prob)^round
        const confidence = std.math.pow(f64, 1.0 - drop_prob,
            @as(f64, @floatFromInt(round)));
        std.debug.print("Round {d}: confidence = {d:.4} ({d:.2}% certain)\n",
            .{ round, confidence, confidence * 100 });
    }
    std.debug.print("Maximum achievable confidence: < 1.0 (never 100%)\n", .{});
}
```

### Simulation 2: Clock Skew and Event Ordering

Demonstrate that physical clocks cannot order events across nodes:

```zig
pub fn simulate_clock_skew(allocator: std.mem.Allocator) !void {
    // Three nodes with different clock skews
    // Node 0: clock runs at normal rate
    // Node 1: clock runs 10% fast
    // Node 2: clock runs 5% slow

    var physical_clocks = [_]f64{ 0.0, 0.0, 0.0 };
    const skew = [_]f64{ 1.0, 1.1, 0.95 };

    var lamport = [_]LamportClock{
        LamportClock.init(),
        LamportClock.init(),
        LamportClock.init(),
    };

    std.debug.print("\n=== Clock Skew vs Lamport Clock Demo ===\n", .{});
    std.debug.print("{s:<8} {s:>14} {s:>14} {s:>14} {s:>14}\n",
        .{"Event", "Physical N0", "Physical N1", "Physical N2", "Correct Order"});

    // Simulate events across nodes
    const events = [_]struct { node: usize, msg: []const u8 }{
        .{ .node = 0, .msg = "N0 writes x=1" },
        .{ .node = 1, .msg = "N1 reads x" },
        .{ .node = 2, .msg = "N2 writes x=2" },
    };

    for (events, 0..) |ev, i| {
        // Advance simulated time
        for (&physical_clocks, 0..) |*c, j| {
            c.* += skew[j] * 100.0; // 100ms per step
        }

        const phys = physical_clocks[ev.node];
        const logical = lamport[ev.node].tick();

        std.debug.print("{d:<8} {d:>14.1} ms                    L={d}\n",
            .{ i, phys, logical });
        std.debug.print("         {s}\n", .{ev.msg});
    }

    std.debug.print("\nConclusion: physical timestamps from N1 appear BEFORE N0's\n", .{});
    std.debug.print("even though N0's event happened first (N1's clock runs fast)\n", .{});
    std.debug.print("Lamport clocks correctly capture the causal ordering.\n", .{});
    _ = allocator;
}
```

### Simulation 3: CAP Tradeoff Under Partition

Build a two-node replicated key-value store with switchable CP/AP behavior. Run a partition scenario and measure:
- CP mode: writes rejected during partition, zero stale reads after partition heals
- AP mode: writes accepted during partition, conflict rate after partition heals

Report:
- Availability during partition (% of operations that succeed)
- Consistency after partition heals (% of reads returning the most recent write)

### Simulation 4: Quorum Comparison

For a 5-node system, compare these quorum configurations under 0%, 10%, and 30% message loss:

| Config | W | R | Expected behavior |
|--------|---|---|-------------------|
| Majority | 3 | 3 | Balanced |
| Write-heavy | 2 | 4 | Fast writes |
| Read-heavy | 4 | 2 | Fast reads |
| Weak | 1 | 1 | High availability, eventual consistency |

Measure for each: throughput (ops/second), staleness rate (% of reads returning non-latest value), and availability under increasing node failures.

---

## Summary

Distributed systems are not simply "more machines." They are a qualitatively different computational model where the assumptions that make single-machine programming tractable — shared memory, reliable operations, detectable failures, synchronized clocks — no longer hold.

**The Two Generals Problem** proves that absolute certainty of coordination in the presence of message loss is impossible. Every protocol must accept some level of uncertainty.

**FLP Impossibility** proves that in an asynchronous system with any process failures, no consensus algorithm can guarantee both safety and liveness. Real consensus algorithms (Raft, Paxos) add timing assumptions to work around FLP, accepting that they may not terminate in adversarial conditions.

**CAP theorem** says that during a network partition, a distributed system must choose between consistency (every read gets the latest write, even if it means refusing some requests) and availability (every request gets a response, even if the response may be stale).

**PACELC** extends CAP to cover normal operation: even without partitions, there is a tradeoff between latency (how fast operations complete) and consistency (how fresh the data is).

**Lamport clocks** establish a consistent ordering of events without relying on physical time, based purely on causality. If a → b, then timestamp(a) < timestamp(b).

**Vector clocks** capture the full causality structure: they can detect both happens-before relationships and concurrency. Two events are concurrent if neither's vector is dominated by the other's.

**The consistency spectrum** — from linearizability to eventual consistency — offers a range of tradeoffs between performance and correctness guarantees. The right choice depends on the application's tolerance for stale reads and incorrect writes.

---

## What's Next

Module 16 — Replication and Consensus — takes the theoretical foundation from this module and builds the Raft consensus algorithm on top of it. Raft is the algorithm that powers etcd, CockroachDB, TiKV, and countless other production distributed systems. You will implement it from scratch using ZigWire as the transport, running on the distributed simulator from this module.

---

## Reference: Impossibility Results and Their Implications

```
Result      | What it proves                  | Practical implication
────────────────────────────────────────────────────────────────────────
Two         | No finite protocol guarantees   | Accept probabilistic
Generals    | coordination under message loss | guarantees; use timeouts
            |                                 | and retries
────────────────────────────────────────────────────────────────────────
FLP         | No consensus algorithm is       | Add timing assumptions
            | safe, live, and fault-tolerant  | (Raft uses timeouts);
            | in async systems                | sacrifice guaranteed
            |                                 | termination
────────────────────────────────────────────────────────────────────────
CAP         | During partition: choose        | Design explicitly for
            | consistency or availability,    | CP or AP; don't pretend
            | not both                        | you can have both
────────────────────────────────────────────────────────────────────────
PACELC      | Even without partition:         | Strong consistency costs
            | strong consistency costs        | latency always, not just
            | latency                         | during partitions
────────────────────────────────────────────────────────────────────────

Consistency model hierarchy (strongest to weakest):
  Linearizability → Sequential consistency → Causal consistency →
  Read-your-writes → Monotonic reads → Eventual consistency

Fault model hierarchy (easiest to hardest to tolerate):
  Crash-stop → Crash-recovery → Omission → Byzantine

Quorum rule: W + R > N guarantees reading the latest write
  - Majority quorum: W = R = ⌊N/2⌋ + 1
  - Tolerates ⌊N/2⌋ failures
```

---

*End of Module 15*
