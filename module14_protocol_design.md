# Module 14: Protocol Design

## The Craft of Systems Programming — Teaching Material

---

> *"A protocol is a contract. Like all contracts, the hard part is not writing what happens when everything goes right — it's writing what happens when things go wrong, and ensuring that both sides agree on what 'wrong' means."*

---

## Before You Begin

You have implemented existing protocols throughout this curriculum. You parsed RESP in Module 12 and implemented DNS and ICMP in Module 13. You have seen what makes a protocol workable — and what makes one frustrating.

This module teaches you to design protocols from scratch. This is one of the most consequential decisions in systems engineering. A protocol deployed in production cannot be changed without careful planning. Clients running old code must interoperate with servers running new code, and vice versa. A protocol with poor framing breaks silently on certain inputs. A protocol without versioning forces a flag day — every client and server must upgrade simultaneously.

These decisions compound over time. The pain of a poorly designed protocol is not felt on day one. It is felt when you try to add a new field three years later and discover that old clients will misinterpret it as something else.

This module teaches protocol design by building one: a complete, binary, versioned, extensible protocol called **ZigWire** that you will use as the transport layer for the distributed systems chapters that follow.

---

## Learning Objectives

By the end of this module, you will be able to:

- Explain the four fundamental framing strategies and choose the right one for a given use case
- Explain why TCP is a stream protocol and what problems that creates for application protocols
- Design a binary protocol header with magic bytes, version, type, and length fields
- Implement length-prefix framing that handles partial reads correctly
- Implement TLV (Type-Length-Value) encoding for extensible messages
- Explain forward and backward compatibility and design protocols that achieve both
- Compare text vs binary protocols and choose correctly based on requirements
- Implement a complete protocol negotiation (handshake) in Zig
- Measure protocol parsing overhead using the benchmarking tools from Module 10
- Explain when to use existing serialization formats (Protobuf, MessagePack) vs a custom protocol

---

## Part 1: The Core Problem — TCP is a Stream

### 1.1 No Message Boundaries

The most common beginner mistake in network programming: assuming that one `send()` call on the sender corresponds to one `recv()` call on the receiver.

This is false. TCP is a byte stream. It guarantees that bytes arrive in order and without loss, but it makes no guarantee about how they are grouped. A `send()` of 100 bytes may result in two `recv()` calls of 50 bytes each. Two `send()` calls of 50 bytes each may arrive in one `recv()` of 100 bytes. On a local loopback interface these differences rarely appear, which is why this bug is invisible in development and catastrophic in production.

```zig
// BROKEN: assumes one send = one recv
// Sender:
_ = linux.send(fd, message.ptr, message.len, 0);

// Receiver:
var buf: [1024]u8 = undefined;
const n = linux.recv(fd, &buf, buf.len, 0);
// n may be less than message.len, equal, or (if sends were batched)
// n may include bytes from the NEXT message
```

Every application protocol must solve this problem. The solution is **framing**: a convention for marking where one message ends and the next begins.

### 1.2 The Four Framing Strategies

**Strategy 1: Fixed-length messages**

Every message is exactly N bytes. The receiver reads exactly N bytes per message.

```
│ MSG (N bytes) │ MSG (N bytes) │ MSG (N bytes) │
```

Simple. Fast. Zero overhead. Works when all messages are the same size. Useless when message sizes vary.

**Strategy 2: Delimiter-based framing**

Messages are separated by a special byte sequence (the delimiter). The receiver buffers data until it sees the delimiter.

```
│ content... │ \r\n │ content... │ \r\n │
```

Used by: HTTP/1.1 headers, SMTP, FTP, RESP simple strings. Human-readable. Easy to debug with `telnet`. Fatal flaw: if the delimiter can appear in the content (binary data), framing breaks. HTTP "solves" this with Content-Length for bodies — effectively falling back to length-prefix for the part that matters.

**Strategy 3: Length-prefix framing**

Each message is preceded by a fixed-size length field indicating how many bytes follow.

```
│ len(4) │ content(len bytes) │ len(4) │ content(len bytes) │
```

Used by: most binary protocols, RESP bulk strings (`$6\r\nfoobar\r\n` is length-prefixed), Protobuf over the wire. Works for arbitrary binary content. Fast to parse. The length field size determines the maximum message size (u32 = max 4GB per message).

**Strategy 4: Type-Length-Value (TLV)**

Each field in the message is preceded by a type identifier and a length. The message is a sequence of such fields.

```
│ type(1) │ len(2) │ value(len bytes) │ type(1) │ len(2) │ value │ ...
```

Used by: TLS (records), SNMP, many network management protocols, ASN.1. Extremely extensible — new types can be added without breaking old parsers, which skip unknown types. Higher overhead per field. The basis of most versioned protocols.

### 1.3 Choosing a Strategy

| Use case | Strategy | Why |
|----------|----------|-----|
| Fixed-size sensor data | Fixed-length | Zero overhead, all messages identical |
| Line-oriented text protocol | Delimiter | Human-readable, debug with telnet |
| General-purpose binary RPC | Length-prefix | Fast, handles arbitrary content |
| Extensible, versioned protocol | TLV | Future-proof, backward compatible |
| High-performance, schema-defined | Length-prefix + schema | Best throughput when schema is known |

