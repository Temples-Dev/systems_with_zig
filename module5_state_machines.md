# Module 5: State and the State Machine Model

## The Craft of Systems Programming — Teaching Material

---

> *"A program without state is a function. A program with state is a system. The difference is not just complexity — it is an entirely different class of reasoning."*

---

## Before You Begin

The first four modules have built a progressively deeper picture of how programs run: how data is represented, how the processor executes, how the OS loads and manages programs, and how memory is acquired and released. Each of these is a view of the machine at a specific level.

This module introduces something different: a way of *thinking about* programs — a mental model so fundamental that it underlies TCP connections, protocol parsers, compilers, schedulers, game logic, and virtually every significant piece of systems software ever written.

That model is the **state machine**.

Every system that changes behavior in response to inputs — every system that has memory of what happened before — is a state machine, whether or not it was designed as one. A TCP connection that moves from LISTEN to SYN_RECEIVED to ESTABLISHED is a state machine. An HTTP parser that reads a header byte by byte is a state machine. A task scheduler that tracks which processes are runnable, sleeping, or blocked is a state machine. An elevator controller is a state machine. A vending machine is a state machine.

The question is not whether your systems are state machines. They are. The question is whether you *design* them explicitly as state machines — with named states, named transitions, and the compiler enforcing completeness — or whether state is scattered across boolean flags, nested conditionals, and global variables that create bugs no one can reason about.

This module teaches you to design and implement state machines correctly. By the time you reach the capstone — a complete TCP connection state machine — you will have a tool you will use for the rest of your career.

---

## Learning Objectives

By the end of this module, you will be able to:

- Define a finite state machine formally and explain the five components of its definition
- Implement a state machine in Zig using enums, tagged unions, and exhaustive `switch` statements
- Explain why Zig's exhaustive `switch` is a correctness tool, not just syntax
- Implement a binary protocol parser as a state machine that correctly handles partial input
- Implement a process lifecycle state machine with all transitions and guards
- Implement the TCP connection state machine and trace real TCP handshakes through it
- Explain the difference between Mealy and Moore machines and when each is appropriate
- Use tagged unions to attach data to states and eliminate invalid state/data combinations
- Identify implicit state machines in existing code and refactor them into explicit form

---

## Part 1: What Is a State Machine?

### 1.1 The Problem with Implicit State

Before introducing the formal model, consider a common problem. You are writing code to handle an HTTP connection. The connection can receive data, send data, upgrade to WebSocket, or close. You start with boolean flags:

```zig
// First attempt: boolean flags
var is_connected: bool = false;
var is_upgraded: bool = false;
var is_closing: bool = false;
var has_sent_headers: bool = false;
```

Now you need to handle a new request. But what does it mean for `is_connected = true` and `is_closing = true` at the same time? Is that valid? What about `is_upgraded = true` and `has_sent_headers = false`? You end up writing defensive checks everywhere:

```zig
fn handle_data(data: []const u8) !void {
    if (!is_connected) return error.NotConnected;
    if (is_closing) return error.Closing;
    if (is_upgraded and !has_sent_headers) return error.InvalidState;
    // ... actual work
}
```

The states are implicit — encoded in combinations of boolean flags. The valid and invalid combinations are not enforced by the type system. Every function must validate the state manually. Adding a new state requires auditing every function. This is fragile, verbose, and a reliable source of bugs.

The state machine model solves this by making state **explicit, named, and exhaustively handled**.

### 1.2 The Formal Definition

A **finite state machine (FSM)** is a mathematical model defined by five components:

**Q** — a finite set of states. Every possible configuration of the system maps to exactly one state in Q.

**Σ** (Sigma) — a finite set of input symbols (the alphabet). These are the events or inputs the machine can receive.

**δ** (delta) — the transition function: δ: Q × Σ → Q. Given the current state and an input, the transition function returns the next state. This is deterministic — the same state and input always produce the same next state.

**q₀** — the initial state. The state the machine starts in.

**F** — the set of accepting (or terminal) states. States where the machine has completed its task.

The machine operates as follows:
1. Start in state q₀
2. Receive an input symbol from Σ
3. Apply the transition function: next_state = δ(current_state, input)
4. Move to next_state
5. Repeat from 2

This is the entire model. Every state machine — no matter how complex — is an instance of these five components.

### 1.3 A First Example: A Vending Machine

A simple vending machine that dispenses a drink for 50 cents, accepting 10-cent and 25-cent coins:

**States Q:** {empty, has_10, has_25, has_35, dispensing}
**Inputs Σ:** {insert_10, insert_25, cancel}
**Initial state q₀:** empty
**Accepting states F:** {dispensing}

**Transition table:**

| State    | insert_10 | insert_25 | cancel    |
|----------|-----------|-----------|-----------|
| empty    | has_10    | has_25    | empty     |
| has_10   | has_25    | has_35    | empty     |
| has_25   | has_35    | dispensing| empty     |
| has_35   | dispensing| dispensing| empty     |
| dispensing | —       | —         | —         |

The `dispensing` state is terminal — once we dispense, the transaction is over.

Notice: the state encodes everything relevant about the system's history. We do not need to know *which* coins were inserted — only the total matters, and the state captures that. This is the power of the state machine abstraction: **state is a summary of relevant history**.

### 1.4 Implementing in Zig: The Core Pattern

In Zig, the natural representation of a state machine is:
- States as an `enum`
- Inputs as an `enum` (or a function parameter)
- The transition function as a `switch` over the current state

```zig
const std = @import("std");

const VendingState = enum {
    empty,
    has_10,
    has_25,
    has_35,
    dispensing,
};

const Coin = enum {
    ten_cents,
    twenty_five_cents,
};

const Event = union(enum) {
    insert: Coin,
    cancel,
};

fn transition(state: VendingState, event: Event) VendingState {
    return switch (state) {
        .empty => switch (event) {
            .insert => |coin| switch (coin) {
                .ten_cents => .has_10,
                .twenty_five_cents => .has_25,
            },
            .cancel => .empty,
        },
        .has_10 => switch (event) {
            .insert => |coin| switch (coin) {
                .ten_cents => .has_25,
                .twenty_five_cents => .has_35,
            },
            .cancel => .empty,
        },
        .has_25 => switch (event) {
            .insert => |coin| switch (coin) {
                .ten_cents => .has_35,
                .twenty_five_cents => .dispensing,
            },
            .cancel => .empty,
        },
        .has_35 => switch (event) {
            .insert => |_| .dispensing,
            .cancel => .empty,
        },
        .dispensing => state, // terminal: no transitions
    };
}

pub fn main() void {
    var state: VendingState = .empty;

    const events = [_]Event{
        .{ .insert = .ten_cents },
        .{ .insert = .twenty_five_cents },
        .{ .insert = .ten_cents },
        .{ .insert = .ten_cents },
    };

    for (events) |event| {
        const next = transition(state, event);
        std.debug.print("{s} + {s} -> {s}\n", .{
            @tagName(state),
            switch (event) {
                .insert => |c| @tagName(c),
                .cancel => "cancel",
            },
            @tagName(next),
        });
        state = next;
    }

    if (state == .dispensing) {
        std.debug.print("Dispensing drink!\n", .{});
    }
}
```

