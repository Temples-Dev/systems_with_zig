# Module 13: The Network Stack

## The Craft of Systems Programming — Teaching Material

---

> *"The internet is a series of tubes — and if you understand what is actually inside those tubes, at every layer, you understand something most programmers never will."*

---

## Before You Begin

Module 12 built a server that communicates over TCP. You called `socket()`, `bind()`, `listen()`, `accept()`, `read()`, and `write()`. It worked. But there is an enormous amount happening underneath those calls that you have taken on faith.

What is a TCP connection, precisely? What happens inside the kernel when you call `connect()`? Why does `send()` sometimes return fewer bytes than you asked to send? What is the difference between a socket and a connection? What is an IP address, really, and how does a packet find its way from your server in Ghana to a client in Germany?

This module answers those questions — not conceptually, but concretely. You will read actual packet bytes off the wire, construct raw IP and ICMP packets by hand, implement a DNS resolver from scratch, and build a minimal TCP state machine. The network stack will stop being a black box and become a system you understand at every level.

---

## Learning Objectives

By the end of this module, you will be able to:

- Describe the TCP/IP layer model and explain what each layer's role is
- Parse an Ethernet frame, IP header, TCP header, and UDP header at the byte level
- Implement a working `ping` using raw ICMP sockets in Zig
- Implement a `traceroute` using raw sockets with controlled TTL values
- Implement a DNS resolver that sends UDP queries and parses responses
- Explain what the socket API abstracts and what it leaves visible
- Use `tcpdump` and Wireshark to capture and analyze network traffic
- Explain TCP's connection lifecycle: three-way handshake, data transfer, teardown
- Explain TCP's reliability mechanisms: sequence numbers, acknowledgments, retransmission
- Explain TCP flow control and congestion control at a conceptual level
- Implement a minimal TCP connection using raw sockets

---

## Part 1: The Layer Model

### 1.1 Why Layers?

The internet works because every component in the network agrees on a set of protocols — rules for how data is formatted, addressed, transmitted, and routed. These protocols are organized into layers, where each layer depends on the one below it and provides a service to the one above it.

The beauty of this design is isolation: a web browser does not know or care whether it is running over Ethernet, Wi-Fi, or a cellular network. TCP does not know whether the application using it is HTTP or SMTP. This layering is what made the internet composable — you can swap out any layer without breaking the others, as long as the interfaces between layers are preserved.

The TCP/IP model has four layers:

```
┌─────────────────────────────────────────────────────────┐
│  Application Layer                                      │
│  HTTP, DNS, SMTP, SSH, Redis RESP, ZigLink...           │
│  "What is being communicated"                           │
├─────────────────────────────────────────────────────────┤
│  Transport Layer                                        │
│  TCP, UDP                                               │
│  "Reliable/unreliable delivery between processes"       │
├─────────────────────────────────────────────────────────┤
│  Internet Layer (Network Layer)                         │
│  IP (IPv4, IPv6), ICMP, ARP                             │
│  "Routing packets across networks"                      │
├─────────────────────────────────────────────────────────┤
│  Link Layer (Network Access Layer)                      │
│  Ethernet, Wi-Fi, cellular...                           │
│  "Moving bits between directly-connected devices"       │
└─────────────────────────────────────────────────────────┘
```

When your ZigCache server (Module 12) receives a `SET foo bar` command, the data traveled through all four layers to get there — each layer adding or removing its own header:

```
Sender                                       Receiver
─────────────────────────────────────────────────────
Application: "SET foo bar" (RESP-encoded)
    │                                           │
    ▼ TCP header added                          │ TCP header removed
Transport:  [TCP hdr][SET foo bar data]         │
    │                                           │
    ▼ IP header added                           │ IP header removed
Network:    [IP hdr][TCP hdr][data]             │
    │                                           │
    ▼ Ethernet frame added                      │ Ethernet frame removed
Link:       [ETH hdr][IP hdr][TCP hdr][data][ETH ftr]
    │                                           │
    ▼ onto the wire ────────────────────────────┘
```

This process of wrapping data with headers at each layer is called **encapsulation**. Unwrapping on receipt is **decapsulation**.

### 1.2 What Each Layer Does

**Link Layer:** Moves frames between directly connected devices. An Ethernet frame carries a destination MAC address (a 6-byte hardware address burned into the network interface), a source MAC address, an EtherType (what protocol the payload contains), and a checksum. The link layer does not know about IP addresses — it only knows about physical addresses within the local network segment.

**Internet Layer (IP):** Routes packets from source to destination across multiple networks. An IP packet carries source and destination IP addresses. Routers examine the destination IP address and forward the packet toward its destination, one hop at a time, with no guarantee of delivery, ordering, or absence of duplication.

**Transport Layer (TCP/UDP):** Provides process-to-process communication. Port numbers identify which process on the destination host should receive the data. TCP adds reliability (retransmission, ordering, flow control). UDP adds only port numbers and a checksum — nothing else.

**Application Layer:** The actual data being exchanged. HTTP, DNS, RESP, your custom binary protocol — this is where your application code lives.

### 1.3 The Socket Abstraction

The socket API sits between the application layer and the transport layer. It provides a uniform interface — `connect()`, `send()`, `recv()` — regardless of whether you are using TCP or UDP, IPv4 or IPv6. Below the socket API, the kernel handles all the transport and network layer complexity: TCP state machine, IP fragmentation, routing decisions, ARP lookups.

This is why the socket API is the right level of abstraction for most application programming. But as a systems programmer, you need to know what is happening below it.

---

## Part 2: The IP Header

### 2.1 IPv4 Header Structure