Most production binary protocols use length-prefix framing for the outer envelope and TLV for the content, giving both efficiency and extensibility.

---

## Part 2: Designing ZigWire

### 2.1 Requirements

ZigWire is the protocol we will use for the distributed key-value store in the remaining chapters. Requirements:

- Bidirectional: both client and server can send messages
- Binary: efficient encoding, no text parsing overhead
- Versioned: multiple versions can coexist during rolling upgrades
- Extensible: new message types can be added without breaking old code
- Safe: a malformed message cannot crash the parser
- Detectable: magic bytes identify ZigWire packets in a network capture

### 2.2 The Frame Structure

Every ZigWire message is called a **frame**. The frame structure:

```
ZigWire Frame:
┌────────────────────────────────────────────────────────────────┐
│                    Frame Header (16 bytes)                     │
│                                                                │
│  magic(4) │ version(1) │ type(1) │ flags(1) │ reserved(1)     │
│  length(4) │ request_id(4)                                    │
├────────────────────────────────────────────────────────────────┤
│                    Frame Body (length bytes)                   │
│                                                                │
│  [TLV fields...]                                               │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Magic (4 bytes):** `0x5A574952` — "ZWIR" in ASCII. Identifies ZigWire frames. A receiver that sees an unexpected magic value knows the stream is corrupt or misidentified.

**Version (1 byte):** Protocol version. Currently `1`. Allows clients and servers to negotiate capabilities and reject incompatible connections.

**Type (1 byte):** Message type. Determines how the body is interpreted. Values 0-127 are ZigWire-reserved; values 128-255 are available for application use.

**Flags (1 byte):** Per-message flags. Bit 0 = is_response, bit 1 = is_error, bit 2 = is_compressed. Other bits reserved (must be zero).

**Reserved (1 byte):** Must be zero. Allows future header expansion without changing the header size.

**Length (4 bytes, little-endian):** Length of the body in bytes. Maximum 16MB (enforced by the receiver as a denial-of-service mitigation — a receiver that allocates based on a length field from an untrusted source must sanity-check it).

**Request ID (4 bytes, little-endian):** Matches requests to responses. The client sets this to a unique value per request; the server echoes it in the response. Allows pipelined requests (multiple outstanding requests) to be matched correctly.

```zig
const std = @import("std");

pub const ZIGWIRE_MAGIC: u32 = 0x5A574952; // "ZWIR"
pub const ZIGWIRE_VERSION: u8 = 1;
pub const MAX_FRAME_BODY: u32 = 16 * 1024 * 1024; // 16 MB

pub const FrameType = enum(u8) {
    // Connection lifecycle
    hello        = 0x01,
    hello_ack    = 0x02,
    ping         = 0x03,
    pong         = 0x04,
    disconnect   = 0x05,

    // Key-value operations (used later in distributed chapters)
    kv_get       = 0x10,
    kv_set       = 0x11,
    kv_del       = 0x12,
    kv_response  = 0x13,

    // Replication (used in distributed chapters)
    replicate    = 0x20,
    replicate_ack= 0x21,

    _,  // unknown types: skip and continue
};

pub const FrameFlags = packed struct(u8) {
    is_response:   bool,
    is_error:      bool,
    is_compressed: bool,
    _reserved:     u5,
};

pub const FrameHeader = extern struct {
    magic:      u32,  // little-endian
    version:    u8,
    msg_type:   u8,
    flags:      u8,
    reserved:   u8,
    length:     u32,  // little-endian: body length
    request_id: u32,  // little-endian

    comptime { std.debug.assert(@sizeOf(FrameHeader) == 16); }

    pub fn is_valid(self: *const FrameHeader) bool {
        return std.mem.littleToNative(u32, self.magic) == ZIGWIRE_MAGIC
            and self.version == ZIGWIRE_VERSION
            and self.reserved == 0
            and std.mem.littleToNative(u32, self.length) <= MAX_FRAME_BODY;
    }
};
```

### 2.3 The Body: TLV Fields

The frame body is a sequence of TLV (Type-Length-Value) fields:

```
TLV Field:
┌──────────┬──────────────────┬───────────────────┐
│ tag(1)   │ length(2, LE)    │ value(length bytes)│
└──────────┴──────────────────┴───────────────────┘
```

**Tag (1 byte):** Identifies the field type. Receivers that do not recognize a tag skip exactly `length` bytes and continue parsing. This is the key to extensibility — new tags can be added in new versions without breaking old receivers.

**Length (2 bytes, little-endian):** Length of the value. Maximum 65,535 bytes per field. For larger values, use a dedicated large-value tag with a 4-byte length.

**Value (length bytes):** The actual data. Interpretation depends on the tag.

```zig
pub const TlvTag = enum(u8) {
    // Universal tags
    key          = 0x01, // []u8: key name
    value        = 0x02, // []u8: value bytes
    error_code   = 0x03, // u32: error code
    error_msg    = 0x04, // []u8: error description
    ttl_ms       = 0x05, // u64: time-to-live in milliseconds
    timestamp    = 0x06, // u64: unix timestamp in milliseconds

    // Hello/capability negotiation
    client_id    = 0x10, // []u8: client identifier
    server_id    = 0x11, // []u8: server identifier
    capabilities = 0x12, // u32 bitmask: supported features

    // Replication
    sequence_num = 0x20, // u64: replication sequence number
    node_id      = 0x21, // u16: cluster node identifier

    _,  // unknown tags: skip
};