### 1.5 Why Exhaustive Switch Is a Correctness Tool

The most important property of the Zig implementation above is that the outer `switch (state)` is **exhaustive** — the compiler requires a case for every possible state value. If you add a new state to the `VendingState` enum and forget to handle it in the transition function, the program does not compile:

```zig
// Add a new state:
const VendingState = enum {
    empty,
    has_10,
    has_25,
    has_35,
    dispensing,
    out_of_stock,  // NEW
};

// Compile error: switch must handle all cases
// error: enumeration value 'out_of_stock' not handled in switch
```

This is not a minor convenience — it is a fundamental safety property. In a language without exhaustive switch (C, Python, Go), adding a new state might be silently unhandled, leading to the machine getting stuck or behaving incorrectly in production. In Zig, it is a compile error. The compiler enforces that your state machine is complete.

This is why the state machine pattern is especially powerful in Zig: the language turns the formal completeness requirement of FSM theory into a compiler check.

---

> **Exercise 5.1: Traffic Light Controller**
>
> A traffic light has the following states: `red`, `red_yellow` (pre-green), `green`, `yellow`.
> Inputs: `tick` (timer event).
> Transitions:
> - `red` + `tick` → `red_yellow`
> - `red_yellow` + `tick` → `green`
> - `green` + `tick` → `yellow`
> - `yellow` + `tick` → `red`
>
> 1. Implement this state machine in Zig with a `transition` function.
> 2. Add an `emergency` input that forces any state immediately to `red`.
> 3. Add a second light that is always one full cycle behind the first (so when light 1 is `green`, light 2 is `red`).
> 4. Simulate 10 ticks and print both light states at each step.

---

> **Answer 5.1**
>
> ```zig
> const std = @import("std");
>
> const LightState = enum { red, red_yellow, green, yellow };
>
> const Input = enum { tick, emergency };
>
> fn transition(state: LightState, input: Input) LightState {
>     return switch (input) {
>         .emergency => .red,
>         .tick => switch (state) {
>             .red        => .red_yellow,
>             .red_yellow => .green,
>             .green      => .yellow,
>             .yellow     => .red,
>         },
>     };
> }
>
> pub fn main() void {
>     var light1: LightState = .red;
>     var light2: LightState = .green; // one cycle behind
>
>     for (0..10) |tick| {
>         std.debug.print("tick {d:2}: light1={s:10} light2={s}\n", .{
>             tick, @tagName(light1), @tagName(light2),
>         });
>         light1 = transition(light1, .tick);
>         light2 = transition(light2, .tick);
>     }
> }
> ```

---

## Part 2: Tagged Unions — Attaching Data to States

### 2.1 States With Payloads

Real state machines often need to store data alongside the current state. A parser in the "reading body" state needs to know how many bytes remain. A connection in the "waiting for acknowledgment" state needs to know the sequence number it is waiting for. A retry mechanism in the "backing off" state needs to know how many retries have been attempted.

Zig's **tagged union** is the natural representation for this: a type that carries both a tag (the state) and a payload (the state-specific data), where the payload type depends on the tag.

```zig
// Without tagged union: separate state and data (fragile)
var state: ParserState = .reading_header;
var bytes_remaining: usize = 0; // only meaningful in reading_body
var error_code: u32 = 0;        // only meaningful in error

// With tagged union: state and data are inseparable (correct)
const ParserState = union(enum) {
    idle,
    reading_header: struct { bytes_read: usize },
    reading_body: struct { bytes_remaining: usize, body_buf: []u8 },
    complete: struct { message: Message },
    err: struct { code: u32, description: []const u8 },
};
```

The tagged union makes invalid combinations impossible. You cannot be in the `idle` state and have `bytes_remaining` set, because `idle` has no payload. The compiler enforces that you only access state-specific data when actually in that state.

### 2.2 A Connection State Machine with Payloads

Let's model a simplified network connection lifecycle:

```zig
const std = @import("std");

const ConnectionState = union(enum) {
    // No active connection
    disconnected,

    // TCP handshake in progress: track how long we've been trying
    connecting: struct {
        attempt: u32,
        started_at_ms: u64,
    },

    // Active connection: track bytes transferred
    connected: struct {
        remote_addr: [4]u8,
        bytes_sent: u64,
        bytes_received: u64,
    },

    // Graceful shutdown: waiting for ACK
    closing: struct {
        reason: []const u8,
    },

    // Something went wrong
    failed: struct {
        error_code: i32,
        message: []const u8,
    },
};

const Event = union(enum) {
    connect_requested: struct { addr: [4]u8 },
    connect_succeeded: struct { addr: [4]u8 },
    connect_failed: struct { code: i32 },
    data_sent: struct { bytes: u64 },
    data_received: struct { bytes: u64 },
    close_requested: struct { reason: []const u8 },
    close_completed,
    retry,
};

fn transition(state: ConnectionState, event: Event) ConnectionState {
    return switch (state) {
        .disconnected => switch (event) {
            .connect_requested => |req| .{
                .connecting = .{
                    .attempt = 1,
                    .started_at_ms = 0, // would use actual time in real code
                },
            },
            else => state, // ignore other events when disconnected
        },

        .connecting => |conn| switch (event) {
            .connect_succeeded => |succ| .{
                .connected = .{
                    .remote_addr = succ.addr,
                    .bytes_sent = 0,
                    .bytes_received = 0,
                },
            },
            .connect_failed => |fail| .{
                .failed = .{
                    .error_code = fail.code,
                    .message = "connection refused",
                },
            },
            .retry => .{
                .connecting = .{
                    .attempt = conn.attempt + 1,
                    .started_at_ms = 0,
                },
            },
            else => state,
        },

        .connected => |conn| switch (event) {
            .data_sent => |d| .{
                .connected = .{
                    .remote_addr = conn.remote_addr,
                    .bytes_sent = conn.bytes_sent + d.bytes,
                    .bytes_received = conn.bytes_received,
                },
            },
            .data_received => |d| .{
                .connected = .{
                    .remote_addr = conn.remote_addr,
                    .bytes_sent = conn.bytes_sent,
                    .bytes_received = conn.bytes_received + d.bytes,
                },
            },
            .close_requested => |req| .{
                .closing = .{ .reason = req.reason },
            },
            else => state,
        },

        .closing => |_| switch (event) {
            .close_completed => .disconnected,
            else => state,
        },

        .failed => switch (event) {
            .retry => .{
                .connecting = .{
                    .attempt = 1,
                    .started_at_ms = 0,
                },
            },
            else => state,
        },
    };
}

pub fn main() void {
    var conn: ConnectionState = .disconnected;

    const events = [_]Event{
        .{ .connect_requested = .{ .addr = .{192, 168, 1, 1} } },
        .{ .connect_succeeded = .{ .addr = .{192, 168, 1, 1} } },
        .{ .data_sent = .{ .bytes = 256 } },
        .{ .data_received = .{ .bytes = 1024 } },
        .{ .close_requested = .{ .reason = "done" } },
        .close_completed,
    };

    for (events) |event| {
        conn = transition(conn, event);
        switch (conn) {
            .disconnected => std.debug.print("state: disconnected\n", .{}),
            .connecting => |c| std.debug.print(
                "state: connecting (attempt {d})\n", .{c.attempt}),
            .connected => |c| std.debug.print(
                "state: connected, sent={d} recv={d}\n",
                .{c.bytes_sent, c.bytes_received}),
            .closing => |c| std.debug.print(
                "state: closing (reason: {s})\n", .{c.reason}),
            .failed => |f| std.debug.print(
                "state: failed (code {d})\n", .{f.error_code}),
        }
    }
}
```