Every IP packet has a header describing how to deliver it. The minimum IPv4 header is 20 bytes:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐
│Version│  IHL  │    DSCP   │ECN│          Total Length             │
├───────────────┼───────────────────────────┼─┬─────────────────────┤
│         Identification                    │F│    Fragment Offset  │
├───────────────┼───────────────────────────┴─┴─────────────────────┤
│      TTL      │    Protocol   │         Header Checksum           │
├───────────────────────────────────────────────────────────────────┤
│                       Source IP Address                           │
├───────────────────────────────────────────────────────────────────┤
│                    Destination IP Address                         │
└───────────────────────────────────────────────────────────────────┘
```

Key fields:

**Version (4 bits):** `4` for IPv4, `6` for IPv6.

**IHL — Internet Header Length (4 bits):** Header length in 32-bit words. Minimum is 5 (20 bytes). Can be larger if options are present.

**Total Length (16 bits):** Total packet size including header and payload, in bytes. Maximum 65,535.

**TTL — Time to Live (8 bits):** Decremented by each router. When it reaches 0, the packet is discarded and the router sends an ICMP Time Exceeded message back to the sender. Prevents routing loops from circulating packets forever. Typically set to 64 (Linux) or 128 (Windows).

**Protocol (8 bits):** Identifies the transport protocol: `6` = TCP, `17` = UDP, `1` = ICMP.

**Header Checksum (16 bits):** One's complement checksum of the header only (not the payload). Each router recalculates this after decrementing TTL.

**Source/Destination Address (32 bits each):** IPv4 addresses in network byte order (big-endian).

```zig
/// IPv4 header: 20 bytes minimum, big-endian fields
const IpHeader = extern struct {
    // Version (4 bits) + IHL (4 bits)
    version_ihl: u8,
    // DSCP (6 bits) + ECN (2 bits) — usually 0
    tos: u8,
    // Total length including header
    total_len: u16,
    // Packet identifier (for fragmentation)
    id: u16,
    // Flags (3 bits) + Fragment offset (13 bits)
    flags_frag: u16,
    // Time to live
    ttl: u8,
    // Protocol: 1=ICMP, 6=TCP, 17=UDP
    protocol: u8,
    // Header checksum
    checksum: u16,
    // Source IP
    src: u32,
    // Destination IP
    dst: u32,

    comptime {
        std.debug.assert(@sizeOf(IpHeader) == 20);
    }

    pub fn version(self: IpHeader) u4 {
        return @intCast(self.version_ihl >> 4);
    }

    pub fn ihl(self: IpHeader) u4 {
        return @intCast(self.version_ihl & 0x0F);
    }

    pub fn header_len(self: IpHeader) usize {
        return @as(usize, self.ihl()) * 4;
    }

    pub fn src_addr(self: IpHeader) [4]u8 {
        return @bitCast(self.src);
    }

    pub fn dst_addr(self: IpHeader) [4]u8 {
        return @bitCast(self.dst);
    }
};
```

### 2.2 IP Addresses and CIDR

An IPv4 address is a 32-bit number, written in dotted decimal: `192.168.1.100`. It consists of two parts: a network portion and a host portion. The boundary between them is defined by a **subnet mask** or a **CIDR prefix length**.

`192.168.1.0/24` means:
- Network: first 24 bits (`192.168.1`)
- Hosts: last 8 bits (`.0` through `.255`)
- Subnet mask: `255.255.255.0` (24 ones followed by 8 zeros)

The kernel uses the routing table to decide where to send each packet: which packets go to the local network (same subnet), which go to the default gateway, and which go to specific remote networks. `ip route show` displays the routing table.

### 2.3 Network Byte Order

IP headers use big-endian (network byte order). x86-64 processors use little-endian. When reading or writing multi-byte fields in network packets, you must convert:

```zig
const std = @import("std");

// Convert host u16 to network byte order (big-endian)
fn htons(x: u16) u16 {
    return std.mem.nativeToBig(u16, x);
}

// Convert network u16 to host byte order
fn ntohs(x: u16) u16 {
    return std.mem.bigToNative(u16, x);
}

fn htonl(x: u32) u32 { return std.mem.nativeToBig(u32, x); }
fn ntohl(x: u32) u32 { return std.mem.bigToNative(u32, x); }
```

Forgetting byte order is one of the most common bugs in network programming. Always apply the conversion when reading from or writing to packet headers.

---

## Part 3: ICMP and Raw Sockets — Implementing ping

### 3.1 What ICMP Is

ICMP (Internet Control Message Protocol) is a companion to IP. It carries error messages and operational information: "this host is unreachable," "your TTL expired," "this packet is too large." It lives at the network layer — ICMP messages are encapsulated directly in IP packets with protocol number 1.

The `ping` utility uses ICMP Echo Request (type 8) and Echo Reply (type 0). You send an echo request; the destination's kernel automatically sends an echo reply.

```
ICMP Header (8 bytes):
┌──────────┬──────────┬──────────────────────────────┐
│  Type    │  Code    │         Checksum              │
│ (8=req,  │ (0)      │                               │
│  0=reply)│          │                               │
├──────────┴──────────┼──────────────────────────────┤
│       Identifier    │       Sequence Number         │
└─────────────────────┴──────────────────────────────┘
```

For Echo Request/Reply:
- **Type:** 8 = request, 0 = reply
- **Code:** Always 0
- **Checksum:** One's complement checksum of the ICMP header + data
- **Identifier:** Used to match replies to requests (process ID by convention)
- **Sequence Number:** Incremented with each ping, echoed in the reply

### 3.2 The Checksum Algorithm

IP and ICMP both use the same one's complement checksum algorithm:

```zig
/// Internet checksum: one's complement sum of 16-bit words.
/// Used by IP, ICMP, TCP, UDP.
pub fn inet_checksum(data: []const u8) u16 {
    var sum: u32 = 0;

    // Sum all 16-bit words
    var i: usize = 0;
    while (i + 1 < data.len) : (i += 2) {
        const word: u16 = (@as(u16, data[i]) << 8) | data[i + 1];
        sum += word;
    }

    // Handle odd byte (pad with zero)
    if (i < data.len) {
        sum += @as(u16, data[i]) << 8;
    }

    // Fold 32-bit sum to 16 bits
    while (sum >> 16 != 0) {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }

    // One's complement
    return ~@as(u16, @truncate(sum));
}
```

To verify a received packet: compute the checksum of the entire header (including the checksum field). If the checksum is correct, the result will be `0xFFFF` (or 0 depending on convention).

### 3.3 Raw Sockets

A **raw socket** bypasses the transport layer. Instead of TCP or UDP handling, you receive and construct packets manually. You need `CAP_NET_RAW` capability (or run as root) to create raw sockets.

There are two raw socket types relevant here:

**`SOCK_RAW` with `IPPROTO_ICMP`** (ping socket): The kernel handles ICMP for you at the ICMP level — you construct ICMP messages but the kernel adds the IP header.

**`SOCK_RAW` with `IPPROTO_RAW`** or `ETH_P_ALL` on a packet socket: Full control — you construct the entire IP packet including headers.

### 3.4 Implementing ping in Zig

```zig
const std = @import("std");
const linux = std.os.linux;

const ICMP_ECHO_REQUEST: u8 = 8;
const ICMP_ECHO_REPLY: u8 = 0;

const IcmpHeader = extern struct {
    type: u8,
    code: u8,
    checksum: u16,
    identifier: u16,
    sequence: u16,

    comptime { std.debug.assert(@sizeOf(IcmpHeader) == 8); }
};

const PingPacket = extern struct {
    header: IcmpHeader,
    // 56 bytes of payload (traditional ping data size)
    data: [56]u8,

    comptime { std.debug.assert(@sizeOf(PingPacket) == 64); }
};