pub const TlvField = struct {
    tag: u8,
    value: []const u8, // points into the frame buffer (zero-copy)
};
```

### 2.4 Zero-Copy Parsing

A key design goal: the parser should not copy the body data. Instead, it returns slices that point directly into the input buffer. This eliminates allocation overhead in the hot path.

```zig
pub const FrameParser = struct {
    /// Parse a sequence of TLV fields from a body slice.
    /// Returns a slice of TlvField, each pointing into the body.
    /// Caller does not own the TlvField values — they alias the body.
    pub fn parse_tlv(
        body: []const u8,
        fields: []TlvField,
    ) ![]TlvField {
        var pos: usize = 0;
        var count: usize = 0;

        while (pos < body.len) {
            if (pos + 3 > body.len) return error.TruncatedField;

            const tag = body[pos];
            const length = std.mem.readInt(u16, body[pos+1..][0..2], .little);
            pos += 3;

            if (pos + length > body.len) return error.TruncatedValue;

            if (count < fields.len) {
                fields[count] = .{
                    .tag = tag,
                    .value = body[pos..][0..length], // zero-copy slice
                };
                count += 1;
            }

            pos += length;
        }

        return fields[0..count];
    }

    /// Find a specific tag in a parsed field array.
    pub fn find_tag(fields: []const TlvField, tag: TlvTag) ?[]const u8 {
        for (fields) |f| {
            if (f.tag == @intFromEnum(tag)) return f.value;
        }
        return null;
    }

    /// Typed accessors for common value types
    pub fn read_u32(value: []const u8) !u32 {
        if (value.len < 4) return error.TooShort;
        return std.mem.readInt(u32, value[0..4], .little);
    }

    pub fn read_u64(value: []const u8) !u64 {
        if (value.len < 8) return error.TooShort;
        return std.mem.readInt(u64, value[0..8], .little);
    }
};
```

---

## Part 3: The Frame Reader

### 3.1 Handling Partial Reads

The frame reader must handle TCP's stream nature — a frame may arrive in multiple `recv()` calls, and multiple frames may arrive in one call.

The reader uses a state machine (Module 5 pattern) with two states: reading the header and reading the body.

```zig
const std = @import("std");

const ReaderState = union(enum) {
    reading_header: struct {
        buf: [16]u8,
        read: usize,
    },
    reading_body: struct {
        header: FrameHeader,
        buf: []u8,     // allocated based on header.length
        read: usize,
    },
};

pub const Frame = struct {
    header: FrameHeader,
    body: []u8,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *Frame) void {
        self.allocator.free(self.body);
    }
};