Notice the pattern: `switch (state)` with captures (`|conn|`, `|d|`, etc.) extracts the payload for that state. The type system ensures the payload is only accessible when in the correct state.

### 2.3 Mealy vs Moore Machines

Two classical variants of the state machine model differ in where output is produced:

**Moore machine:** Output depends only on the current state. Every state has an associated output. When you enter a state, you produce its output.

**Mealy machine:** Output depends on both the current state and the current input. Output is produced by transitions, not by states.

In practice, most systems programming state machines are Mealy machines — the output (action to take) depends on both what state you are in and what event you received. But the distinction is useful for reasoning: a Moore machine's behavior is easier to predict from just looking at the state diagram, while a Mealy machine can produce more compact representations.

```zig
// Moore machine: output from state
fn output_moore(state: LightState) []const u8 {
    return switch (state) {
        .red        => "STOP",
        .red_yellow => "PREPARE",
        .green      => "GO",
        .yellow     => "SLOW",
    };
}

// Mealy machine: output from state + input
fn output_mealy(state: LightState, input: Input) []const u8 {
    return switch (state) {
        .green => switch (input) {
            .tick      => "slowing down",
            .emergency => "EMERGENCY STOP",
        },
        else => "normal transition",
    };
}
```

---

## Part 3: Protocol Parsing — The Real Use Case

### 3.1 Why Parsers Are State Machines

Network data arrives in chunks. A TCP stream delivers bytes continuously — there is no guarantee that a "message" arrives all at once in a single `read()` call. You might receive half a header in one call, the other half plus part of the body in the next, and the rest of the body in a third.

A parser that assumes complete messages fails on real networks. A parser built as a state machine handles partial input naturally: each call to the parser advances through whatever states the available bytes allow, and returns with the current state intact, ready to continue from exactly where it left off.

This is the fundamental advantage of the state machine approach to parsing: **correctness across arbitrary fragmentation of input**.

### 3.2 A Binary Frame Parser

Consider a binary protocol with this message format:

```
┌─────────────────────────────────────────────────────────┐
│ Magic (2 bytes) │ Type (1 byte) │ Length (4 bytes, LE)  │
├─────────────────────────────────────────────────────────┤
│ Payload (Length bytes)                                   │
└─────────────────────────────────────────────────────────┘
```

- Magic: `0xCAFE` (identifies the protocol)
- Type: message type (0-255)
- Length: payload length in bytes, little-endian
- Payload: the actual message content

The parser must handle receiving any number of bytes at a time:

```zig
const std = @import("std");

pub const MessageType = enum(u8) {
    ping = 0x01,
    pong = 0x02,
    data = 0x03,
    error_msg = 0xFF,
    _,
};

pub const Message = struct {
    msg_type: MessageType,
    payload: []const u8,
};

/// Parser state — what are we currently reading?
const ParserState = union(enum) {
    /// Waiting for the first magic byte (0xCA)
    magic_byte_1,

    /// Got 0xCA, waiting for 0xFE
    magic_byte_2,

    /// Reading the type byte
    reading_type,

    /// Reading the 4-byte little-endian length field
    reading_length: struct {
        msg_type: MessageType,
        bytes_read: u2,        // 0, 1, 2, or 3
        partial_length: u32,
    },

    /// Reading the payload bytes
    reading_payload: struct {
        msg_type: MessageType,
        payload_buf: []u8,
        bytes_read: usize,
    },
};

pub const Parser = struct {
    state: ParserState,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Parser {
        return .{
            .state = .magic_byte_1,
            .allocator = allocator,
        };
    }

    /// Feed bytes to the parser. Returns a completed Message when
    /// enough bytes arrive, null when more bytes are needed.
    /// Caller owns the returned Message's payload.
    pub fn feed(self: *Parser, byte: u8) !?Message {
        switch (self.state) {
            .magic_byte_1 => {
                if (byte == 0xCA) {
                    self.state = .magic_byte_2;
                }
                // Any non-0xCA byte: stay in magic_byte_1 (resync)
                return null;
            },

            .magic_byte_2 => {
                if (byte == 0xFE) {
                    self.state = .reading_type;
                } else if (byte == 0xCA) {
                    // 0xCA followed by 0xCA: the second might be the start
                    // Stay in magic_byte_2 (already saw 0xCA)
                } else {
                    self.state = .magic_byte_1; // not a valid magic, restart
                }
                return null;
            },

            .reading_type => {
                const msg_type: MessageType = @enumFromInt(byte);
                self.state = .{
                    .reading_length = .{
                        .msg_type = msg_type,
                        .bytes_read = 0,
                        .partial_length = 0,
                    },
                };
                return null;
            },

            .reading_length => |*len| {
                // Accumulate little-endian length
                // byte at position 0 is least significant
                const shift: u5 = @as(u5, len.bytes_read) * 8;
                len.partial_length |= @as(u32, byte) << shift;
                len.bytes_read += 1;

                if (len.bytes_read == 4) {
                    const total_len = len.partial_length;
                    const msg_type = len.msg_type;

                    if (total_len == 0) {
                        // Zero-length message: complete immediately
                        self.state = .magic_byte_1;
                        return Message{
                            .msg_type = msg_type,
                            .payload = &[_]u8{},
                        };
                    }

                    // Allocate payload buffer
                    const payload_buf = try self.allocator.alloc(u8, total_len);
                    self.state = .{
                        .reading_payload = .{
                            .msg_type = msg_type,
                            .payload_buf = payload_buf,
                            .bytes_read = 0,
                        },
                    };
                }
                return null;
            },

            .reading_payload => |*payload| {
                payload.payload_buf[payload.bytes_read] = byte;
                payload.bytes_read += 1;

                if (payload.bytes_read == payload.payload_buf.len) {
                    // Message complete
                    const msg = Message{
                        .msg_type = payload.msg_type,
                        .payload = payload.payload_buf,
                        // Caller must free payload.payload_buf
                    };
                    self.state = .magic_byte_1;
                    return msg;
                }
                return null;
            },
        }
    }

    /// Feed multiple bytes, collecting any complete messages.
    pub fn feed_bytes(self: *Parser, bytes: []const u8,
                      messages: *std.ArrayList(Message)) !void {
        for (bytes) |byte| {
            if (try self.feed(byte)) |msg| {
                try messages.append(msg);
            }
        }
    }
};

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var parser = Parser.init(allocator);
    var messages = std.ArrayList(Message).init(allocator);
    defer {
        for (messages.items) |msg| allocator.free(msg.payload);
        messages.deinit();
    }

    // Simulate receiving a fragmented message:
    // Magic + type + length (4 bytes) + payload "hello"
    // Fragmented into 3 chunks
    const chunk1 = [_]u8{ 0xCA, 0xFE, 0x03 };         // magic + type=data
    const chunk2 = [_]u8{ 0x05, 0x00, 0x00, 0x00 };   // length=5 (LE)
    const chunk3 = [_]u8{ 'h', 'e', 'l', 'l', 'o' }; // payload

    try parser.feed_bytes(&chunk1, &messages);
    std.debug.print("after chunk1: {d} complete messages\n", .{messages.items.len});

    try parser.feed_bytes(&chunk2, &messages);
    std.debug.print("after chunk2: {d} complete messages\n", .{messages.items.len});

    try parser.feed_bytes(&chunk3, &messages);
    std.debug.print("after chunk3: {d} complete messages\n", .{messages.items.len});

    for (messages.items) |msg| {
        std.debug.print("message: type={s} payload={s}\n", .{
            @tagName(msg.msg_type), msg.payload,
        });
    }
}
```

This parser handles arbitrary fragmentation. The three chunks could just as well arrive as: one byte at a time, all at once, or in any other distribution — the parser produces the same result.

### 3.3 The Resync Problem

A robust parser must handle corrupted input — bytes that are not part of any valid message. The `magic_byte_1` state implements a simple resync strategy: keep reading until you see `0xCA`. More sophisticated protocols use framing that allows the parser to determine message boundaries unambiguously even in the presence of corruption.

The state machine approach makes the resync logic explicit and testable. Each state handles "what should I do with an unexpected byte?" explicitly, rather than through a tangle of error-handling code.

---

> **Exercise 5.2: HTTP/1.1 Request Line Parser**
>
> Implement a parser for the HTTP/1.1 request line:
>
> ```
> GET /path/to/resource HTTP/1.1\r\n
> ```
>
> States: `reading_method`, `reading_path`, `reading_version`, `reading_cr`, `complete`, `error`
>
> The parser should:
> 1. Read the method until a space (accumulate into a buffer)
> 2. Read the path until a space
> 3. Read the version until `\r`
> 4. Expect `\n` after `\r`
> 5. Return a struct with method, path, and version when complete
>
> Handle errors: path too long, unrecognized method, missing `\n` after `\r`.
>
> Test with:
> - `"GET / HTTP/1.1\r\n"` — should complete successfully
> - `"GET / HTTP/1.1\r"` — should be in `reading_cr` state, waiting for `\n`
> - `"GET / HTTP/1.1\rX"` — should transition to `error`

---

## Part 4: The Process Lifecycle State Machine

### 4.1 Processes as State Machines

In Module 3 you learned about `fork()`, `execve()`, signals, and process management. Now look at the lifecycle of a process from the OS scheduler's perspective — it is a state machine.

Every process in a Unix-like OS is in exactly one of these states at any moment:

```
           fork()
             │
             ▼
          ┌──────┐
          │ NEW  │  Process created, not yet runnable
          └──┬───┘
             │  admit (resources available)
             ▼
          ┌──────┐  ◄─────── I/O or event completes ────────
          │READY │                                           │
          └──┬───┘  ◄─────── preempted by scheduler ───┐   │
             │                                          │   │
             │  scheduler dispatches                    │   │
             ▼                                          │   │
         ┌─────────┐  ── I/O request ──►  ┌─────────┐  │   │
         │ RUNNING │                       │WAITING/ │──┘   │
         └────┬────┘                       │BLOCKED  │──────┘
              │                            └─────────┘
              │  exit() / kill signal
              ▼
          ┌──────────┐
          │TERMINATED│  Waiting for parent to wait()
          └──────────┘
```

This is not just a diagram — it is the actual data structure the Linux kernel maintains for every process. The kernel's `task_struct` has a `state` field that holds one of these values.

### 4.2 Implementing the Process State Machine