pub fn ping(target_ip: []const u8, count: u32) !void {
    // Parse the target IP address
    const addr = try std.net.Address.parseIp4(target_ip, 0);

    // Create a raw ICMP socket
    // SOCK_DGRAM + IPPROTO_ICMP: kernel adds IP header, we only see ICMP
    const sock = @as(i32, @intCast(linux.socket(
        linux.AF.INET,
        linux.SOCK.DGRAM,
        linux.IPPROTO.ICMP)));
    if (sock < 0) return error.SocketFailed;
    defer _ = linux.close(sock);

    // Set receive timeout: 1 second
    const timeout = linux.timeval{ .sec = 1, .usec = 0 };
    _ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.RCVTIMEO,
        @ptrCast(&timeout), @sizeOf(linux.timeval));

    const pid: u16 = @intCast(linux.getpid() & 0xFFFF);

    for (0..count) |seq| {
        var pkt = std.mem.zeroes(PingPacket);
        pkt.header.type = ICMP_ECHO_REQUEST;
        pkt.header.code = 0;
        pkt.header.identifier = std.mem.nativeToBig(u16, pid);
        pkt.header.sequence = std.mem.nativeToBig(u16, @intCast(seq + 1));

        // Fill payload with known pattern
        for (&pkt.data, 0..) |*b, i| b.* = @intCast(i % 256);

        // Calculate checksum (header.checksum must be 0 before calculation)
        pkt.header.checksum = 0;
        pkt.header.checksum = inet_checksum(
            @as([*]const u8, @ptrCast(&pkt))[0..@sizeOf(PingPacket)]);

        // Record send time
        var start: linux.timespec = undefined;
        _ = linux.clock_gettime(linux.CLOCK.MONOTONIC, &start);

        // Send the ICMP packet
        const dest_addr = linux.sockaddr.in{
            .family = linux.AF.INET,
            .port = 0,
            .addr = addr.in.sa.addr,
            .zero = [_]u8{0} ** 8,
        };

        const sent = linux.sendto(sock,
            @as([*]const u8, @ptrCast(&pkt)),
            @sizeOf(PingPacket), 0,
            @ptrCast(&dest_addr),
            @sizeOf(linux.sockaddr.in));

        if (@as(isize, @bitCast(sent)) < 0) {
            std.debug.print("sendto failed\n", .{});
            continue;
        }

        // Receive the reply
        var reply_buf: [1024]u8 = undefined;
        var from_addr: linux.sockaddr.in = undefined;
        var from_len: linux.socklen_t = @sizeOf(linux.sockaddr.in);

        const rcvd = @as(isize, @bitCast(linux.recvfrom(
            sock,
            &reply_buf, reply_buf.len, 0,
            @ptrCast(&from_addr),
            &from_len)));

        var end: linux.timespec = undefined;
        _ = linux.clock_gettime(linux.CLOCK.MONOTONIC, &end);

        if (rcvd < 0) {
            std.debug.print("Request timeout for icmp_seq {d}\n", .{seq + 1});
            continue;
        }

        // Parse the ICMP reply
        // When using SOCK_DGRAM + IPPROTO_ICMP, the kernel strips the IP header
        // We receive the ICMP message directly
        if (rcvd < @sizeOf(IcmpHeader)) {
            std.debug.print("Reply too short\n", .{});
            continue;
        }

        const reply_icmp: *const IcmpHeader = @ptrCast(&reply_buf);

        if (reply_icmp.type != ICMP_ECHO_REPLY) {
            std.debug.print("Unexpected ICMP type: {d}\n", .{reply_icmp.type});
            continue;
        }

        // Calculate round-trip time
        const elapsed_ns = (@as(u64, @intCast(end.sec)) -
                           @as(u64, @intCast(start.sec))) * 1_000_000_000 +
                          (@as(u64, @intCast(end.nsec)) -
                           @as(u64, @intCast(start.nsec)));
        const elapsed_ms = @as(f64, @floatFromInt(elapsed_ns)) / 1_000_000.0;

        // Format the source IP
        const src_bytes = std.mem.asBytes(&from_addr.addr);
        std.debug.print(
            "{d} bytes from {d}.{d}.{d}.{d}: icmp_seq={d} ttl=?? time={d:.2} ms\n",
            .{
                rcvd,
                src_bytes[0], src_bytes[1], src_bytes[2], src_bytes[3],
                std.mem.bigToNative(u16, reply_icmp.sequence),
                elapsed_ms,
            });

        // Wait 1 second between pings
        if (seq + 1 < count) std.time.sleep(1_000_000_000);
    }
}