pub const FrameReader = struct {
    state: ReaderState,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) FrameReader {
        return .{
            .state = .{ .reading_header = .{ .buf = undefined, .read = 0 } },
            .allocator = allocator,
        };
    }

    pub const FeedResult = union(enum) {
        /// Need more bytes
        incomplete,
        /// A complete frame is ready
        complete: Frame,
        /// Protocol error — connection should be closed
        err: ProtocolError,
    };

    pub const ProtocolError = enum {
        bad_magic,
        bad_version,
        body_too_large,
        allocation_failed,
    };

    /// Feed bytes into the reader.
    /// Returns the number of bytes consumed and optionally a complete frame.
    pub fn feed(self: *FrameReader, data: []const u8) struct {
        consumed: usize,
        result: FeedResult,
    } {
        var pos: usize = 0;

        switch (self.state) {
            .reading_header => |*s| {
                // Fill the 16-byte header buffer
                const needed = 16 - s.read;
                const available = @min(needed, data.len - pos);
                @memcpy(s.buf[s.read..][0..available], data[pos..][0..available]);
                s.read += available;
                pos += available;

                if (s.read < 16) {
                    return .{ .consumed = pos, .result = .incomplete };
                }

                // Parse header
                const hdr: *const FrameHeader = @ptrCast(&s.buf);
                if (!hdr.is_valid()) {
                    const magic = std.mem.littleToNative(u32, hdr.magic);
                    if (magic != ZIGWIRE_MAGIC) {
                        return .{ .consumed = pos, .result = .{ .err = .bad_magic } };
                    }
                    if (hdr.version != ZIGWIRE_VERSION) {
                        return .{ .consumed = pos, .result = .{ .err = .bad_version } };
                    }
                    return .{ .consumed = pos, .result = .{ .err = .body_too_large } };
                }

                const body_len = std.mem.littleToNative(u32, hdr.length);

                if (body_len == 0) {
                    // Empty body: complete frame immediately
                    const frame = Frame{
                        .header = hdr.*,
                        .body = &[_]u8{},
                        .allocator = self.allocator,
                    };
                    self.state = .{ .reading_header = .{ .buf = undefined, .read = 0 } };
                    return .{ .consumed = pos, .result = .{ .complete = frame } };
                }

                // Allocate body buffer and transition to body-reading state
                const buf = self.allocator.alloc(u8, body_len) catch {
                    return .{ .consumed = pos, .result = .{ .err = .allocation_failed } };
                };

                self.state = .{ .reading_body = .{
                    .header = hdr.*,
                    .buf = buf,
                    .read = 0,
                }};

                // Fall through to read body bytes from the same data slice
                if (pos < data.len) {
                    const next = self.feed(data[pos..]);
                    return .{ .consumed = pos + next.consumed, .result = next.result };
                }
                return .{ .consumed = pos, .result = .incomplete };
            },

            .reading_body => |*s| {
                const body_len = s.buf.len;
                const needed = body_len - s.read;
                const available = @min(needed, data.len - pos);

                @memcpy(s.buf[s.read..][0..available], data[pos..][0..available]);
                s.read += available;
                pos += available;

                if (s.read < body_len) {
                    return .{ .consumed = pos, .result = .incomplete };
                }

                // Body complete: return the frame
                const frame = Frame{
                    .header = s.header,
                    .body = s.buf,
                    .allocator = self.allocator,
                };
                self.state = .{ .reading_header = .{ .buf = undefined, .read = 0 } };
                return .{ .consumed = pos, .result = .{ .complete = frame } };
            },
        }
    }

    pub fn deinit(self: *FrameReader) void {
        if (self.state == .reading_body) {
            self.allocator.free(self.state.reading_body.buf);
        }
    }
};
```

### 3.2 The Frame Writer

Writing a frame requires constructing the header, serializing TLV fields into the body, then writing both to the network:

```zig
pub const FrameWriter = struct {
    buf: std.ArrayList(u8),

    pub fn init(allocator: std.mem.Allocator) FrameWriter {
        return .{ .buf = std.ArrayList(u8).init(allocator) };
    }

    pub fn deinit(self: *FrameWriter) void {
        self.buf.deinit();
    }

    pub fn reset(self: *FrameWriter) void {
        self.buf.clearRetainingCapacity();
    }

    pub fn bytes(self: *const FrameWriter) []const u8 {
        return self.buf.items;
    }

    /// Begin writing a frame. Reserves space for the header.
    /// Call write_tlv_* methods to add body fields.
    /// Call finish() to fill in the header with the correct body length.
    pub fn begin(
        self: *FrameWriter,
        msg_type: FrameType,
        flags: FrameFlags,
        request_id: u32,
    ) !void {
        self.reset();
        // Reserve 16 bytes for header (filled in by finish())
        try self.buf.appendNTimes(0, 16);
        _ = msg_type;
        _ = flags;
        _ = request_id;
        // Store these for finish()
        self.pending_type = @intFromEnum(msg_type);
        self.pending_flags = @bitCast(flags);
        self.pending_request_id = request_id;
    }

    pending_type: u8 = 0,
    pending_flags: u8 = 0,
    pending_request_id: u32 = 0,

    /// Finalize the frame: fill in the header with actual body length.
    pub fn finish(self: *FrameWriter) !void {
        const body_len = self.buf.items.len - 16;
        const hdr: *FrameHeader = @ptrCast(self.buf.items[0..16]);
        hdr.magic = std.mem.nativeToLittle(u32, ZIGWIRE_MAGIC);
        hdr.version = ZIGWIRE_VERSION;
        hdr.msg_type = self.pending_type;
        hdr.flags = self.pending_flags;
        hdr.reserved = 0;
        hdr.length = std.mem.nativeToLittle(u32, @intCast(body_len));
        hdr.request_id = std.mem.nativeToLittle(u32, self.pending_request_id);
    }

    /// Append a TLV field with a byte slice value
    pub fn write_tlv_bytes(self: *FrameWriter, tag: TlvTag,
                           value: []const u8) !void {
        if (value.len > 65535) return error.ValueTooLarge;
        try self.buf.append(@intFromEnum(tag));
        var len_bytes: [2]u8 = undefined;
        std.mem.writeInt(u16, &len_bytes, @intCast(value.len), .little);
        try self.buf.appendSlice(&len_bytes);
        try self.buf.appendSlice(value);
    }

    /// Append a TLV field with a u32 value
    pub fn write_tlv_u32(self: *FrameWriter, tag: TlvTag, value: u32) !void {
        var bytes: [4]u8 = undefined;
        std.mem.writeInt(u32, &bytes, value, .little);
        try self.write_tlv_bytes(tag, &bytes);
    }

    /// Append a TLV field with a u64 value
    pub fn write_tlv_u64(self: *FrameWriter, tag: TlvTag, value: u64) !void {
        var bytes: [8]u8 = undefined;
        std.mem.writeInt(u64, &bytes, value, .little);
        try self.write_tlv_bytes(tag, &bytes);
    }
};
```

---

## Part 4: Versioning and Backward Compatibility

### 4.1 The Compatibility Matrix

Protocol versioning must handle four cases:

| Client version | Server version | Outcome |
|----------------|----------------|---------|
| Old | Old | Normal operation |
| Old | New | **Backward compatibility:** new server handles old clients |
| New | Old | **Forward compatibility:** new clients work with old servers |
| New | New | Normal operation with new features |

**Backward compatibility** (new code handles old messages): Generally achievable. New server knows about old message formats and handles them correctly.

**Forward compatibility** (old code handles new messages): Much harder. Old code does not know about new message types. The TLV design handles this: old parsers skip unknown tags, so new fields added to existing messages are silently ignored by old code.

### 4.2 ZigWire's Versioning Rules

**Rule 1: The magic bytes and 16-byte header structure never change.** A receiver can always read the first 16 bytes to determine if it is looking at a ZigWire frame and what version it is.

**Rule 2: Version negotiation happens in the HELLO handshake.** The client sends its minimum and maximum supported versions; the server responds with the negotiated version. Both sides then use the negotiated version for the rest of the connection.

**Rule 3: New message types have new type codes.** Old receivers that see an unknown type can either close the connection (if they require understanding all messages) or skip the frame (if they can tolerate unknown messages).

**Rule 4: New TLV tags within existing message types are always optional.** Old receivers skip unknown tags. New receivers provide defaults for absent optional tags.

**Rule 5: Existing TLV tags never change meaning.** A tag that means "key name" in version 1 means "key name" in version 2. Changing meaning is a breaking change requiring a new tag.

**Rule 6: Remove fields by deprecation, not deletion.** Mark a tag as deprecated in the spec; stop sending it; old code that still reads it gets the value. After all old clients are gone, new code can stop sending and reading it.

### 4.3 The HELLO Handshake

```zig
/// HELLO frame body: sent by client to initiate connection
const HelloBody = struct {
    // TLV fields:
    // client_id (tag 0x10): []u8 — unique client identifier
    // capabilities (tag 0x12): u32 bitmask — what features client supports
    // min_version (tag 0x30): u8 — minimum protocol version client can speak
    // max_version (tag 0x31): u8 — maximum protocol version client can speak
};