```zig
const std = @import("std");

const ProcessState = enum {
    new,
    ready,
    running,
    waiting,
    terminated,
};

const ProcessEvent = enum {
    // Transitions into ready
    admit,          // new -> ready (OS accepts the process)
    io_complete,    // waiting -> ready (I/O finished)
    preempted,      // running -> ready (scheduler took CPU away)

    // Transitions into running
    dispatch,       // ready -> running (scheduler gave CPU)

    // Transitions into waiting
    io_request,     // running -> waiting (process requested I/O)

    // Transitions into terminated
    exit,           // running -> terminated (process called exit())
    killed,         // any -> terminated (process received fatal signal)
};

const ProcessTransitionError = error{
    InvalidTransition,
};

fn transition(state: ProcessState,
              event: ProcessEvent) ProcessTransitionError!ProcessState {
    return switch (state) {
        .new => switch (event) {
            .admit  => .ready,
            .killed => .terminated,
            else    => error.InvalidTransition,
        },
        .ready => switch (event) {
            .dispatch => .running,
            .killed   => .terminated,
            else      => error.InvalidTransition,
        },
        .running => switch (event) {
            .io_request => .waiting,
            .preempted  => .ready,
            .exit       => .terminated,
            .killed     => .terminated,
            else        => error.InvalidTransition,
        },
        .waiting => switch (event) {
            .io_complete => .ready,
            .killed      => .terminated,
            else         => error.InvalidTransition,
        },
        .terminated => error.InvalidTransition, // no transitions out of terminated
    };
}

/// A simulated process with state tracking
const Process = struct {
    pid: u32,
    name: []const u8,
    state: ProcessState,
    cpu_time_ms: u64,
    io_operations: u32,

    pub fn apply_event(self: *Process, event: ProcessEvent) !void {
        const next_state = try transition(self.state, event);
        std.debug.print("PID {d} ({s}): {s} --[{s}]--> {s}\n", .{
            self.pid,
            self.name,
            @tagName(self.state),
            @tagName(event),
            @tagName(next_state),
        });
        self.state = next_state;

        // Update metrics based on event
        switch (event) {
            .preempted  => self.cpu_time_ms += 10,
            .exit       => self.cpu_time_ms += 5,
            .io_request => self.io_operations += 1,
            else        => {},
        }
    }
};

pub fn main() !void {
    var proc = Process{
        .pid = 1234,
        .name = "worker",
        .state = .new,
        .cpu_time_ms = 0,
        .io_operations = 0,
    };

    // Simulate a process lifecycle
    const events = [_]ProcessEvent{
        .admit,
        .dispatch,
        .io_request,
        .io_complete,
        .dispatch,
        .preempted,
        .dispatch,
        .exit,
    };

    for (events) |event| {
        try proc.apply_event(event);
    }

    std.debug.print("\nFinal state: {s}\n", .{@tagName(proc.state)});
    std.debug.print("CPU time: {d}ms\n", .{proc.cpu_time_ms});
    std.debug.print("I/O operations: {d}\n", .{proc.io_operations});

    // Test invalid transition
    const err = proc.apply_event(.dispatch);
    if (err == error.InvalidTransition) {
        std.debug.print("Correctly rejected: cannot dispatch a terminated process\n", .{});
    }
}
```

Notice that invalid transitions return an error rather than silently transitioning to an invalid state. This is the state machine enforcing invariants: you cannot `dispatch` a process that is `terminated`. The type system does not prevent all invalid transitions (that would require dependent types), but returning an error makes them visible and testable.

---

## Part 5: The TCP State Machine

### 5.1 TCP — An 11-State Machine

TCP is one of the most important state machines in all of systems programming. Every TCP connection is an instance of an 11-state machine defined in RFC 793 (1981) — one of the oldest standards still in daily use in networked software.

Understanding the TCP state machine deeply is the difference between a developer who reads `CLOSE_WAIT` in a `netstat` output and knows exactly what it means, and a developer who has to look it up every time.

The eleven states:

| State | Meaning |
|-------|---------|
| `CLOSED` | No connection exists |
| `LISTEN` | Waiting for incoming connection (server side) |
| `SYN_SENT` | Sent SYN, waiting for SYN-ACK (client connecting) |
| `SYN_RECEIVED` | Received SYN, sent SYN-ACK, waiting for ACK |
| `ESTABLISHED` | Connection open — data can flow in both directions |
| `FIN_WAIT_1` | Sent FIN, waiting for ACK or FIN (active close) |
| `FIN_WAIT_2` | Received ACK of FIN, waiting for FIN from remote |
| `CLOSE_WAIT` | Received FIN from remote, waiting for app to close |
| `CLOSING` | Both sides sent FIN simultaneously |
| `LAST_ACK` | Sent FIN after receiving FIN, waiting for final ACK |
| `TIME_WAIT` | Waiting to ensure remote received ACK before closing |

### 5.2 The Three-Way Handshake as a State Machine

The TCP three-way handshake — the sequence that establishes a connection — drives state transitions on both client and server:

```
Client                                Server
  │                                     │
CLOSED                                CLOSED
  │                                     │
  │                            passive_open()
  │                                  LISTEN
  │                                     │
active_open() ─────SYN────────────►      │
SYN_SENT                          SYN_RECEIVED
  │                                     │
  │◄──────────────SYN+ACK─────────────  │
ESTABLISHED                             │
  │                                     │
  │────────────────ACK────────────────► │
  │                                  ESTABLISHED
  │                                     │
  │◄══════════ data flows ════════════► │
```

### 5.3 Connection Teardown

TCP connection teardown uses a four-way handshake (because each direction must be closed independently):

```
Active Close (typically client)    Passive Close (typically server)
  │                                     │
ESTABLISHED                         ESTABLISHED
  │                                     │
close() ──────────FIN──────────────►    │
FIN_WAIT_1                         CLOSE_WAIT
  │                                     │
  │◄───────────────ACK────────────────  │
FIN_WAIT_2               (app calls close())
  │                                     │
  │◄───────────────FIN────────────────  │
TIME_WAIT                           LAST_ACK
  │                                     │
  │───────────────ACK─────────────────► │
  │                                  CLOSED
  │
(wait 2*MSL)
  │
CLOSED
```

`TIME_WAIT` is a crucial state. The connection waits for 2 × Maximum Segment Lifetime (typically 2 minutes) before fully closing. This ensures that any delayed duplicates of the last ACK are absorbed before the port number is reused. `TIME_WAIT` explains why you see lingering connections in `netstat` after a program closes — they are waiting to ensure the remote side received the final ACK.

### 5.4 Implementing the TCP State Machine