pub fn main() !void {
    try ping("8.8.8.8", 4);
}
```

### 3.5 Implementing traceroute

`traceroute` works by sending packets with deliberately small TTL values. Each router decrements TTL; when it reaches 0, the router discards the packet and sends an ICMP Time Exceeded (type 11) reply to the source. By starting with TTL=1 and incrementing, you discover each router on the path.

```zig
pub fn traceroute(target_ip: []const u8, max_hops: u8) !void {
    const target_addr = try std.net.Address.parseIp4(target_ip, 0);

    // Use UDP packets for traceroute (traditional) or ICMP (like macOS)
    // We use ICMP here for simplicity
    const send_sock = @as(i32, @intCast(linux.socket(
        linux.AF.INET,
        linux.SOCK.RAW,
        linux.IPPROTO.RAW)));
    if (send_sock < 0) return error.SendSocketFailed;
    defer _ = linux.close(send_sock);

    // Tell the kernel we are providing the IP header ourselves
    const one: i32 = 1;
    _ = linux.setsockopt(send_sock, linux.IPPROTO.IP, linux.IP.HDRINCL,
        @ptrCast(&one), @sizeOf(i32));

    // Receive socket: capture ICMP Time Exceeded replies
    const recv_sock = @as(i32, @intCast(linux.socket(
        linux.AF.INET,
        linux.SOCK.RAW,
        linux.IPPROTO.ICMP)));
    if (recv_sock < 0) return error.RecvSocketFailed;
    defer _ = linux.close(recv_sock);

    const timeout = linux.timeval{ .sec = 1, .usec = 0 };
    _ = linux.setsockopt(recv_sock, linux.SOL.SOCKET, linux.SO.RCVTIMEO,
        @ptrCast(&timeout), @sizeOf(linux.timeval));

    std.debug.print("traceroute to {s}, {d} hops max\n",
        .{target_ip, max_hops});

    const pid: u16 = @intCast(linux.getpid() & 0xFFFF);

    for (1..@as(usize, max_hops) + 1) |ttl| {
        // Build ICMP echo request with TTL = current hop count
        var packet: [84]u8 = std.mem.zeroes([84]u8);

        // IP header (20 bytes)
        const iph: *IpHeader = @ptrCast(&packet);
        iph.version_ihl = (4 << 4) | 5; // IPv4, 5 words
        iph.total_len = std.mem.nativeToBig(u16, @sizeOf([84]u8));
        iph.id = std.mem.nativeToBig(u16, @intCast(ttl));
        iph.ttl = @intCast(ttl);         // THIS is what traceroute controls
        iph.protocol = linux.IPPROTO.ICMP;
        iph.dst = target_addr.in.sa.addr;
        // Kernel fills source address and checksum

        // ICMP header (8 bytes) starting at byte 20
        const icmph: *IcmpHeader = @ptrCast(&packet[20]);
        icmph.type = ICMP_ECHO_REQUEST;
        icmph.code = 0;
        icmph.identifier = std.mem.nativeToBig(u16, pid);
        icmph.sequence = std.mem.nativeToBig(u16, @intCast(ttl));
        icmph.checksum = 0;
        icmph.checksum = inet_checksum(packet[20..28]);

        // Send the packet
        var send_time: linux.timespec = undefined;
        _ = linux.clock_gettime(linux.CLOCK.MONOTONIC, &send_time);

        const dest = linux.sockaddr.in{
            .family = linux.AF.INET,
            .port = 0,
            .addr = target_addr.in.sa.addr,
            .zero = [_]u8{0} ** 8,
        };
        _ = linux.sendto(send_sock, &packet, packet.len, 0,
            @ptrCast(&dest), @sizeOf(linux.sockaddr.in));

        // Wait for ICMP reply (Time Exceeded or Echo Reply)
        var reply: [1024]u8 = undefined;
        var from: linux.sockaddr.in = undefined;
        var from_len: linux.socklen_t = @sizeOf(linux.sockaddr.in);

        const n = @as(isize, @bitCast(linux.recvfrom(
            recv_sock, &reply, reply.len, 0,
            @ptrCast(&from), &from_len)));

        var recv_time: linux.timespec = undefined;
        _ = linux.clock_gettime(linux.CLOCK.MONOTONIC, &recv_time);

        if (n < 0) {
            std.debug.print("{d:3}  * * *  (timeout)\n", .{ttl});
            continue;
        }

        // Parse the reply: IP header + ICMP message
        if (n < 20) continue;
        const reply_ip: *const IpHeader = @ptrCast(&reply);
        const ip_hdr_len = reply_ip.header_len();
        if (@as(usize, @intCast(n)) < ip_hdr_len + 8) continue;

        const reply_icmp: *const IcmpHeader = @ptrCast(&reply[ip_hdr_len]);
        const elapsed_ns =
            (@as(u64, @intCast(recv_time.sec)) - @as(u64, @intCast(send_time.sec)))
            * 1_000_000_000 +
            (@as(u64, @intCast(recv_time.nsec)) - @as(u64, @intCast(send_time.nsec)));
        const elapsed_ms = @as(f64, @floatFromInt(elapsed_ns)) / 1_000_000.0;

        const hop_ip = std.mem.asBytes(&from.addr);
        std.debug.print("{d:3}  {d}.{d}.{d}.{d}  {d:.2} ms\n", .{
            ttl,
            hop_ip[0], hop_ip[1], hop_ip[2], hop_ip[3],
            elapsed_ms,
        });

        // If we got an Echo Reply, we've reached the destination
        if (reply_icmp.type == ICMP_ECHO_REPLY) {
            std.debug.print("Reached destination!\n", .{});
            break;
        }
        // Type 11 = Time Exceeded: this is a router along the path
        // Continue to next hop
    }
}
```

---

> **Exercise 13.1: Packet Inspector**
>
> Using `tcpdump -i any -w capture.pcap` to capture packets, then reading the file manually (pcap format: 24-byte global header, then per-packet records with 16-byte header + raw data), implement a packet inspector that:
>
> 1. Opens a pcap file and iterates over packets
> 2. For each packet: determines if it is IP (EtherType 0x0800), then whether it is TCP (protocol 6), UDP (17), or ICMP (1)
> 3. Prints: timestamp, source IP:port, destination IP:port, protocol, payload length
> 4. For DNS packets (UDP port 53): prints whether it is a query or response
>
> Use Zig's `extern struct` and `@bitCast` to parse the raw bytes directly.

---

## Part 4: UDP — The Simple Transport

### 4.1 What UDP Provides

UDP (User Datagram Protocol) adds exactly two things to raw IP:
- **Port numbers** — identify which process should receive the packet
- **Checksum** — optional integrity check of the header and payload

That is all. No connection setup. No guaranteed delivery. No ordering. No flow control. A UDP datagram is sent and the sender immediately forgets it — there is no mechanism for retransmission if it is lost.

```
UDP Header (8 bytes):
┌──────────────────────┬──────────────────────┐
│   Source Port        │   Destination Port   │
├──────────────────────┼──────────────────────┤
│     Length           │     Checksum         │
└──────────────────────┴──────────────────────┘
```

UDP is the right choice when:
- The application implements its own reliability (or tolerates loss)
- Low latency matters more than guaranteed delivery: DNS, NTP, video streaming, gaming
- The payload is small enough that a single datagram is sufficient
- Broadcast or multicast is needed (TCP is point-to-point only)

### 4.2 DNS — A Real UDP Application

DNS (Domain Name System) translates hostnames to IP addresses. It uses UDP port 53. A DNS query is a UDP datagram with a specific binary structure; the response is another UDP datagram.

Understanding DNS at the byte level is directly useful: every networked program does hostname resolution. Knowing how it works lets you debug resolution failures, implement custom resolvers, and understand what `getaddrinfo()` is doing.

**DNS Message Format:**

```
DNS Header (12 bytes):
┌──────────────────────┬──────────────────────┐
│    Transaction ID    │        Flags         │
├──────────────────────┼──────────────────────┤
│   Question Count     │   Answer Count       │
├──────────────────────┼──────────────────────┤
│  Authority Count     │  Additional Count    │
└──────────────────────┴──────────────────────┘

Flags:
  QR (1 bit):  0 = query, 1 = response
  OPCODE (4):  0 = standard query
  AA (1):      Authoritative Answer
  TC (1):      Truncated
  RD (1):      Recursion Desired (set by client)
  RA (1):      Recursion Available (set by server)
  Z  (3):      Reserved, must be 0
  RCODE (4):   0=no error, 1=format error, 2=server failure, 3=name error