/// HELLO_ACK frame body: sent by server in response
const HelloAckBody = struct {
    // TLV fields:
    // server_id (tag 0x11): []u8 — unique server identifier
    // capabilities (tag 0x12): u32 bitmask — features server supports
    // negotiated_version (tag 0x32): u8 — version both sides will use
    // session_id (tag 0x33): u64 — session identifier for logging
};

pub const Capability = struct {
    pub const COMPRESSION: u32 = 1 << 0;
    pub const PIPELINING:  u32 = 1 << 1;
    pub const BATCH_OPS:   u32 = 1 << 2;
};

pub fn perform_handshake_client(
    fd: i32,
    reader: *FrameReader,
    writer: *FrameWriter,
    client_id: []const u8,
) !u8 {
    // Send HELLO
    try writer.begin(.hello, .{
        .is_response = false,
        .is_error = false,
        .is_compressed = false,
        ._reserved = 0,
    }, 1);
    try writer.write_tlv_bytes(.client_id, client_id);
    try writer.write_tlv_u32(.capabilities,
        Capability.COMPRESSION | Capability.PIPELINING);

    var min_v: [1]u8 = .{1};
    var max_v: [1]u8 = .{1};
    try writer.write_tlv_bytes(@enumFromInt(0x30), &min_v); // min_version
    try writer.write_tlv_bytes(@enumFromInt(0x31), &max_v); // max_version
    try writer.finish();

    // Write to socket
    const frame_bytes = writer.bytes();
    var sent: usize = 0;
    while (sent < frame_bytes.len) {
        const n = @as(isize, @bitCast(
            std.os.linux.write(fd, frame_bytes[sent..].ptr,
                frame_bytes.len - sent)));
        if (n <= 0) return error.SendFailed;
        sent += @intCast(n);
    }

    // Read HELLO_ACK
    var buf: [4096]u8 = undefined;
    while (true) {
        const n = @as(isize, @bitCast(
            std.os.linux.read(fd, &buf, buf.len)));
        if (n <= 0) return error.ReceiveFailed;

        const result = reader.feed(buf[0..@intCast(n)]);
        switch (result.result) {
            .incomplete => continue,
            .err => return error.ProtocolError,
            .complete => |frame| {
                defer var f = frame;
                defer f.deinit();

                if (frame.header.msg_type != @intFromEnum(FrameType.hello_ack)) {
                    return error.UnexpectedMessageType;
                }

                // Parse negotiated version from TLV fields
                var tlv_fields: [16]TlvField = undefined;
                const fields = try FrameParser.parse_tlv(frame.body, &tlv_fields);

                const version_bytes = FrameParser.find_tag(fields, @enumFromInt(0x32));
                if (version_bytes == null or version_bytes.?.len < 1) {
                    return error.MissingNegotiatedVersion;
                }

                return version_bytes.?[0];
            },
        }
    }
}
```

---

## Part 5: Text vs Binary — Choosing Correctly

### 5.1 Text Protocol Advantages

Text protocols — where messages are human-readable strings — have genuine advantages:

**Debuggability:** You can read a network capture without any tooling. `telnet localhost 6379` and type `PING\r\n` — you see `+PONG\r\n`. This accelerates development and incident debugging enormously.

**Simplicity of implementation:** Parsing ASCII digits and CRLF requires no library, no generated code, no schema management.

**Universality:** Any language with a string library can implement the protocol. The client ecosystem grows faster.

**Good examples:** HTTP/1.1, Redis RESP, SMTP, FTP, memcached text protocol.

### 5.2 Binary Protocol Advantages

Binary protocols — where messages are encoded as structured byte sequences — win on a different set of dimensions:

**Performance:** No parsing of numeric strings. Integers are stored and read as raw bytes. A 64-bit integer is 8 bytes; its decimal representation can be 20 bytes. Parsing "123456789012345678" into a u64 requires a loop; reading 8 bytes is a single load instruction.

**Compactness:** Binary encoding is almost always smaller than text. A protocol like ZigWire can encode 10 fields in 100 bytes; the equivalent JSON might be 400 bytes.

**Binary safety:** Text protocols must escape or reject binary data (null bytes, control characters, CRLF within content). Binary protocols with length-prefix framing handle arbitrary bytes trivially.

**Schema enforcement:** With a binary format and a schema, the compiler or runtime can enforce field types, validate lengths, and generate parsing code automatically.

**Good examples:** gRPC/Protobuf, QUIC, TLS, Kafka, ZigWire.

### 5.3 The Measurement

The performance difference between text and binary parsing is measurable. Build it and measure it:

```zig
const std = @import("std");