```zig
const std = @import("std");

pub const TcpState = enum {
    closed,
    listen,
    syn_sent,
    syn_received,
    established,
    fin_wait_1,
    fin_wait_2,
    close_wait,
    closing,
    last_ack,
    time_wait,
};

pub const TcpEvent = enum {
    // Application calls
    passive_open,  // server calls listen()
    active_open,   // client calls connect()
    close,         // application calls close()
    timeout,       // 2*MSL timer expires in TIME_WAIT

    // Segments received from remote
    rcv_syn,        // received SYN
    rcv_ack,        // received ACK
    rcv_syn_ack,    // received SYN+ACK
    rcv_fin,        // received FIN
    rcv_fin_ack,    // received FIN+ACK (FIN with ACK of our FIN)
    rcv_rst,        // received RST (connection reset)
};

pub const TcpTransitionError = error{ InvalidTransition };

/// The action to take alongside a state transition
pub const TcpAction = enum {
    none,
    send_syn,
    send_syn_ack,
    send_ack,
    send_fin,
    send_fin_ack,
    send_rst,
    notify_app_connected,
    notify_app_data_ready,
    notify_app_closed,
    start_time_wait_timer,
};

pub const TransitionResult = struct {
    next_state: TcpState,
    action: TcpAction,
};

/// The TCP state transition function.
/// Returns the next state and the action to take.
pub fn transition(state: TcpState,
                  event: TcpEvent) TcpTransitionError!TransitionResult {
    return switch (state) {
        .closed => switch (event) {
            .passive_open => .{ .next_state = .listen,    .action = .none },
            .active_open  => .{ .next_state = .syn_sent,  .action = .send_syn },
            .rcv_syn      => .{ .next_state = .closed,    .action = .send_rst },
            else          => error.InvalidTransition,
        },

        .listen => switch (event) {
            .rcv_syn     => .{ .next_state = .syn_received, .action = .send_syn_ack },
            .active_open => .{ .next_state = .syn_sent,     .action = .send_syn },
            .close       => .{ .next_state = .closed,       .action = .none },
            else         => error.InvalidTransition,
        },

        .syn_sent => switch (event) {
            .rcv_syn_ack => .{ .next_state = .established,
                               .action = .notify_app_connected },
            .rcv_syn     => .{ .next_state = .syn_received, .action = .send_syn_ack },
            .close       => .{ .next_state = .closed,       .action = .none },
            .rcv_rst     => .{ .next_state = .closed,       .action = .notify_app_closed },
            else         => error.InvalidTransition,
        },

        .syn_received => switch (event) {
            .rcv_ack => .{ .next_state = .established,    .action = .notify_app_connected },
            .close   => .{ .next_state = .fin_wait_1,     .action = .send_fin },
            .rcv_rst => .{ .next_state = .listen,         .action = .none },
            else     => error.InvalidTransition,
        },

        .established => switch (event) {
            .close   => .{ .next_state = .fin_wait_1, .action = .send_fin },
            .rcv_fin => .{ .next_state = .close_wait, .action = .send_ack },
            .rcv_rst => .{ .next_state = .closed,     .action = .notify_app_closed },
            else     => error.InvalidTransition,
        },

        .fin_wait_1 => switch (event) {
            .rcv_ack     => .{ .next_state = .fin_wait_2, .action = .none },
            .rcv_fin     => .{ .next_state = .closing,    .action = .send_ack },
            .rcv_fin_ack => .{ .next_state = .time_wait,  .action = .start_time_wait_timer },
            else         => error.InvalidTransition,
        },

        .fin_wait_2 => switch (event) {
            .rcv_fin => .{ .next_state = .time_wait, .action = .start_time_wait_timer },
            else     => error.InvalidTransition,
        },

        .close_wait => switch (event) {
            // Application has seen all data and calls close()
            .close => .{ .next_state = .last_ack, .action = .send_fin },
            else   => error.InvalidTransition,
        },

        .closing => switch (event) {
            .rcv_ack => .{ .next_state = .time_wait, .action = .start_time_wait_timer },
            else     => error.InvalidTransition,
        },

        .last_ack => switch (event) {
            .rcv_ack => .{ .next_state = .closed, .action = .notify_app_closed },
            else     => error.InvalidTransition,
        },

        .time_wait => switch (event) {
            .timeout => .{ .next_state = .closed, .action = .none },
            // Receiving another FIN in TIME_WAIT restarts the timer
            .rcv_fin => .{ .next_state = .time_wait, .action = .send_ack },
            else     => error.InvalidTransition,
        },
    };
}

/// Trace a complete TCP connection lifecycle
pub fn trace_connection() !void {
    var client: TcpState = .closed;
    var server: TcpState = .closed;

    std.debug.print("=== TCP Connection Lifecycle ===\n\n", .{});
    std.debug.print("--- Setup ---\n", .{});

    // Server starts listening
    {
        const result = try transition(server, .passive_open);
        server = result.next_state;
        std.debug.print("Server passive_open -> {s}\n", .{@tagName(server)});
    }

    std.debug.print("\n--- Three-Way Handshake ---\n", .{});

    // Client sends SYN
    {
        const result = try transition(client, .active_open);
        client = result.next_state;
        std.debug.print("Client active_open -> {s} [action: {s}]\n",
            .{@tagName(client), @tagName(result.action)});
    }

    // Server receives SYN, sends SYN+ACK
    {
        const result = try transition(server, .rcv_syn);
        server = result.next_state;
        std.debug.print("Server rcv_syn -> {s} [action: {s}]\n",
            .{@tagName(server), @tagName(result.action)});
    }

    // Client receives SYN+ACK, connection established
    {
        const result = try transition(client, .rcv_syn_ack);
        client = result.next_state;
        std.debug.print("Client rcv_syn_ack -> {s} [action: {s}]\n",
            .{@tagName(client), @tagName(result.action)});
    }

    // Server receives ACK, connection established
    {
        const result = try transition(server, .rcv_ack);
        server = result.next_state;
        std.debug.print("Server rcv_ack -> {s} [action: {s}]\n",
            .{@tagName(server), @tagName(result.action)});
    }

    std.debug.print("\n--- Data Exchange (both ESTABLISHED) ---\n", .{});
    std.debug.print("Client state: {s}\n", .{@tagName(client)});
    std.debug.print("Server state: {s}\n", .{@tagName(server)});

    std.debug.print("\n--- Active Close (client closes first) ---\n", .{});

    // Client calls close(), sends FIN
    {
        const result = try transition(client, .close);
        client = result.next_state;
        std.debug.print("Client close -> {s} [action: {s}]\n",
            .{@tagName(client), @tagName(result.action)});
    }

    // Server receives FIN, sends ACK
    {
        const result = try transition(server, .rcv_fin);
        server = result.next_state;
        std.debug.print("Server rcv_fin -> {s} [action: {s}]\n",
            .{@tagName(server), @tagName(result.action)});
    }

    // Client receives ACK of its FIN
    {
        const result = try transition(client, .rcv_ack);
        client = result.next_state;
        std.debug.print("Client rcv_ack -> {s}\n", .{@tagName(client)});
    }

    // Server application calls close(), sends FIN
    {
        const result = try transition(server, .close);
        server = result.next_state;
        std.debug.print("Server close -> {s} [action: {s}]\n",
            .{@tagName(server), @tagName(result.action)});
    }

    // Client receives FIN, enters TIME_WAIT
    {
        const result = try transition(client, .rcv_fin);
        client = result.next_state;
        std.debug.print("Client rcv_fin -> {s} [action: {s}]\n",
            .{@tagName(client), @tagName(result.action)});
    }

    // Server receives final ACK
    {
        const result = try transition(server, .rcv_ack);
        server = result.next_state;
        std.debug.print("Server rcv_ack -> {s} [action: {s}]\n",
            .{@tagName(server), @tagName(result.action)});
    }

    // Client's TIME_WAIT timer expires
    {
        const result = try transition(client, .timeout);
        client = result.next_state;
        std.debug.print("Client timeout -> {s}\n", .{@tagName(client)});
    }

    std.debug.print("\n--- Final States ---\n", .{});
    std.debug.print("Client: {s}\n", .{@tagName(client)});
    std.debug.print("Server: {s}\n", .{@tagName(server)});
}

pub fn main() !void {
    try trace_connection();
}
```