```

**DNS Name Encoding:** Domain names in DNS are encoded as a sequence of labels, each preceded by a length byte, terminated by a zero byte. `www.example.com` is encoded as:
```
\x03www\x07example\x03com\x00
```

The `\x03` means "next 3 bytes are a label": `www`. Then `\x07` = 7 bytes: `example`. Then `\x03com`. Then `\x00` = end.

**Pointer compression:** DNS responses may use pointer compression to avoid repeating domain names. A two-byte sequence starting with `0xC0` is a pointer: the lower 14 bits are an offset from the start of the DNS message where the name continues.

### 4.3 Implementing a DNS Resolver

```zig
const std = @import("std");
const linux = std.os.linux;

const DNS_PORT: u16 = 53;
const DNS_TIMEOUT_MS: u32 = 5000;

const DnsHeader = extern struct {
    id: u16,
    flags: u16,
    qdcount: u16, // question count
    ancount: u16, // answer count
    nscount: u16, // authority count
    arcount: u16, // additional count

    comptime { std.debug.assert(@sizeOf(DnsHeader) == 12); }
};

/// Encode a domain name in DNS wire format.
/// "www.example.com" → \x03www\x07example\x03com\x00
pub fn encode_domain(name: []const u8, buf: []u8) !usize {
    var offset: usize = 0;
    var labels = std.mem.splitScalar(u8, name, '.');

    while (labels.next()) |label| {
        if (label.len == 0 or label.len > 63) return error.InvalidLabel;
        if (offset + 1 + label.len >= buf.len) return error.BufferTooSmall;
        buf[offset] = @intCast(label.len);
        offset += 1;
        @memcpy(buf[offset..][0..label.len], label);
        offset += label.len;
    }

    if (offset >= buf.len) return error.BufferTooSmall;
    buf[offset] = 0; // root label terminator
    offset += 1;
    return offset;
}

/// Decode a DNS name from a packet, handling pointer compression.
/// Returns the name and the number of bytes consumed (not counting pointer targets).
pub fn decode_domain(
    packet: []const u8,
    offset: usize,
    out: []u8,
) !struct { name: []const u8, consumed: usize } {
    var pos = offset;
    var out_pos: usize = 0;
    var consumed: ?usize = null; // set when we first follow a pointer

    var iterations: usize = 0;
    while (pos < packet.len and iterations < 128) : (iterations += 1) {
        const len = packet[pos];

        if (len == 0) {
            // End of name
            if (consumed == null) consumed = pos + 1 - offset;
            if (out_pos > 0 and out[out_pos - 1] == '.') {
                out_pos -= 1; // remove trailing dot
            }
            return .{ .name = out[0..out_pos], .consumed = consumed.? };
        }

        if (len & 0xC0 == 0xC0) {
            // Pointer compression: 2-byte pointer
            if (pos + 1 >= packet.len) return error.InvalidPacket;
            if (consumed == null) consumed = pos + 2 - offset;
            const ptr_offset = (@as(u16, len & 0x3F) << 8) | packet[pos + 1];
            pos = ptr_offset;
            continue;
        }

        // Regular label
        pos += 1;
        if (pos + len > packet.len) return error.InvalidPacket;
        if (out_pos + len + 1 >= out.len) return error.BufferTooSmall;

        @memcpy(out[out_pos..][0..len], packet[pos..][0..len]);
        out_pos += len;
        out[out_pos] = '.';
        out_pos += 1;
        pos += len;
    }

    return error.InvalidName;
}

/// Resolve a hostname to IPv4 addresses using a specified DNS server.
pub fn resolve(
    hostname: []const u8,
    dns_server: []const u8,
    allocator: std.mem.Allocator,
) ![]std.net.Address {
    const sock = @as(i32, @intCast(linux.socket(
        linux.AF.INET, linux.SOCK.DGRAM, linux.IPPROTO.UDP)));
    if (sock < 0) return error.SocketFailed;
    defer _ = linux.close(sock);

    const timeout = linux.timeval{
        .sec = DNS_TIMEOUT_MS / 1000,
        .usec = @intCast((DNS_TIMEOUT_MS % 1000) * 1000)
    };
    _ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.RCVTIMEO,
        @ptrCast(&timeout), @sizeOf(linux.timeval));

    // Build the DNS query
    var query: [512]u8 = std.mem.zeroes([512]u8);
    var qpos: usize = 0;

    const hdr: *DnsHeader = @ptrCast(&query);
    hdr.id = std.mem.nativeToBig(u16, 0x1337);  // transaction ID
    hdr.flags = std.mem.nativeToBig(u16, 0x0100); // QR=0, RD=1
    hdr.qdcount = std.mem.nativeToBig(u16, 1);    // one question
    qpos += @sizeOf(DnsHeader);

    // Question: QNAME
    const name_len = try encode_domain(hostname, query[qpos..]);
    qpos += name_len;

    // QTYPE = A (1 = IPv4 address)
    query[qpos] = 0; query[qpos+1] = 1;
    qpos += 2;

    // QCLASS = IN (1 = Internet)
    query[qpos] = 0; query[qpos+1] = 1;
    qpos += 2;

    // Send query
    const server_addr = try std.net.Address.parseIp4(dns_server, DNS_PORT);
    const dest = linux.sockaddr.in{
        .family = linux.AF.INET,
        .port = std.mem.nativeToBig(u16, DNS_PORT),
        .addr = server_addr.in.sa.addr,
        .zero = [_]u8{0} ** 8,
    };
    _ = linux.sendto(sock, &query, qpos, 0,
        @ptrCast(&dest), @sizeOf(linux.sockaddr.in));

    // Receive response
    var response: [4096]u8 = undefined;
    const n = @as(isize, @bitCast(linux.recvfrom(
        sock, &response, response.len, 0, null, null)));
    if (n < 0) return error.ReceiveTimeout;

    // Parse response
    const packet = response[0..@intCast(n)];
    if (packet.len < @sizeOf(DnsHeader)) return error.TruncatedResponse;

    const res_hdr: *const DnsHeader = @ptrCast(&packet[0]);
    const ans_count = std.mem.bigToNative(u16, res_hdr.ancount);
    const rcode = std.mem.bigToNative(u16, res_hdr.flags) & 0xF;

    if (rcode != 0) {
        if (rcode == 3) return error.NxDomain;
        return error.DnsError;
    }

    // Skip the question section
    var pos: usize = @sizeOf(DnsHeader);
    var name_buf: [256]u8 = undefined;
    const q_result = try decode_domain(packet, pos, &name_buf);
    pos += q_result.consumed + 4; // name + QTYPE + QCLASS

    // Parse answer records
    var addresses = std.ArrayList(std.net.Address).init(allocator);
    errdefer addresses.deinit();

    for (0..ans_count) |_| {
        if (pos >= packet.len) break;

        // Name (may be pointer)
        const a_result = try decode_domain(packet, pos, &name_buf);
        pos += a_result.consumed;

        if (pos + 10 > packet.len) break;

        const rtype = std.mem.bigToNative(u16, @as(u16, packet[pos]) << 8 | packet[pos+1]);
        // const rclass = ... (skip)
        // const ttl = ...   (skip)
        const rdlength = std.mem.bigToNative(u16,
            @as(u16, packet[pos+8]) << 8 | packet[pos+9]);
        pos += 10; // type(2) + class(2) + ttl(4) + rdlength(2)

        if (rtype == 1 and rdlength == 4) {
            // A record: 4 bytes = IPv4 address
            if (pos + 4 <= packet.len) {
                const ip_bytes = packet[pos..][0..4];
                const ip_int = std.mem.readInt(u32, ip_bytes, .big);
                const addr = std.net.Address{
                    .in = .{
                        .sa = .{
                            .family = linux.AF.INET,
                            .port = 0,
                            .addr = ip_int,
                            .zero = [_]u8{0} ** 8,
                        },
                    },
                };
                try addresses.append(addr);
            }
        }

        pos += rdlength;
    }

    return addresses.toOwnedSlice();
}