/// Benchmark: parse an integer from decimal text vs binary
pub fn benchmark_integer_parsing() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const ITERS: usize = 10_000_000;
    const text_value = "9876543210";
    var binary_value: [8]u8 = undefined;
    std.mem.writeInt(u64, &binary_value, 9876543210, .little);

    var timer = try std.time.Timer.start();
    var sum: u64 = 0;

    // Text parsing
    timer.reset();
    for (0..ITERS) |_| {
        const n = try std.fmt.parseInt(u64, text_value, 10);
        sum +%= n;
    }
    const text_ns = timer.read();
    std.mem.doNotOptimizeAway(sum);

    // Binary reading
    sum = 0;
    timer.reset();
    for (0..ITERS) |_| {
        const n = std.mem.readInt(u64, &binary_value, .little);
        sum +%= n;
    }
    const binary_ns = timer.read();
    std.mem.doNotOptimizeAway(sum);

    std.debug.print("Text parse:   {d:.1} ns/op\n",
        .{@as(f64, @floatFromInt(text_ns)) / @as(f64, @floatFromInt(ITERS))});
    std.debug.print("Binary read:  {d:.1} ns/op\n",
        .{@as(f64, @floatFromInt(binary_ns)) / @as(f64, @floatFromInt(ITERS))});
    std.debug.print("Speedup: {d:.1}x\n", .{
        @as(f64, @floatFromInt(text_ns)) /
        @as(f64, @floatFromInt(binary_ns)),
    });
    _ = allocator;
}
```

Typical result: binary reading is 5-20x faster than text parsing for integers. For small messages at high throughput (100k+ req/sec), this difference is significant.

### 5.4 When to Use Existing Serialization Formats

Building a custom protocol is a significant investment. Before doing so, evaluate whether an existing format meets your needs:

**Protobuf:** Google's binary serialization. Schema-defined (.proto files), code generation in all languages, excellent versioning story (field numbers never change, new fields are optional). Best choice when you need multi-language support and long-term schema evolution. Overhead: requires schema files and code generation tooling.

**MessagePack:** Binary JSON. No schema, self-describing, every language has a library. Smaller than JSON, faster to parse. Good for dynamic data or when schema is too fluid to pin down. Less efficient than schema-driven formats.

**FlatBuffers:** Zero-copy binary format. Data is read directly from the buffer without parsing — you access fields via generated accessor functions that compute offsets into the raw bytes. Fastest possible deserialization; useful when most fields go unread. Higher encoding overhead than Protobuf.

**Cap'n Proto:** Similar goals to FlatBuffers but with a different approach to schema evolution. Designed to be fast to encode and decode, with the memory layout being canonical.

**Use a custom protocol when:**
- Your format has specific constraints these libraries do not support
- You need maximum control over the wire format for interoperability with existing systems
- The existing formats add unacceptable dependency overhead (embedded systems, kernels)
- You are implementing an existing protocol specification (like ZigWire for this curriculum)
- Performance benchmarks show existing formats are the bottleneck

---

## Part 6: Security Considerations

### 6.1 The Parser Attack Surface

Every parser is an attack surface. Network-facing parsers are attacked by adversaries who control the input. A parser that crashes on malformed input is a denial-of-service vulnerability. A parser that misinterprets malformed input may be an information disclosure or remote code execution vulnerability.

The canonical defenses:

**Validate length fields before allocating.** A frame that claims a 4GB body on a connection from an untrusted client should not cause a 4GB allocation. Enforce a maximum frame size and reject connections that violate it.

```zig
// VULNERABLE: allocates whatever the client claims
const body = try allocator.alloc(u8, hdr.length);