### 5.5 Reading TCP State in Production

The TCP state machine is not just academic. It is directly observable on any Linux system:

```bash
# Show all TCP connections and their states
ss -tn state all

# Count connections per state
ss -Htn state all | awk '{print $1}' | sort | uniq -c | sort -rn

# Show only ESTABLISHED connections
ss -tn state established

# Show TIME_WAIT connections (common after high-traffic servers)
ss -tn state time-wait | wc -l
```

Common things you will see in production:

**Many `TIME_WAIT` connections:** Normal on a high-traffic server. Each completed connection spends ~2 minutes in `TIME_WAIT`. For a server handling 10,000 requests per second, you might see 1.2 million `TIME_WAIT` connections at any moment. This is expected behavior.

**`CLOSE_WAIT` that doesn't go away:** Indicates a bug in the server application. The remote side closed the connection (server received FIN → `CLOSE_WAIT`), but the server application never called `close()` (which would move to `LAST_ACK`). The connection is stuck because the application is not consuming the close event.

**Many `SYN_RECEIVED`:** Possibly a SYN flood attack. The server received SYNs and sent SYN-ACKs, but the three-way handshake was never completed (ACK never arrived). This fills the server's connection table.

---

> **Exercise 5.3: Observe Real TCP States**
>
> 1. In one terminal, start a simple server:
>    ```bash
>    python3 -m http.server 8080
>    ```
>
> 2. In another terminal, observe the server's state:
>    ```bash
>    ss -tn state listen sport = :8080
>    ```
>
> 3. Connect to the server:
>    ```bash
>    curl http://localhost:8080/
>    ```
>
> 4. Watch the connection states during and after the request:
>    ```bash
>    watch -n 0.1 'ss -tn | grep 8080'
>    ```
>
> Document: what states do you observe? How quickly do connections move through each state? Do you see `TIME_WAIT` after the request completes? Which side enters `TIME_WAIT`?

---

## Part 6: State Machine Design Patterns

### 6.1 The State Table Pattern

For state machines with many states and many transitions, a transition table can be more maintainable than nested `switch` statements:

```zig
const std = @import("std");

/// A transition table entry
const Transition = struct {
    from: TcpState,
    event: TcpEvent,
    to: TcpState,
    action: TcpAction,
};

/// The complete TCP transition table (abbreviated)
const tcp_transitions = [_]Transition{
    .{ .from = .closed,       .event = .passive_open, .to = .listen,        .action = .none },
    .{ .from = .closed,       .event = .active_open,  .to = .syn_sent,      .action = .send_syn },
    .{ .from = .listen,       .event = .rcv_syn,      .to = .syn_received,  .action = .send_syn_ack },
    .{ .from = .syn_sent,     .event = .rcv_syn_ack,  .to = .established,   .action = .notify_app_connected },
    .{ .from = .syn_received, .event = .rcv_ack,      .to = .established,   .action = .notify_app_connected },
    .{ .from = .established,  .event = .close,        .to = .fin_wait_1,    .action = .send_fin },
    .{ .from = .established,  .event = .rcv_fin,      .to = .close_wait,    .action = .send_ack },
    // ... more transitions
};

fn lookup_transition(state: TcpState, event: TcpEvent) ?TransitionResult {
    for (tcp_transitions) |t| {
        if (t.from == state and t.event == event) {
            return .{ .next_state = t.to, .action = t.action };
        }
    }
    return null;
}
```

The table pattern trades compile-time completeness checking for runtime flexibility — you can load transition tables from configuration, test different behaviors by swapping tables, and generate transition tables from specifications. The tradeoff is real: decide based on whether you need the compiler's exhaustiveness guarantee or the table's flexibility.

### 6.2 Hierarchical State Machines

Complex systems often have states that themselves contain sub-state machines. An active TCP connection might have sub-states for congestion control (slow start, congestion avoidance, fast recovery). A process might have sub-states for I/O scheduling.

```zig
/// A hierarchical state machine example:
/// The ESTABLISHED state has sub-states for congestion control

const CongestionState = enum {
    slow_start,
    congestion_avoidance,
    fast_recovery,
    fast_retransmit,
};

const EstablishedData = struct {
    congestion: CongestionState,
    cwnd: u32,       // congestion window
    ssthresh: u32,   // slow start threshold
    bytes_in_flight: u32,
};

const TcpStateDetailed = union(enum) {
    closed,
    listen,
    syn_sent,
    syn_received,
    established: EstablishedData, // ESTABLISHED carries congestion state
    fin_wait_1,
    fin_wait_2,
    close_wait,
    closing,
    last_ack,
    time_wait,
};
```

The hierarchical structure is expressed naturally through Zig's tagged unions: the `established` variant carries the entire sub-state machine as its payload.

### 6.3 Guards and Actions

Real state machines often have **guards** — conditions that must be true for a transition to be taken — and **actions** — side effects executed when a transition occurs.

```zig
const Guard = fn (state: anytype, event: anytype) bool;
const Action = fn (state: anytype, event: anytype) void;

/// A transition with an optional guard
const GuardedTransition = struct {
    from: ProcessState,
    event: ProcessEvent,
    to: ProcessState,
    guard: ?*const fn () bool,
    action: ?*const fn () void,
};

fn has_available_cpu() bool {
    return true; // in real code, check CPU availability
}

fn log_transition() void {
    std.debug.print("transition logged\n", .{});
}

const guarded_transitions = [_]GuardedTransition{
    .{
        .from   = .ready,
        .event  = .dispatch,
        .to     = .running,
        .guard  = has_available_cpu,  // only if CPU is available
        .action = log_transition,
    },
};
```