pub fn main() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const hostname = "example.com";
    const dns_server = "8.8.8.8"; // Google's DNS

    std.debug.print("Resolving {s}...\n", .{hostname});

    const addrs = try resolve(hostname, dns_server, allocator);
    defer allocator.free(addrs);

    for (addrs) |addr| {
        const bytes = std.mem.asBytes(&addr.in.sa.addr);
        std.debug.print("  {d}.{d}.{d}.{d}\n",
            .{bytes[0], bytes[1], bytes[2], bytes[3]});
    }
}
```

---

## Part 5: TCP — Reliability Built on Unreliability

### 5.1 What TCP Provides

TCP provides three things IP does not:

**Reliable delivery:** Every byte sent will be received, or the sender will be informed of failure. TCP maintains sequence numbers, acknowledgments, and retransmission timers to achieve this.

**Ordered delivery:** Bytes arrive at the receiver in the same order they were sent, regardless of how IP routed the packets.

**Flow control and congestion control:** The receiver can signal how much data it can accept (flow control). The sender adjusts its rate based on network conditions (congestion control).

These guarantees are not free. TCP adds latency (the handshake, retransmissions), state (connection tracking in both endpoints), and complexity (congestion control algorithms, out-of-order buffering).

### 5.2 The TCP Header

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
┌───────────────────────────────┬───────────────────────────────┐
│          Source Port          │       Destination Port        │
├───────────────────────────────┴───────────────────────────────┤
│                        Sequence Number                        │
├───────────────────────────────────────────────────────────────┤
│                    Acknowledgment Number                      │
├───────┬───────┬─┬─┬─┬─┬─┬─┬─┬─┬───────────────────────────┤
│  Data │Reserv │C│E│U│A│P│R│S│F│         Window Size         │
│Offset │ -ed   │W│C│R│C│S│S│Y│I│                             │
│       │       │R│E│G│K│H│T│N│N│                             │
├───────┴───────┴─┴─┴─┴─┴─┴─┴─┴─┴───────────────────────────┤
│           Checksum            │         Urgent Pointer       │
└───────────────────────────────┴───────────────────────────────┘
```

**Sequence Number:** The byte offset of the first byte in this segment's data. TCP numbers individual bytes, not segments. The initial sequence number (ISN) is chosen randomly at connection setup to reduce overlap with previous connections.

**Acknowledgment Number:** The next byte the receiver expects. An ACK of N means "I have received all bytes up to N-1; send me byte N next."

**Flags:** SYN = synchronize (connection setup), ACK = acknowledgment valid, FIN = no more data to send, RST = reset/abort connection, PSH = push data to application immediately.

**Window Size:** How much data the receiver can accept right now (receive buffer space). This is TCP's flow control mechanism — the sender never sends more than Window bytes beyond the last acknowledged byte.

### 5.3 The Three-Way Handshake in Bytes

You implemented the TCP state machine in Module 5. Now you understand what is actually being exchanged:

```
Client                              Server
─────────────────────────────────────────────────
SYN:
  seq=100, ack=0, SYN=1
  "My ISN is 100, let's start"
                          ──────────────────────►

SYN-ACK:
                          ◄──────────────────────
                          seq=500, ack=101, SYN=1, ACK=1
                          "My ISN is 500, I got your 100"

ACK:
  seq=101, ack=501, ACK=1
  "Got your 500, ready to send data"
                          ──────────────────────►

(connection ESTABLISHED)

Data:
  seq=101, ack=501, ACK=1, data="GET / HTTP/1.1\r\n..."
                          ──────────────────────►

ACK:
                          ◄──────────────────────
                          seq=501, ack=101+len(data), ACK=1
```

The initial sequence number is chosen randomly to avoid confusion with stale packets from a previous connection between the same endpoints. If Client uses ISN=0 every time, a delayed packet from a previous connection (same ports) might be mistaken for data in the current connection.

### 5.4 Reliability Through Retransmission

TCP's reliability mechanism:

1. Sender assigns each segment a sequence number and starts a retransmission timer
2. If an ACK is not received before the timer expires, the segment is retransmitted
3. The timer uses **exponential backoff**: each retransmission doubles the timeout (1s, 2s, 4s, 8s...)
4. After enough retransmissions without acknowledgment, TCP gives up and delivers an error to the application

The receiver uses **cumulative acknowledgments**: ACK N means all bytes through N-1 are received. If segment N+100 arrives before segment N (out of order), the receiver buffers the later segment and still sends ACK N — waiting for the missing bytes.

**Fast retransmit:** When the receiver sees a gap (receives segment N+100 but not N), it sends **duplicate ACKs** — repeating ACK N to signal the gap. After 3 duplicate ACKs, the sender retransmits the missing segment immediately without waiting for the timer.

### 5.5 Flow Control and the Sliding Window

The receive window advertisement in the TCP header prevents the sender from overwhelming the receiver. The sender maintains a **send window**: it may only send bytes within the range `[ACK..ACK+window]`. As the receiver's application consumes data from the receive buffer, the window grows; as data accumulates unread, the window shrinks.

A window of 0 means "stop sending." The sender enters a **persist** state, periodically probing with small segments to detect when the window reopens.

### 5.6 Congestion Control

Flow control prevents overwhelming the *receiver*. Congestion control prevents overwhelming the *network*.

TCP infers network congestion from packet loss (measured by timeouts and duplicate ACKs). The congestion control algorithm adjusts the **congestion window** (cwnd) — an additional constraint on how much data the sender can have in flight.