// SAFE: validate before allocating
if (hdr.length > MAX_FRAME_BODY) return error.FrameTooLarge;
const body = try allocator.alloc(u8, hdr.length);
```

**Enforce a maximum number of TLV fields.** A frame with 10,000 TLV fields may not exceed the body size limit, but iterating over 10,000 fields in the hot path is a performance attack.

**Reject frames with unknown versions.** Connecting with a version field of 255 to find out what happens is a common probe. Close the connection with a clear error.

**Never trust the request ID to be unique.** The request ID is for correlation; it is not a security token. Malicious clients can send duplicate request IDs to confuse pipelining.

### 6.2 Denial of Service via Slow Clients

A client that opens a connection, sends 14 bytes of a 16-byte header, and then goes silent holds a connection open indefinitely. On a server with 10,000 connections limit, an attacker can exhaust all connections with 10,000 such "slow" clients.

The fix: read timeouts. If the header is not complete within N seconds (typically 30-60 seconds), close the connection. This is exactly what the idle timeout in Module 12 provides.

```zig
// In the connection management loop:
// If a connection has been in "reading_header" state for > 30s
// without completing a frame header, close it
if (conn.state == .reading_header and
    now_ms - conn.last_activity_ms > HEADER_TIMEOUT_MS)
{
    close_connection(epfd, pool, fd);
}
```

### 6.3 Replay Attacks and Request IDs

The request ID in ZigWire is not a security mechanism. An attacker who can observe and replay messages can replay old request IDs. If the protocol is used over TLS (which it should be in production), TLS provides replay protection at the transport level.

For protocols that require authentication, the request ID should be combined with a cryptographic MAC (Message Authentication Code) to ensure that:
1. The message was sent by a legitimate peer
2. The message has not been tampered with
3. This specific message has not been replayed

This topic is covered in the security extension of the distributed systems modules.

---

## Part 7: Protocol Documentation

### 7.1 Why Documentation Matters

A protocol that exists only in implementation is not a protocol — it is an implementation. If the sole documentation is the source code, every new client must reverse-engineer the format from the code. If the code has a bug, clients codify the bug as "correct behavior" because they have no specification to refer to.

A well-documented protocol has:

**A specification document** that describes the wire format precisely, in terms of byte offsets, field types, endianness, and valid value ranges — independent of any implementation.

**A state machine diagram** showing the valid message sequences. What messages can a client send in what order? What states does the server transition through?

**Error codes and their meanings**, precisely defined. "Error 5 means the key does not exist" — not "error 5 means something went wrong."

**Versioning policy** — what changes are backward compatible, what changes are breaking, and how version negotiation works.

**Examples** — actual byte sequences with annotations. These catch ambiguities in the text specification.

### 7.2 ZigWire Specification Excerpt

```markdown
## ZigWire Protocol Specification — v1.0

### Frame Header

All multi-byte fields are in little-endian byte order.

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 4 | magic | 0x5A574952 ("ZWIR"). Identifies ZigWire frames. |
| 4 | 1 | version | Protocol version. Currently 1. |
| 5 | 1 | type | Message type. See Message Types. |
| 6 | 1 | flags | Bit 0: is_response. Bit 1: is_error. Bits 2-7: reserved (0). |
| 7 | 1 | reserved | Must be 0. |
| 8 | 4 | length | Body length in bytes. Max 16,777,216. |
| 12 | 4 | request_id | Client-assigned request identifier, echoed in responses. |

A receiver that reads a frame header with:
- magic != 0x5A574952: MUST close the connection.
- version != 1: MUST close the connection with a disconnect frame.
- length > 16,777,216: MUST close the connection.
- reserved != 0: MUST close the connection.

### TLV Field Encoding

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | tag |
| 1 | 2 | length (LE) |
| 3 | length | value |

A receiver that encounters an unknown tag MUST skip exactly `length` bytes
and continue parsing subsequent fields. It MUST NOT close the connection.

### Message Type: HELLO (0x01)

Direction: Client → Server (first message on any connection)
Required fields:
  - client_id (0x10): UTF-8 string, max 64 bytes
Optional fields:
  - capabilities (0x12): u32 bitmask
  - min_version (0x30): u8, default 1
  - max_version (0x31): u8, default 1
```

---

## Part 8: The Module Project — ZigWire Full Implementation

### Project Specification

Implement the complete ZigWire protocol stack: frame reader, frame writer, handshake, and a simple request/response client and server.

### Directory Structure

```
zigwire/
├── build.zig
└── src/
    ├── protocol.zig    ← FrameHeader, FrameType, TlvTag, constants
    ├── reader.zig      ← FrameReader state machine
    ├── writer.zig      ← FrameWriter, TLV serialization
    ├── handshake.zig   ← HELLO/HELLO_ACK negotiation
    ├── client.zig      ← ZigWire client: connect, send, receive
    ├── server.zig      ← ZigWire server: listen, accept, dispatch
    └── main.zig        ← Integration test