Guards and actions are how state machines interact with the real world: guards check preconditions, actions produce side effects (logging, sending network packets, updating metrics).

---

## Part 7: The Module Project — A Complete Protocol Implementation

### Project Specification

Build a complete implementation of a simple but real binary protocol using state machines throughout. The protocol, called **ZigLink**, handles bidirectional message exchange between a client and server.

**ZigLink Protocol Specification:**

```
Connection lifecycle:
  CLIENT                             SERVER
    │                                   │
    │──── HELLO (version, client_id) ──►│
    │                                   │
    │◄─── WELCOME (session_id) ─────────│
    │                                   │
    │◄══════ message exchange ══════════│
    │                                   │
    │──── GOODBYE ──────────────────────│
    │                                   │
    │◄─── GOODBYE ──────────────────────│
    │                                   │

Message types:
  0x01 HELLO:   version(u8), client_id(u32)
  0x02 WELCOME: session_id(u64)
  0x03 DATA:    sequence(u32), payload_len(u16), payload(bytes)
  0x04 ACK:     sequence(u32)
  0x05 GOODBYE: reason(u8)
  0x06 ERROR:   code(u16), message_len(u8), message(bytes)
```

**What to implement:**

**1. A frame parser** (using the state machine pattern from Part 3) that handles arbitrary fragmentation of the byte stream.

**2. A session state machine** with states:
- `disconnected`
- `handshaking` (sent/received HELLO, waiting for WELCOME)
- `connected` (full duplex data exchange)
- `closing` (GOODBYE sent, waiting for GOODBYE)
- `closed`

**3. A reliable message sender** that tracks unacknowledged messages and retransmits them (using a simple state machine per in-flight message: `pending`, `sent`, `acknowledged`, `failed`).

**4. A test harness** that:
- Creates a simulated loopback (client and server in the same process)
- Exchanges 100 messages
- Verifies all messages were acknowledged
- Tests the `GOODBYE` sequence
- Verifies that the session state machine correctly transitions through all states

### Structure

```
src/
  protocol.zig     — message types, frame format
  parser.zig       — frame parser state machine
  session.zig      — session lifecycle state machine
  sender.zig       — reliable message sender state machine
  main.zig         — test harness
```

### Extension Challenges

1. **State machine visualization:** Write a function that generates a Graphviz DOT representation of the state machine, given an array of `Transition` structs. Run `dot -Tpng output.dot -o diagram.png` to produce a visual diagram of your state machine.

2. **Protocol fuzzer:** Write a fuzzer that generates random byte sequences and feeds them to the frame parser. Verify that the parser never crashes — it should always either produce a valid message or remain in a valid state waiting for more bytes.

3. **Timeout handling:** Extend the session state machine with a timer. If no message is received for 30 seconds in the `connected` state, transition to `closing` and send `GOODBYE`. This requires integrating state machine events from multiple sources (messages *and* timers).

---

## Summary

State machines are not a pattern you choose to use. They are the underlying structure of every system that has state. The choice is only between systems where state is implicit and scattered — creating bugs no one can reason about — and systems where state is explicit, named, and exhaustively handled.

**The formal model** gives you a precise vocabulary: states, inputs, transition function, initial state, accepting states. Every system has these — the question is whether you have named them.

**Zig's exhaustive `switch`** turns the formal completeness requirement into a compiler check. Adding a new state to an enum and getting a compile error on every unhandled transition is not a nuisance — it is the type system ensuring your state machine is correct.

**Tagged unions** allow states to carry payloads, eliminating the fragile pattern of separate boolean flags and data variables that may or may not be consistent with each other.

**Protocol parsers** built as state machines handle arbitrary fragmentation naturally. The state encodes exactly where in the message parsing has progressed, and execution continues from that point on the next call — regardless of how the input is fragmented.

**The TCP state machine** is the most important state machine in all of networking. Understanding it in detail — not just the happy path but `TIME_WAIT`, `CLOSE_WAIT`, simultaneous close — is the difference between network debugging guesswork and systematic reasoning.

---

## What's Next

Module 6 — The Memory Hierarchy and Why Locality Matters — returns to the hardware level, but now with the full context of programs, processes, and memory management behind you. You will learn why the *order* in which you access memory can make a 50x performance difference, and how to design data structures and algorithms that work *with* the hardware cache rather than against it.

---

## Reference: Zig State Machine Patterns

```zig
// Basic state machine
const State = enum { a, b, c };
const Event = enum { x, y };

fn transition(s: State, e: Event) State {
    return switch (s) {
        .a => switch (e) {
            .x => .b,
            .y => .a,
        },
        .b => switch (e) {
            .x => .c,
            .y => .a,
        },
        .c => s, // terminal
    };
}

// State machine with payloads
const StateP = union(enum) {
    idle,
    processing: struct { count: u32, data: []u8 },
    done: struct { result: u64 },
    failed: struct { code: i32 },
};

// Iterate over all states (useful for testing/visualization)
inline for (std.meta.fields(State)) |field| {
    const s: State = @enumFromInt(field.value);
    std.debug.print("state: {s}\n", .{@tagName(s)});
}

// Check if a value is a specific state in a tagged union
const current: StateP = .{ .processing = .{ .count = 5, .data = &[_]u8{} } };
switch (current) {
    .processing => |data| std.debug.print("count: {d}\n", .{data.count}),
    else => {},
}
```

## Reference: TCP States Quick Reference

```
State        | Who             | What's happening
-------------|-----------------|------------------------------------------
CLOSED       | Both            | No connection
LISTEN       | Server          | Waiting for incoming SYN
SYN_SENT     | Client          | Sent SYN, waiting for SYN+ACK
SYN_RECEIVED | Server          | Got SYN, sent SYN+ACK, waiting for ACK
ESTABLISHED  | Both            | Normal data transfer
FIN_WAIT_1   | Active close    | Sent FIN, waiting for ACK
FIN_WAIT_2   | Active close    | Got ACK of FIN, waiting for FIN
CLOSE_WAIT   | Passive close   | Got FIN, app hasn't called close() yet
CLOSING      | Both            | Simultaneous close
LAST_ACK     | Passive close   | Sent FIN, waiting for final ACK
TIME_WAIT    | Active close    | Waiting 2*MSL before final close

Common problems:
  Many CLOSE_WAIT → server not closing connections (app bug)
  Many TIME_WAIT  → normal on busy server, or adjust SO_REUSEADDR
  Many SYN_RCVD   → possible SYN flood attack
```

---

*End of Module 5*