**Slow start:** When a connection starts, cwnd = 1 MSS (Maximum Segment Size, typically 1460 bytes). After each ACK, cwnd doubles. This exponential growth continues until a threshold (ssthresh) is reached.

**Congestion avoidance:** After reaching ssthresh, cwnd grows linearly: +1 MSS per round trip. This probes for available bandwidth gradually.

**On congestion detected (timeout):** ssthresh = cwnd/2, cwnd = 1, restart slow start.

**On 3 duplicate ACKs (fast recovery):** ssthresh = cwnd/2, cwnd = ssthresh, continue in congestion avoidance. Less aggressive than a full timeout because 3 duplicate ACKs suggest one packet was lost, not catastrophic congestion.

---

## Part 6: Observing the Stack — tcpdump and Wireshark

### 6.1 tcpdump

`tcpdump` captures packets at the network interface level and displays them. It is the single most useful tool for debugging network issues.

```bash
# Capture all packets on any interface, save to file
sudo tcpdump -i any -w capture.pcap

# Display packets in real time (verbose: -v, -vv, -vvv for more detail)
sudo tcpdump -i eth0 -v

# Filter by host
sudo tcpdump host 192.168.1.1

# Filter by port
sudo tcpdump port 6380

# Filter by protocol
sudo tcpdump icmp

# Show packet contents in hex+ASCII
sudo tcpdump -XX port 6380

# Combine filters
sudo tcpdump 'host 8.8.8.8 and udp port 53'

# Capture DNS queries and responses
sudo tcpdump -v -n port 53

# Show TCP flags
sudo tcpdump 'tcp[tcpflags] & tcp-syn != 0'  # SYN packets only
```

Reading tcpdump output:
```
14:23:45.123456 IP 192.168.1.100.52341 > 8.8.8.8.53: UDP, length 40
```
- Timestamp: `14:23:45.123456`
- Protocol: `IP`
- Source: `192.168.1.100` port `52341`
- Destination: `8.8.8.8` port `53`
- Transport: `UDP`
- Payload length: `40` bytes

### 6.2 Reading a TCP Handshake

```bash
sudo tcpdump -v 'host example.com and tcp'
```

You will see:
```
14:23:45.001 192.168.1.100.54321 > 93.184.216.34.80: Flags [S], seq 1234567890, win 64240
14:23:45.050 93.184.216.34.80 > 192.168.1.100.54321: Flags [S.], seq 987654321, ack 1234567891, win 65535
14:23:45.051 192.168.1.100.54321 > 93.184.216.34.80: Flags [.], ack 987654322, win 64240
```

- `[S]` = SYN
- `[S.]` = SYN-ACK (S = SYN, . = ACK)
- `[.]` = ACK only
- `[P.]` = PSH+ACK (data segment)
- `[F.]` = FIN+ACK
- `[R.]` = RST+ACK

The sequence number gap between SYN and first ACK is exactly 1 — SYN consumes one sequence number, even though it carries no data.

### 6.3 What to Look For

**Retransmissions:** The same sequence number appears more than once. Indicates packet loss or timeout.

**Zero window:** `win 0` in an ACK. Receiver's buffer is full — sender must stop.

**RST:** `[R]` or `[R.]`. Connection was abruptly terminated — either an error or the remote end rejected the connection.

**Duplicate ACKs:** The same ACK number appears three times in a row. Fast retransmit is about to trigger.

**Long RTTs:** The time between a data segment and its ACK. If consistently >100ms, investigate network path or server processing time.

---

## Part 7: Sockets in Depth

### 7.1 What the Socket API Abstracts

The socket API is a layer of abstraction above the network stack. When you call `socket(AF_INET, SOCK_STREAM, 0)`, the kernel:
1. Allocates a socket data structure
2. Assigns it a file descriptor
3. Sets up the TCP/IP state machine
4. Returns the fd to you

When you call `connect()`, the kernel:
1. Picks a source port (if not bound)
2. Sends a SYN packet
3. Waits for SYN-ACK
4. Sends ACK
5. Returns (the connection is now ESTABLISHED)

When you call `send()`, the kernel:
1. Copies your data into the TCP send buffer
2. Segments it into MSS-sized pieces
3. Assigns sequence numbers
4. Sends segments (up to cwnd and window size)
5. Returns the number of bytes buffered (which may be less than you asked for)

`send()` returning fewer bytes than requested is not an error — it means the send buffer is full. Your code must loop until all bytes are sent.

### 7.2 Socket Options

Important socket options for systems programming:

```zig
// Allow address reuse after server restart (prevents "Address already in use")
const one: i32 = 1;
_ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.REUSEADDR,
    @ptrCast(&one), @sizeOf(i32));

// Allow multiple sockets to bind the same port (for multi-reactor servers)
_ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.REUSEPORT,
    @ptrCast(&one), @sizeOf(i32));

// Disable Nagle's algorithm: send small packets immediately
// Important for low-latency request/response protocols like Redis
_ = linux.setsockopt(sock, linux.IPPROTO.TCP, linux.TCP.NODELAY,
    @ptrCast(&one), @sizeOf(i32));

// Set send buffer size (kernel default is ~128KB)
const buf_size: i32 = 1024 * 1024; // 1 MB
_ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.SNDBUF,
    @ptrCast(&buf_size), @sizeOf(i32));

// Set receive timeout
const timeout = linux.timeval{ .sec = 5, .usec = 0 };
_ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.RCVTIMEO,
    @ptrCast(&timeout), @sizeOf(linux.timeval));

// Keep-alive: detect dead connections
_ = linux.setsockopt(sock, linux.SOL.SOCKET, linux.SO.KEEPALIVE,
    @ptrCast(&one), @sizeOf(i32));
// After 60s idle, send probe; retry every 10s; give up after 5 failures
const keepidle: i32 = 60;
const keepintvl: i32 = 10;
const keepcnt: i32 = 5;
_ = linux.setsockopt(sock, linux.IPPROTO.TCP, linux.TCP.KEEPIDLE,
    @ptrCast(&keepidle), @sizeOf(i32));
_ = linux.setsockopt(sock, linux.IPPROTO.TCP, linux.TCP.KEEPINTVL,
    @ptrCast(&keepintvl), @sizeOf(i32));
_ = linux.setsockopt(sock, linux.IPPROTO.TCP, linux.TCP.KEEPCNT,
    @ptrCast(&keepcnt), @sizeOf(i32));
```

### 7.3 Nagle's Algorithm

Nagle's algorithm bundles small writes into larger packets to reduce the number of small TCP segments on the network. It holds a small write until either:
- The accumulated data fills an MSS, or
- All outstanding data has been acknowledged

This is good for throughput but terrible for latency in request/response protocols. A client that sends a small request (say, `PING\r\n`) may have it buffered for 200ms waiting for an MSS — making the server appear very slow.