```

### Acceptance Criteria

The integration test verifies:

```zig
pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Start server in background thread
    const server_thread = try std.Thread.spawn(.{}, run_server, .{allocator});
    defer server_thread.join();

    // Give server time to start
    std.time.sleep(10_000_000);

    // Connect client
    var client = try ZigWireClient.connect("127.0.0.1", 7777, allocator);
    defer client.disconnect();

    // Test 1: PING/PONG round trip
    const pong = try client.ping();
    std.debug.assert(pong.header.msg_type == @intFromEnum(FrameType.pong));

    // Test 2: KV SET and GET
    try client.kv_set("hello", "world", null);
    const value = try client.kv_get("hello", allocator);
    defer allocator.free(value);
    std.debug.assert(std.mem.eql(u8, value, "world"));

    // Test 3: KV GET for missing key returns nil
    const missing = try client.kv_get("nonexistent", allocator);
    std.debug.assert(missing.len == 0);

    // Test 4: Pipelining — send 100 requests, receive 100 responses
    // (verifies request_id correlation works correctly)
    var pending: [100]u32 = undefined;
    for (&pending, 0..) |*req_id, i| {
        req_id.* = try client.kv_set_async(
            &std.fmt.bufPrint(&tmp, "key{d}", .{i}), "val", null);
    }
    for (pending) |req_id| {
        const resp = try client.receive_response(req_id);
        std.debug.assert(!resp.is_error());
    }

    std.debug.print("All tests passed.\n", .{});
}
```

### Benchmark

After the integration test passes, benchmark the protocol:

```bash
# Build in ReleaseFast
zig build -Doptimize=ReleaseFast

# Benchmark: 1M round-trip requests
./zig-out/bin/zigwire-bench -n 1000000 -c 1 --operation ping
./zig-out/bin/zigwire-bench -n 1000000 -c 50 --operation ping  # 50 concurrent

# Compare with Redis PING benchmark (same operation, different protocol)
redis-benchmark -p 6379 -n 1000000 -c 50 -t ping
```

Report: operations per second, p50/p99 latency, and comparison with Redis.

### Extension Challenges

1. **Compression:** When the `is_compressed` flag is set in the frame header, the body is compressed with a simple algorithm (zlib or zstd). Implement transparent compression/decompression in the frame reader and writer. Benchmark the throughput improvement for large values.

2. **TLS transport:** Wrap the TCP connection with TLS using Zig's standard library or a C library via Zig's C interop. Measure the latency overhead of TLS handshake and encryption.

3. **Protocol fuzzing:** Use Zig's built-in fuzzing support to fuzz the frame reader. Feed random byte sequences and verify the reader never panics, always returns a well-defined error or result. This validates that the security defenses are correct.

---

## Summary

Protocol design is a discipline that compounds over time. The decisions you make on day one affect what you can change three years later.

**Framing** is the first decision: fixed-length, delimiter, length-prefix, or TLV. Length-prefix is the right default for binary protocols. TLV enables extensibility at the cost of overhead per field. Most production protocols use length-prefix for the outer envelope and TLV for the content.

**Versioning** requires planning before you have a second version. Magic bytes identify your protocol. A version field in the header enables negotiation. TLV's skip-unknown-tags behavior enables forward compatibility. Backward compatibility requires the new server to understand old message formats.

**Binary vs text** is a tradeoff between debuggability and performance. Text protocols are easier to debug; binary protocols are 5-20x faster to parse and more compact. Most high-performance systems use binary protocols with optional text-mode debugging tools.

**Security** is not optional. Validate length fields before allocating. Enforce message size limits. Apply read timeouts. Treat every byte from an untrusted client as hostile input.

**Documentation** is what makes a protocol real. A protocol that exists only in code is an implementation detail; a protocol with a specification can have multiple implementations, can be implemented in other languages, and can evolve in a controlled way.

---

## What's Next

Module 15 — The Nature of Distributed Systems — applies the ZigWire protocol you have designed to build the foundation of a distributed system. You now have the transport layer. Module 15 adds the hard part: multiple machines, network partitions, and the impossibility results that constrain what any distributed system can achieve.

---

## Reference: ZigWire Frame Types

```
Type  Name           Direction  Description
────────────────────────────────────────────────────────────
0x01  HELLO          C → S      Connection initiation + capability negotiation
0x02  HELLO_ACK      S → C      Negotiated version + session ID
0x03  PING           Either     Liveness check
0x04  PONG           Either     Liveness response
0x05  DISCONNECT     Either     Graceful shutdown notification
0x10  KV_GET         C → S      Get value by key
0x11  KV_SET         C → S      Set key = value with optional TTL
0x12  KV_DEL         C → S      Delete one or more keys
0x13  KV_RESPONSE    S → C      Response to KV_GET/SET/DEL
0x20  REPLICATE      Leader → Follower  Replication log entry
0x21  REPLICATE_ACK  Follower → Leader  Replication acknowledgment

Flags (bit positions):
  Bit 0: is_response  (1 = this is a response to a request)
  Bit 1: is_error     (1 = request failed; body contains error TLVs)
  Bit 2: is_compressed (1 = body is compressed)
  Bits 3-7: reserved (must be 0)

TLV Tags:
  0x01  key            []u8   Key name
  0x02  value          []u8   Value bytes
  0x03  error_code     u32    Error code (0 = success)
  0x04  error_msg      []u8   Human-readable error description
  0x05  ttl_ms         u64    Time-to-live in milliseconds
  0x10  client_id      []u8   Client identifier
  0x11  server_id      []u8   Server identifier
  0x12  capabilities   u32    Feature bitmask
  0x20  sequence_num   u64    Replication sequence number
  0x21  node_id        u16    Cluster node identifier
```

---

*End of Module 14*