Always set `TCP_NODELAY` on sockets used for interactive protocols. Redis, Memcached, and most database clients set it by default.

---

## Part 8: The Module Project — Network Tools

### Project Specification

Build a suite of network diagnostic tools — similar to the standard Unix utilities, but implemented from scratch in Zig using the network stack knowledge from this module.

### Tool 1: `zping` — ICMP ping with statistics

```
Usage: zping <hostname> [-c count] [-i interval_ms]

Output:
PING example.com (93.184.216.34): 56 data bytes
64 bytes from 93.184.216.34: icmp_seq=1 ttl=55 time=12.4 ms
64 bytes from 93.184.216.34: icmp_seq=2 ttl=55 time=11.8 ms
64 bytes from 93.184.216.34: icmp_seq=3 ttl=55 time=12.1 ms

--- example.com ping statistics ---
3 packets transmitted, 3 received, 0% packet loss
round-trip min/avg/max = 11.8/12.1/12.4 ms
```

Requirements:
- Resolve hostname using your DNS resolver (or `getaddrinfo` as fallback)
- Handle timeout (1 second per ping)
- Compute min/avg/max/stddev statistics
- Handle SIGINT to print statistics and exit

### Tool 2: `ztraceroute` — Path discovery

```
Usage: ztraceroute <hostname> [-m max_hops] [-q queries_per_hop]

Output:
traceroute to example.com (93.184.216.34), 30 hops max
 1  192.168.1.1       1.2 ms  1.1 ms  1.0 ms
 2  10.0.0.1          5.4 ms  5.2 ms  5.3 ms
 3  * * *  (no response)
 4  93.184.216.34     12.4 ms  11.9 ms  12.1 ms
```

Requirements:
- Send 3 probes per TTL (like standard traceroute)
- Show `*` for non-responding hops
- Stop when destination is reached or max_hops exceeded

### Tool 3: `zdns` — DNS resolver with record display

```
Usage: zdns <hostname> [record_type] [-s dns_server]

Output:
; <<>> zdns 1.0 <<>> example.com A
;; QUESTION SECTION:
;example.com    IN  A

;; ANSWER SECTION:
example.com 3600 IN  A  93.184.216.34

;; Query time: 23 ms
;; SERVER: 8.8.8.8
;; MSG SIZE rcvd: 56
```

Requirements:
- Support A (IPv4), AAAA (IPv6), CNAME, MX, TXT record types
- Parse and display each record type correctly
- Show query time and response size

### Tool 4: `znmap` — Simple port scanner

```
Usage: znmap <hostname> -p <port_range>

Output:
Scanning example.com (93.184.216.34)
PORT    STATE    SERVICE
22/tcp  closed   ssh
80/tcp  open     http
443/tcp open     https
8080/tcp closed  http-alt

Done. 2 open ports found in 1.23s
```

Requirements:
- Connect with non-blocking TCP sockets with 500ms timeout
- Identify service name from well-known port table
- Scan port ranges in parallel (up to 50 concurrent connection attempts)
- Report open/closed/filtered (timeout) for each port

### Extension Challenges

1. **Packet capture library:** Implement a minimal pcap-compatible packet capture system using `AF_PACKET` raw sockets that captures all traffic on a network interface. Write packets in the pcap file format so Wireshark can read them.

2. **ARP scanner:** Use raw ARP packets (EtherType 0x0806) to discover all hosts on the local subnet. Broadcast an ARP request for each IP in the subnet; collect replies. This requires a packet socket (`AF_PACKET, SOCK_RAW, ETH_P_ARP`).

3. **TCP state inspector:** Use `/proc/net/tcp` to parse all TCP connections on the system and display them in a format like `netstat -tn`, correlating them with process names via `/proc/PID/net/tcp`.

---

## Summary

The network stack is not magic. It is a stack of protocols, each with a defined header format, a specific purpose, and a precise behavior — all observable and implementable.

**IP** provides addressing and routing. Its header carries source/destination addresses, TTL, and the protocol number identifying what is inside. IP provides no reliability guarantees.

**ICMP** is IP's error reporting companion. `ping` uses ICMP Echo Request/Reply. `traceroute` exploits TTL expiration to discover path routers. Both require raw sockets.

**UDP** adds port numbers to IP. Simple, fast, unreliable. The right choice for DNS, NTP, streaming, and any application that implements its own reliability or tolerates loss.

**TCP** adds reliability, ordering, flow control, and congestion control. Three-way handshake establishes connections. Sequence numbers and acknowledgments ensure delivery. The sliding window limits send rate to what the receiver can accept. Congestion control limits send rate to what the network can handle.

**The socket API** abstracts all of this behind `connect()`, `send()`, and `recv()`. Understanding what is happening below that abstraction lets you use socket options correctly (TCP_NODELAY, SO_REUSEPORT, SO_KEEPALIVE), interpret tcpdump output, diagnose latency problems, and build tools that work at the protocol level.

---

## What's Next

Module 14 — Protocol Design — moves from implementing existing protocols to designing new ones. You now understand how ICMP, DNS, RESP, and TCP work at the byte level. Module 14 teaches how to design a new protocol from scratch: framing, versioning, error handling, backward compatibility, and binary vs text tradeoffs.

---

## Reference: Network Tool Quick Reference

```bash
# Packet capture
sudo tcpdump -i any -w file.pcap          # capture all to file
sudo tcpdump -r file.pcap                 # read file
sudo tcpdump -v port 6380                 # verbose, filter by port
sudo tcpdump 'tcp[tcpflags] & tcp-syn!=0' # SYN packets only

# Network inspection
ip addr show                              # interface addresses
ip route show                             # routing table
ip neigh show                             # ARP table
ss -tnp                                   # TCP connections with process
ss -unp                                   # UDP sockets
cat /proc/net/tcp                         # raw TCP connection table
cat /proc/net/udp                         # raw UDP socket table

# DNS
dig example.com A @8.8.8.8               # A record query
dig -x 93.184.216.34                     # reverse DNS
nslookup example.com                     # basic resolver

# Connectivity
ping -c 4 example.com                    # ICMP echo
traceroute example.com                   # path discovery
mtr example.com                          # combined ping+traceroute

# Socket options (common values)
SO_REUSEADDR  = allow port reuse after restart
SO_REUSEPORT  = multiple sockets on same port (multi-reactor)
TCP_NODELAY   = disable Nagle (low latency protocols)
SO_KEEPALIVE  = detect dead connections
SO_RCVTIMEO   = receive timeout
SO_SNDBUF     = send buffer size
SO_RCVBUF     = receive buffer size
```

---

*End of Module 13*
