# Module 9: File Systems and Persistence

## The Craft of Systems Programming — Teaching Material

---

> *"Memory is temporary. Storage is permanent. The difference between them is not just speed — it is the entire problem of making programs that survive power loss, crashes, and time."*

---

## Before You Begin

Every module so far has dealt with transient state: data in registers, in cache, in RAM. When the process exits, the power fails, or the machine reboots, that data is gone. This module changes that. It is about **persistence** — making data survive.

File systems are the OS mechanism for persistent storage. They sit between programs and physical storage devices, providing the abstraction of named files in a directory hierarchy. They manage the enormous gap between what applications want (named, arbitrarily-sized, durable data) and what storage devices provide (numbered, fixed-size, volatile or unreliable blocks).

The challenge file systems solve is one of the hardest in all of systems engineering: how do you store structured data reliably on a device that can fail, lose power, or return errors at any point, in a way that leaves the data consistent rather than corrupted? The answer — journaling, copy-on-write, checksums — shapes every production database, every cloud storage system, and every operating system in use today.

By the end of this module you will have implemented a minimal file system that runs on a simulated disk, survived simulated crashes, and understood exactly why production file systems are structured the way they are.

---

## Learning Objectives

By the end of this module, you will be able to:

- Describe the physical characteristics of HDDs and SSDs and how they affect file system design
- Explain the on-disk layout of a Unix-style file system: superblock, inode table, block bitmap, data blocks
- Implement an inode structure with direct, singly-indirect, and doubly-indirect block pointers
- Explain what a directory is at the file system level and trace a path resolution from root to file
- Explain the three failure scenarios in crash consistency and what each leaves on disk
- Implement journaling (write-ahead logging) and demonstrate crash recovery
- Use `mmap()` in Zig to map files into memory and understand the relationship to the page cache
- Explain what `fsync()` and `fdatasync()` actually do and when they are necessary
- Use the `stat()` system call to inspect file metadata
- Implement a simple append-only log-structured storage engine and explain its advantages

---

## Part 1: Storage Devices

### 1.1 Hard Disk Drives

A hard disk drive (HDD) stores data on spinning magnetic platters. The platter surface is organized into concentric rings called **tracks**, and each track is divided into **sectors** (the smallest addressable unit, typically 512 bytes or 4096 bytes).

Reading or writing data requires:
1. **Seek time:** Moving the read/write head to the correct track (~1-10ms)
2. **Rotational latency:** Waiting for the correct sector to rotate under the head (~0-8ms at 7200 RPM, average ~4ms)
3. **Transfer time:** Actually reading or writing the data (~0.1ms for 4KB)

The critical insight: **seek time and rotational latency dominate.** A random read of 4KB costs ~5ms total. A sequential read of 4KB costs ~0.1ms. **Random access is 50x slower than sequential access** for HDDs.

This performance characteristic shapes every aspect of traditional file system design:
- Keep related data physically close on disk (minimize seeks)
- Use large block sizes to amortize seek cost per byte
- Buffer and batch small writes to reduce write operations
- Prefer sequential allocation patterns

### 1.2 Solid-State Drives

SSDs store data in flash memory cells. No moving parts means no seek time and no rotational latency. But SSDs introduce their own constraints:

**Read characteristics:** Random reads are fast — ~100 microseconds, any location. Sequential reads are slightly faster due to internal parallelism.

**Write characteristics:** Flash can only be written in **pages** (typically 4KB-16KB) and can only be erased in **blocks** (typically 128KB-1MB, containing 32-128 pages). A write to a location that already contains data requires: read the entire block into memory, modify the desired pages, erase the entire block, write the entire block back. This **read-modify-write** cycle makes random small writes very expensive.

**Wear:** Flash cells can only be programmed and erased a finite number of times (10,000-100,000 P/E cycles for consumer NAND). Write amplification and wear leveling are significant concerns in SSD firmware design.

**Implications for file systems:** SSDs benefit from file systems that minimize write amplification — writing large, aligned, sequential blocks. Log-structured file systems, which never overwrite data in place, are particularly well-suited to SSDs.

### 1.3 The Storage Latency Hierarchy

```
Device          Read latency    Write latency   Random vs Sequential
─────────────────────────────────────────────────────────────────────
CPU Register    < 1 ns          < 1 ns          same
L1 Cache        ~4 ns           ~4 ns           same
L2 Cache        ~12 ns          ~12 ns          same
L3 Cache        ~40 ns          ~40 ns          same
DRAM            ~100 ns         ~100 ns         same
NVMe SSD        ~100 µs         ~100 µs         ~10x difference
SATA SSD        ~500 µs         ~500 µs         ~5x difference
HDD             ~5 ms           ~5 ms           ~50x difference
Network (LAN)   ~100 µs         ~100 µs         varies
```

The gap between DRAM and SSD (~1000x) is the boundary where persistence begins. Every design decision in file systems is shaped by this gap and the read/write characteristics above it.

---

## Part 2: On-Disk Layout — The Anatomy of a File System

### 2.1 The Block

File systems do not address storage at the byte level. They work in **blocks** — fixed-size units, typically 4096 bytes (4KB) on modern systems. Every allocation, read, and write is a multiple of the block size.

Why blocks?
- Hardware naturally addresses storage in sectors (512B or 4096B)
- Metadata overhead per allocation must be amortized over many bytes
- Caching and I/O scheduling work in block-sized units

A disk of size D bytes contains D / block_size blocks, numbered from 0.

### 2.2 The Overall Layout

A classic Unix-style file system (like ext2) divides disk space into:

```
Disk Layout:
┌──────────┬──────────┬──────────┬──────────┬──────────────────────┐
│ Superblock│ Inode    │ Block    │ Inode    │ Data Blocks          │
│ (block 0) │ Bitmap   │ Bitmap   │ Table    │ (blocks N..end)      │
│           │ (block 1)│ (block 2)│(blocks   │                      │
│           │          │          │3..N-1)   │                      │
└──────────┴──────────┴──────────┴──────────┴──────────────────────┘
```

**Superblock:** The first block. Contains metadata about the entire file system: total block count, total inode count, free block count, free inode count, block size, magic number (for identification), and the state of the file system (clean/dirty). The superblock is critical — without it the file system cannot be mounted. Modern file systems keep multiple superblock copies.

**Inode Bitmap:** A bitmap tracking which inode numbers are in use. Bit N is 1 if inode N is allocated, 0 if free.

**Block Bitmap:** A bitmap tracking which data blocks are in use. Bit N is 1 if block N is allocated.

**Inode Table:** An array of inode structures, one per file. The inode number is the index into this array.

**Data Blocks:** The remaining space. Contains file content, directory entries, and indirect block pointers.

### 2.3 The Inode

The **inode** (index node) is the central data structure of a Unix file system. Every file and directory has exactly one inode. The inode contains all metadata about the file — everything except its name.

```zig
/// A Unix-style inode (simplified ext2 layout)
const Inode = extern struct {
    mode: u16,          // file type + permissions (rwxrwxrwx)
    uid: u16,           // owner user ID
    gid: u16,           // owner group ID
    size: u32,          // file size in bytes
    atime: u32,         // last access time (unix timestamp)
    mtime: u32,         // last modification time
    ctime: u32,         // last status change time
    link_count: u16,    // number of hard links to this inode
    block_count: u32,   // number of 512-byte blocks allocated

    // Block pointer array: the key to locating file data
    // 12 direct pointers + 1 singly indirect + 1 doubly indirect + 1 triply indirect
    block_pointers: [15]u32,

    // Padding to reach fixed inode size
    _reserved: [12]u8,

    comptime {
        std.debug.assert(@sizeOf(Inode) == 128);
    }
};
```

The `block_pointers` array is the mechanism for locating a file's data:

- **Direct pointers (indices 0-11):** Each points directly to a data block containing file content. With 12 direct pointers and 4KB blocks, the first 48KB of any file is reached with a single pointer dereference.

- **Singly-indirect pointer (index 12):** Points to a block that contains 1024 block pointers (4096 bytes / 4 bytes per pointer). Covers an additional 4MB of file content.

- **Doubly-indirect pointer (index 13):** Points to a block of 1024 singly-indirect pointers, each pointing to 1024 data blocks. Covers 4GB additional.

- **Triply-indirect pointer (index 14):** Rarely used. Covers files up to 4TB.

```
Inode block_pointers:
[0]  → [data block: bytes 0-4095]
[1]  → [data block: bytes 4096-8191]
...
[11] → [data block: bytes 45056-49151]    ← last direct: 48KB
[12] → [indirect block]
          [0] → [data block: bytes 49152-53247]
          [1] → [data block: bytes 53248-57343]
          ...
          [1023] → [data block: 4KB more]  ← singly indirect covers 4MB+48KB
[13] → [doubly-indirect block]
          [0] → [indirect block]
                   [0..1023] → [data blocks]
          ...
          [1023] → [indirect block]         ← doubly indirect: 4GB+
[14] → triply-indirect (4TB+)
```

### 2.4 Directories

A directory is a file with a special type. Its content is a list of directory entries, each mapping a filename to an inode number.

```zig
/// A directory entry in ext2 format
const DirEntry = extern struct {
    inode_number: u32,     // 0 means entry is unused
    rec_len: u16,          // total length of this entry (for skip-forward)
    name_len: u8,          // length of name (without null terminator)
    file_type: u8,         // 1=regular, 2=directory, 7=symlink, etc.
    name: [255]u8,         // the filename (not null-terminated in this field)
};
```

Every directory contains two special entries:
- `.` (dot): points to the directory itself
- `..` (dotdot): points to the parent directory

When you call `stat("/home/user/file.txt")`, the file system must:
1. Start at the root inode (always inode 2 by convention)
2. Read root's data blocks — find entry "home" → inode N₁
3. Read inode N₁'s data blocks — find entry "user" → inode N₂
4. Read inode N₂'s data blocks — find entry "file.txt" → inode N₃
5. Read inode N₃ — return its metadata

This is **path resolution**: walking the directory tree, one component at a time, until reaching the target inode.

### 2.5 Hard Links and Symbolic Links

The inode does not store the filename. The mapping from name to inode is stored in the directory. This means multiple directory entries can point to the same inode — this is a **hard link**.

```bash
ln original.txt hardlink.txt
# Both "original.txt" and "hardlink.txt" point to the same inode
# Deleting one does not delete the data — inode.link_count decrements
# Data is deleted only when link_count reaches 0 AND no open file handles remain
```

A **symbolic link** (symlink) is different: it is a regular file whose content is a path string. Following a symlink means reading that path and resolving it.

The link count in the inode is what makes deletion safe. `unlink("original.txt")` decrements `link_count`. The inode and its data blocks are freed only when `link_count == 0` and no process has the file open.

---

> **Exercise 9.1: Path Resolution**
>
> Implement a path resolver that walks a simulated file system:
>
> ```zig
> /// Returns the inode number for the given absolute path
> /// Returns error.NotFound if any component doesn't exist
> pub fn resolve_path(fs: *FileSystem, path: []const u8) !u32 {
>     // Start at root inode (number 2)
>     // Split path on '/'
>     // For each component: read current directory's data blocks,
>     //   search for entry matching component name,
>     //   update current inode to found inode number
>     // Return final inode number
> }
> ```
>
> Test cases:
> - `/` → inode 2
> - `/etc` → whatever inode etc is
> - `/etc/hostname` → the inode for hostname
> - `/nonexistent` → error.NotFound
> - `/../etc` → inode for /etc (.. from root is still root)

---

## Part 3: Building a File System

### 3.1 The Simulated Disk

Before implementing a file system, you need a simulated disk:

```zig
const std = @import("std");

const BLOCK_SIZE: usize = 4096;
const NUM_BLOCKS: usize = 1024; // 4 MB total disk

/// A simulated disk: array of blocks with read/write operations
const Disk = struct {
    blocks: [NUM_BLOCKS][BLOCK_SIZE]u8,
    read_count: u64,
    write_count: u64,

    pub fn init() Disk {
        return std.mem.zeroes(Disk);
    }

    pub fn read_block(self: *const Disk, block_num: u32,
                      buf: *[BLOCK_SIZE]u8) void {
        std.debug.assert(block_num < NUM_BLOCKS);
        buf.* = self.blocks[block_num];
        // In a real implementation, this would issue an I/O request
    }

    pub fn write_block(self: *Disk, block_num: u32,
                       data: *const [BLOCK_SIZE]u8) void {
        std.debug.assert(block_num < NUM_BLOCKS);
        self.blocks[block_num] = data.*;
        self.write_count += 1;
    }

    /// Simulate a power failure: all writes after this point are lost.
    /// All writes before this point are preserved (disk is persistent).
    pub fn crash(self: *Disk) void {
        // In simulation: just mark a crash point
        // Writes after this are lost
        std.debug.print("*** DISK CRASH SIMULATED ***\n", .{});
        _ = self;
    }

    /// Persist to a file (simulating actual persistent storage)
    pub fn save(self: *const Disk, path: []const u8) !void {
        const file = try std.fs.cwd().createFile(path, .{});
        defer file.close();
        try file.writeAll(std.mem.asBytes(&self.blocks));
    }

    pub fn load(self: *Disk, path: []const u8) !void {
        const file = try std.fs.cwd().openFile(path, .{});
        defer file.close();
        _ = try file.readAll(std.mem.asBytes(&self.blocks));
    }
};
```

### 3.2 The Superblock

```zig
const MAGIC: u32 = 0x53465A47; // "GZFS" in little-endian
const SUPERBLOCK_BLOCK: u32 = 0;
const INODE_BITMAP_BLOCK: u32 = 1;
const BLOCK_BITMAP_BLOCK: u32 = 2;
const INODE_TABLE_START: u32 = 3;
const INODES_PER_BLOCK: usize = BLOCK_SIZE / @sizeOf(Inode);
const NUM_INODE_BLOCKS: usize = 8; // 8 * 32 = 256 inodes
const DATA_BLOCK_START: u32 = INODE_TABLE_START + NUM_INODE_BLOCKS;
const ROOT_INODE: u32 = 2; // convention: root is always inode 2

const Superblock = extern struct {
    magic: u32,
    block_size: u32,
    total_blocks: u32,
    total_inodes: u32,
    free_blocks: u32,
    free_inodes: u32,
    inode_bitmap_block: u32,
    block_bitmap_block: u32,
    inode_table_start: u32,
    data_start: u32,
    state: u32,            // 1 = clean, 0 = dirty (unmounted uncleanly)
    _padding: [4060 - 44]u8, // pad to BLOCK_SIZE

    comptime {
        std.debug.assert(@sizeOf(Superblock) == BLOCK_SIZE);
    }
};
```

### 3.3 Allocation — Finding Free Blocks and Inodes

```zig
const FileSystem = struct {
    disk: *Disk,
    superblock: Superblock,

    // In-memory caches (dirty means needs writing to disk)
    inode_bitmap: [BLOCK_SIZE]u8,
    block_bitmap: [BLOCK_SIZE]u8,

    pub fn format(disk: *Disk) !FileSystem {
        var fs: FileSystem = .{
            .disk = disk,
            .superblock = std.mem.zeroes(Superblock),
            .inode_bitmap = std.mem.zeroes([BLOCK_SIZE]u8),
            .block_bitmap = std.mem.zeroes([BLOCK_SIZE]u8),
        };

        // Initialize superblock
        fs.superblock = .{
            .magic = MAGIC,
            .block_size = BLOCK_SIZE,
            .total_blocks = NUM_BLOCKS,
            .total_inodes = NUM_INODE_BLOCKS * INODES_PER_BLOCK,
            .free_blocks = NUM_BLOCKS - DATA_BLOCK_START,
            .free_inodes = NUM_INODE_BLOCKS * INODES_PER_BLOCK - 2,
            .inode_bitmap_block = INODE_BITMAP_BLOCK,
            .block_bitmap_block = BLOCK_BITMAP_BLOCK,
            .inode_table_start = INODE_TABLE_START,
            .data_start = DATA_BLOCK_START,
            .state = 1, // clean
            ._padding = std.mem.zeroes([4060 - 44]u8),
        };

        // Mark inodes 0 and 1 as reserved, 2 as root
        set_bit(&fs.inode_bitmap, 0);
        set_bit(&fs.inode_bitmap, 1);
        set_bit(&fs.inode_bitmap, 2);

        // Mark all metadata blocks as used in block bitmap
        for (0..DATA_BLOCK_START) |i| set_bit(&fs.block_bitmap, i);

        // Create root directory inode
        var root_inode = std.mem.zeroes(Inode);
        root_inode.mode = 0o040755; // directory, rwxr-xr-x
        root_inode.link_count = 2;  // "." and parent's ".."
        // allocate a data block for the root directory
        const root_data_block = fs.alloc_block() orelse return error.NoSpace;
        root_inode.block_pointers[0] = root_data_block;
        root_inode.size = BLOCK_SIZE;
        try fs.write_inode(ROOT_INODE, &root_inode);

        // Write root directory data (. and .. both pointing to root)
        var root_dir_block = std.mem.zeroes([BLOCK_SIZE]u8);
        const entries = std.mem.bytesAsSlice(DirEntry, &root_dir_block);
        entries[0] = .{
            .inode_number = ROOT_INODE,
            .rec_len = @sizeOf(DirEntry),
            .name_len = 1,
            .file_type = 2, // directory
            .name = [_]u8{'.'} ++ [_]u8{0} ** 254,
        };
        entries[1] = .{
            .inode_number = ROOT_INODE,
            .rec_len = @sizeOf(DirEntry),
            .name_len = 2,
            .file_type = 2,
            .name = [_]u8{'.', '.'} ++ [_]u8{0} ** 253,
        };
        disk.write_block(root_data_block, &root_dir_block);

        // Flush metadata to disk
        try fs.flush_metadata();
        return fs;
    }

    fn set_bit(bitmap: *[BLOCK_SIZE]u8, index: usize) void {
        bitmap[index / 8] |= @as(u8, 1) << @intCast(index % 8);
    }

    fn clear_bit(bitmap: *[BLOCK_SIZE]u8, index: usize) void {
        bitmap[index / 8] &= ~(@as(u8, 1) << @intCast(index % 8));
    }

    fn test_bit(bitmap: *const [BLOCK_SIZE]u8, index: usize) bool {
        return (bitmap[index / 8] >> @intCast(index % 8)) & 1 == 1;
    }

    /// Find and allocate a free data block. Returns block number or null.
    pub fn alloc_block(self: *FileSystem) ?u32 {
        for (DATA_BLOCK_START..NUM_BLOCKS) |i| {
            if (!test_bit(&self.block_bitmap, i)) {
                set_bit(&self.block_bitmap, i);
                self.superblock.free_blocks -= 1;
                return @intCast(i);
            }
        }
        return null;
    }

    /// Free a data block.
    pub fn free_block(self: *FileSystem, block_num: u32) void {
        std.debug.assert(block_num >= DATA_BLOCK_START);
        std.debug.assert(test_bit(&self.block_bitmap, block_num));
        clear_bit(&self.block_bitmap, block_num);
        self.superblock.free_blocks += 1;
    }

    /// Find and allocate a free inode. Returns inode number or null.
    pub fn alloc_inode(self: *FileSystem) ?u32 {
        // Skip 0 (reserved) and 1 (bad blocks), start from 2
        for (2..self.superblock.total_inodes) |i| {
            if (!test_bit(&self.inode_bitmap, i)) {
                set_bit(&self.inode_bitmap, i);
                self.superblock.free_inodes -= 1;
                return @intCast(i);
            }
        }
        return null;
    }

    pub fn read_inode(self: *FileSystem, inum: u32, inode: *Inode) void {
        const block_num = INODE_TABLE_START + inum / INODES_PER_BLOCK;
        const offset = inum % INODES_PER_BLOCK;
        var block: [BLOCK_SIZE]u8 = undefined;
        self.disk.read_block(@intCast(block_num), &block);
        const inodes = std.mem.bytesAsSlice(Inode, &block);
        inode.* = inodes[offset];
    }

    pub fn write_inode(self: *FileSystem, inum: u32, inode: *const Inode) !void {
        const block_num = INODE_TABLE_START + inum / INODES_PER_BLOCK;
        const offset = inum % INODES_PER_BLOCK;
        var block: [BLOCK_SIZE]u8 = undefined;
        self.disk.read_block(@intCast(block_num), &block);
        const inodes = std.mem.bytesAsSlice(Inode, &block);
        inodes[offset] = inode.*;
        self.disk.write_block(@intCast(block_num), &block);
    }

    fn flush_metadata(self: *FileSystem) !void {
        // Write superblock
        const sb_bytes = std.mem.asBytes(&self.superblock);
        var sb_block: [BLOCK_SIZE]u8 = undefined;
        @memcpy(&sb_block, sb_bytes);
        self.disk.write_block(SUPERBLOCK_BLOCK, &sb_block);

        // Write bitmaps
        self.disk.write_block(INODE_BITMAP_BLOCK, &self.inode_bitmap);
        self.disk.write_block(BLOCK_BITMAP_BLOCK, &self.block_bitmap);
    }
};
```

---

## Part 4: Crash Consistency

### 4.1 The Problem

A single file-system operation that seems atomic at the application level may require multiple disk writes at the storage level. Appending data to a file requires:

1. Write the new data block (the actual content)
2. Update the inode (new size, new block pointer)
3. Update the block bitmap (mark the new block as used)

These three writes are independent. The OS can issue them in any order, and the disk can complete them in any order. If a crash occurs between any two of them, the file system is in an **inconsistent state**.

The three possible single-write failures when appending:

**Case 1: Data block written, inode and bitmap not updated.**
The block on disk contains valid data, but neither the inode nor the bitmap knows about it. From the file system's perspective, the data never happened. The block is effectively leaked — not free, not owned. `fsck` would find this as a block in use but not referenced by any inode.

**Case 2: Inode updated, data block not written, bitmap not updated.**
The inode says the file has a new block at position N, but block N either contains garbage or belongs to no one. Reading the file returns garbage. The bitmap still says block N is free — this is a serious inconsistency; two things might now believe they own the same block.

**Case 3: Inode and bitmap updated, data block not written.**
The file system metadata is consistent (inode and bitmap agree a block is allocated), but the block contains garbage. The file appears to have grown but its new content is undefined.

**The worst cases are 2 and 3** — they leave the metadata in a state that is internally inconsistent or points to garbage data.

### 4.2 The Traditional Solution: fsck

`fsck` (file system check) is a repair tool that scans the entire file system after a crash, finding and fixing inconsistencies. It:
1. Checks the superblock for validity
2. Scans all inodes, rebuilding the block bitmap from scratch
3. Compares the rebuilt bitmap to the on-disk bitmap
4. Checks directory entries for validity
5. Rescues orphaned inodes (link count > 0 but not referenced by any directory)

`fsck` is correct but catastrophically slow for large disks. Scanning a 10TB disk to fix a single file system operation takes hours. As disks grew through the 1990s and 2000s, `fsck` became unacceptable for production systems.

### 4.3 Journaling — Write-Ahead Logging

The solution, borrowed from databases, is **journaling** (write-ahead logging): before performing any update to the file system, write a description of the update to a dedicated **journal** region on disk. If a crash occurs, replay the journal on recovery.

The journal is a circular buffer of **transactions**. Each transaction consists of:
- **Transaction Begin (TxB):** Transaction ID and description
- **Journal Blocks:** The actual data and metadata to be written
- **Transaction End (TxE):** Transaction ID, marks transaction as committed

A journal transaction for appending data:

```
Journal region:
┌──────────┬──────────────┬──────────────┬──────────────┬──────────┐
│ TxB(tid) │ Inode[v2]    │ Bitmap[v2]   │ Data Block   │ TxE(tid) │
│          │ (new version)│ (new version)│              │          │
└──────────┴──────────────┴──────────────┴──────────────┴──────────┘
```

The protocol has three phases:

**Phase 1 — Journal Write:** Write TxB and all journal blocks to the journal. Issue all these writes in parallel. Do NOT write TxE yet.

**Phase 2 — Journal Commit:** Write TxE to the journal. Wait for this to complete (issue a write barrier/flush). The transaction is now **committed** — if we crash after this point, we can recover by replaying the journal.

**Phase 3 — Checkpoint:** Write the actual data and metadata to their final on-disk locations (outside the journal). This is the "real" write. After checkpointing, the journal entry can be freed.

**Recovery after crash:**
- If crash before phase 2: TxE was never written. Journal entry is incomplete. Skip it — the original file system state is intact.
- If crash after phase 2 but before phase 3: TxE exists. Replay the journal transaction — reapply all writes from the journal to their final locations. This is safe because journal writes are idempotent.
- If crash after phase 3: Normal operation. No recovery needed.

```zig
const std = @import("std");

const JOURNAL_START_BLOCK: u32 = DATA_BLOCK_START;
const JOURNAL_SIZE_BLOCKS: usize = 64;
const ACTUAL_DATA_START: u32 = JOURNAL_START_BLOCK + JOURNAL_SIZE_BLOCKS;

const TxType = enum(u32) {
    begin = 0x4A4F5552, // "JOUR"
    end   = 0x434F4D54, // "COMT"
};

const JournalHeader = extern struct {
    tx_type: TxType,
    transaction_id: u32,
    num_blocks: u32,
    // For TxB: array of block numbers being journaled
    block_destinations: [512]u32, // up to 512 blocks per transaction
    _pad: [BLOCK_SIZE - 3 * 4 - 512 * 4]u8,

    comptime {
        std.debug.assert(@sizeOf(JournalHeader) == BLOCK_SIZE);
    }
};

const Journal = struct {
    disk: *Disk,
    head: u32,         // next block to write
    next_tid: u32,     // next transaction ID

    pub fn init(disk: *Disk) Journal {
        return .{ .disk = disk, .head = JOURNAL_START_BLOCK, .next_tid = 1 };
    }

    /// Write a transaction to the journal and commit it.
    /// blocks_data: the actual block contents to journal
    /// destinations: where each block will eventually go on disk
    pub fn write_transaction(
        self: *Journal,
        blocks_data: []const [BLOCK_SIZE]u8,
        destinations: []const u32,
    ) !void {
        std.debug.assert(blocks_data.len == destinations.len);
        std.debug.assert(blocks_data.len <= 512);

        const tid = self.next_tid;
        self.next_tid += 1;

        // Phase 1: Write TxB and all journal blocks
        // TxB
        var txb = std.mem.zeroes(JournalHeader);
        txb.tx_type = .begin;
        txb.transaction_id = tid;
        txb.num_blocks = @intCast(blocks_data.len);
        for (destinations, 0..) |dest, i| txb.block_destinations[i] = dest;

        self.disk.write_block(self.head, std.mem.asBytes(&txb)[0..BLOCK_SIZE]);
        self.head = self.journal_next(self.head);

        // Journal blocks (the actual data)
        for (blocks_data) |*block_data| {
            self.disk.write_block(self.head, block_data);
            self.head = self.journal_next(self.head);
        }

        // Issue write barrier here in real implementation
        // (ensure all above writes reach disk before TxE)

        // Phase 2: Write TxE (commit)
        var txe = std.mem.zeroes(JournalHeader);
        txe.tx_type = .end;
        txe.transaction_id = tid;
        self.disk.write_block(self.head, std.mem.asBytes(&txe)[0..BLOCK_SIZE]);
        self.head = self.journal_next(self.head);

        // Issue write barrier (ensure TxE is durable before continuing)
        // Phase 3: Checkpoint — write to actual destinations
        for (blocks_data, destinations) |*block_data, dest| {
            self.disk.write_block(dest, block_data);
        }
    }

    fn journal_next(self: *const Journal, block: u32) u32 {
        const next = block + 1;
        if (next >= JOURNAL_START_BLOCK + JOURNAL_SIZE_BLOCKS) {
            return JOURNAL_START_BLOCK; // wrap around
        }
        return next;
    }

    /// Replay committed but not yet checkpointed transactions.
    /// Called on mount after a crash.
    pub fn recover(self: *Journal) void {
        var pos = JOURNAL_START_BLOCK;
        std.debug.print("Starting journal recovery...\n", .{});

        while (pos < JOURNAL_START_BLOCK + JOURNAL_SIZE_BLOCKS) {
            var block: [BLOCK_SIZE]u8 = undefined;
            self.disk.read_block(pos, &block);
            const header: *const JournalHeader = @ptrCast(@alignCast(&block));

            if (header.tx_type != .begin) {
                pos += 1;
                continue;
            }

            const tid = header.transaction_id;
            const num_blocks = header.num_blocks;

            // Check if transaction is committed (TxE exists)
            const txe_pos = pos + 1 + num_blocks;
            if (txe_pos >= JOURNAL_START_BLOCK + JOURNAL_SIZE_BLOCKS) {
                pos += 1;
                continue;
            }

            var txe_block: [BLOCK_SIZE]u8 = undefined;
            self.disk.read_block(txe_pos, &txe_block);
            const txe: *const JournalHeader = @ptrCast(@alignCast(&txe_block));

            if (txe.tx_type == .end and txe.transaction_id == tid) {
                // Committed transaction: replay it
                std.debug.print("Replaying transaction {d}\n", .{tid});
                for (0..num_blocks) |i| {
                    var data_block: [BLOCK_SIZE]u8 = undefined;
                    self.disk.read_block(pos + 1 + @as(u32, @intCast(i)),
                        &data_block);
                    self.disk.write_block(header.block_destinations[i],
                        &data_block);
                }
            }

            pos += 2 + num_blocks; // skip TxB + data blocks + TxE
        }

        std.debug.print("Journal recovery complete.\n", .{});
    }
};
```

### 4.4 Metadata vs Data Journaling

**Data journaling** (write everything to the journal): Both file data and metadata are journaled. Every write goes to the journal first, then to its final location. Safe but doubles write traffic for data.

**Metadata journaling** (write only metadata to the journal): Only inode and bitmap changes are journaled; data blocks are written directly. Recovery can only guarantee metadata consistency — data may be garbage, but the file system itself is structurally valid. This is what Linux ext3/ext4 uses by default because it halves write traffic. The trade-off: a crash after the data block is written but before the metadata is checkpointed can result in a "new" file that contains old data.

**Ordered metadata journaling**: A middle ground. Data is written to its final location *before* the metadata is journaled. If a crash occurs after data is written but before metadata is committed, the metadata is simply not applied — the file appears not to have grown. Old data is never exposed to new metadata. This is the ext3 default.

---

> **Exercise 9.2: Crash Recovery**
>
> Using the journal implementation above, simulate the following crash scenarios and verify recovery:
>
> 1. Crash after TxB and journal blocks but before TxE. Mount and verify: no incomplete transaction replayed, file system is in original state.
>
> 2. Crash after TxE but before checkpoint. Mount and verify: transaction is replayed, file system is in post-operation state.
>
> 3. Crash in the middle of checkpointing. Mount and verify: idempotent replay brings file system to consistent state.
>
> For each case, print the state of the file system before the crash, simulate the crash (`disk.crash()`), then mount and print the recovered state.

---

## Part 5: The POSIX File API

### 5.1 File Descriptors and System Calls

From the application perspective, files are accessed through file descriptors and a set of system calls. You saw these in Module 3; here they get full treatment.

```zig
const std = @import("std");
const linux = std.os.linux;

pub fn demonstrate_file_api() !void {
    // Create a file
    const fd = linux.open("test.bin",
        linux.O.RDWR | linux.O.CREAT | linux.O.TRUNC,
        0o644);
    if (@as(isize, @bitCast(fd)) < 0) return error.OpenFailed;
    defer _ = linux.close(fd);

    // Write data
    const data = "Hello, persistent world!\n";
    const written = linux.write(fd, data.ptr, data.len);
    std.debug.print("wrote {d} bytes\n", .{written});

    // Seek to beginning
    _ = linux.lseek(fd, 0, linux.SEEK.SET);

    // Read it back
    var buf: [64]u8 = undefined;
    const read_bytes = linux.read(fd, &buf, buf.len);
    std.debug.print("read: {s}\n", .{buf[0..read_bytes]});

    // Inspect metadata with fstat
    var st: linux.Stat = undefined;
    _ = linux.fstat(fd, &st);
    std.debug.print("size: {d}, inode: {d}, links: {d}\n",
        .{ st.size, st.ino, st.nlink });
}
```

### 5.2 The Page Cache — The OS Buffer Layer

When a program reads from a file, the OS does not necessarily go to disk. It first checks the **page cache** — a region of physical memory where recently-accessed file pages are kept. If the page is in cache (a cache hit), the read returns immediately. If not (a miss), the OS fetches the page from disk, stores it in the page cache, and returns it.

Writes also go to the page cache first. The OS marks the written pages as **dirty** and writes them to disk lazily — in the background, when the system is idle, or when memory pressure forces eviction.

This has a critical implication: **after `write()` returns, your data may not be on disk.** It is in the page cache. If the system crashes before the dirty page is flushed to disk, the data is lost.

```zig
// After this write, data is in the page cache but may NOT be on disk
_ = linux.write(fd, data.ptr, data.len);

// fsync() flushes all dirty pages for this file to disk
// Blocks until the hardware confirms the write is durable
_ = linux.fsync(fd);

// fdatasync() flushes data but not necessarily metadata
// Faster than fsync for cases where metadata timing doesn't matter
_ = linux.fdatasync(fd);
```

The difference matters for correctness. A database that calls `write()` but not `fsync()` before acknowledging a committed transaction can lose committed data on crash. A properly-written database calls `fsync()` after every transaction commit.

The cost: `fsync()` is expensive — it issues a write barrier that forces the storage device to drain its write buffer. On an HDD, this can take milliseconds. On an SSD, still tens to hundreds of microseconds.

### 5.3 Measuring the Page Cache Effect

```zig
pub fn benchmark_page_cache() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const FILE_SIZE = 64 * 1024 * 1024; // 64 MB
    const buf = try allocator.alloc(u8, FILE_SIZE);
    defer allocator.free(buf);
    @memset(buf, 0xAB);

    // Write a file
    const f = try std.fs.cwd().createFile("cache_test.bin", .{});
    defer f.close();
    try f.writeAll(buf);
    // Note: NOT calling fsync here — data is in page cache

    var timer = try std.time.Timer.start();

    // First read: may hit page cache (data was just written)
    timer.reset();
    try f.seekTo(0);
    _ = try f.readAll(buf);
    const cached_ns = timer.read();

    // Drop page cache (requires root):
    // echo 3 > /proc/sys/vm/drop_caches
    // Without that, subsequent reads are cached

    // Second read: definitely hits page cache
    timer.reset();
    try f.seekTo(0);
    _ = try f.readAll(buf);
    const second_ns = timer.read();

    const mb_per_sec_1 = @as(f64, FILE_SIZE) /
                         (@as(f64, @floatFromInt(cached_ns)) / 1e9) / 1e6;
    const mb_per_sec_2 = @as(f64, FILE_SIZE) /
                         (@as(f64, @floatFromInt(second_ns)) / 1e9) / 1e6;

    std.debug.print("First read:  {d:.0} MB/s\n", .{mb_per_sec_1});
    std.debug.print("Second read: {d:.0} MB/s\n", .{mb_per_sec_2});
    // Both should be fast (>1000 MB/s) because page cache holds the data
    // A cold read from SSD would be ~500 MB/s; from HDD ~100 MB/s

    try std.fs.cwd().deleteFile("cache_test.bin");
}
```

---

## Part 6: Memory-Mapped Files

### 6.1 What mmap Does

`mmap()` maps a file (or portion of a file) directly into the process's virtual address space. After mapping, you read and write the file using regular memory operations — loads and stores — instead of `read()` and `write()` system calls.

```zig
const linux = std.os.linux;

pub fn mmap_example() !void {
    // Open a file
    const fd = linux.open("data.bin", linux.O.RDWR, 0);
    defer _ = linux.close(fd);

    // Get file size
    var st: linux.Stat = undefined;
    _ = linux.fstat(fd, &st);
    const file_size: usize = @intCast(st.size);

    // Map the entire file into memory
    const addr = linux.mmap(
        null,                           // let OS choose address
        file_size,                      // map entire file
        linux.PROT.READ | linux.PROT.WRITE, // readable and writable
        linux.MAP{ .TYPE = .SHARED },   // SHARED: writes go to file
        fd,                             // file descriptor
        0                               // offset in file
    );

    if (addr == linux.MAP_FAILED) return error.MmapFailed;
    defer _ = linux.munmap(addr, file_size);

    // Now access file as if it were memory
    const data: []u8 = @as([*]u8, @ptrCast(addr))[0..file_size];

    // Read from file (no read() call needed)
    std.debug.print("first byte: {d}\n", .{data[0]});

    // Write to file (no write() call needed)
    data[0] = 0xFF;
    // Change is in page cache; will eventually reach disk
    // Or call msync() to force immediate write
    _ = linux.msync(addr, file_size, linux.MS.SYNC);
}
```

### 6.2 How mmap Works Internally

When you call `mmap()`:
1. The OS creates a virtual memory mapping in the process's address space — no physical memory is allocated yet
2. When you access an address in the mapping, the MMU generates a page fault
3. The OS handles the fault by locating the corresponding file page in the page cache (loading from disk if needed) and mapping it to physical memory
4. Subsequent accesses to the same page are fast — no kernel involvement

The relationship between `mmap` and the page cache is important: both `read()`/`write()` and `mmap` use the *same* page cache. If you `mmap` a file and then `read()` from it with another fd, they see the same cached data.

### 6.3 MAP_PRIVATE vs MAP_SHARED

**MAP_SHARED:** Writes to the mapped region are visible to other processes mapping the same file and will eventually propagate to the file on disk. This is how shared memory between processes is typically implemented.

**MAP_PRIVATE (copy-on-write):** Writes create a private copy of the modified page. Other processes see the original. The file is not modified. Used for loading program text (the OS maps the executable's code with MAP_PRIVATE; the code is shared between processes running the same program, but each gets a private copy if they modify it).

```zig
// Shared mapping: write goes to file and other processes see it
const shared = linux.mmap(null, size,
    linux.PROT.READ | linux.PROT.WRITE,
    linux.MAP{ .TYPE = .SHARED }, fd, 0);

// Private mapping: write creates a private copy
const private = linux.mmap(null, size,
    linux.PROT.READ | linux.PROT.WRITE,
    linux.MAP{ .TYPE = .PRIVATE }, fd, 0);
```

### 6.4 When to Use mmap

mmap is the right choice when:
- Processing a large file sequentially (let the OS prefetch pages)
- Implementing an in-process database or cache that needs to persist to disk
- Sharing data between processes without copying
- Accessing a specific region of a large file without reading the whole thing

mmap is NOT ideal when:
- Making many small random accesses to a large file (page faults add up)
- The file is modified frequently (frequent `msync` calls negate the benefit)
- Running on a system with many cores hitting the same large mapping (Linux's page fault handling has contention at high core counts)
- The file is very small (<4KB — entire mapping is one page, overhead is not amortized)

---

## Part 7: Log-Structured Storage

### 7.1 The Log-Structured Approach

Traditional file systems try to place data at the "right" location on disk, updating structures in place. This creates the crash consistency problem: partial updates leave the disk inconsistent.

**Log-structured** storage takes a different approach: never update in place. Every write is an append to a sequential log. The log is the truth. Old versions of data remain on disk until the space is reclaimed by a compaction (garbage collection) pass.

This has significant advantages:
- All writes are sequential — optimal for both HDDs and SSDs
- Crash recovery is trivial — scan the log, apply committed operations
- Writes are always atomic from the log's perspective
- Historical versions are available (useful for snapshots)

### 7.2 A Simple Append-Only Log Engine

```zig
const std = @import("std");

/// A simple append-only log-structured storage engine.
/// Each record: [key_len: u16] [value_len: u32] [key] [value]
/// A value_len of 0xFFFFFFFF indicates a tombstone (deletion).
const LogEngine = struct {
    file: std.fs.File,
    index: std.StringHashMap(u64), // key -> file offset of latest record
    allocator: std.mem.Allocator,
    write_pos: u64,

    const TOMBSTONE: u32 = 0xFFFFFFFF;

    const RecordHeader = extern struct {
        key_len: u16,
        value_len: u32,
    };

    pub fn init(allocator: std.mem.Allocator, path: []const u8) !LogEngine {
        const file = try std.fs.cwd().createFile(path, .{
            .read = true,
            .truncate = false, // don't truncate existing log
        });

        var engine = LogEngine{
            .file = file,
            .index = std.StringHashMap(u64).init(allocator),
            .allocator = allocator,
            .write_pos = 0,
        };

        // Rebuild index from existing log
        try engine.rebuild_index();

        return engine;
    }

    pub fn deinit(self: *LogEngine) void {
        // Free all keys in index (they were allocated during rebuild)
        var it = self.index.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
        }
        self.index.deinit();
        self.file.close();
    }

    /// Write a key-value pair to the log.
    pub fn put(self: *LogEngine, key: []const u8, value: []const u8) !void {
        const offset = try self.file.getEndPos();

        const header = RecordHeader{
            .key_len = @intCast(key.len),
            .value_len = @intCast(value.len),
        };

        try self.file.seekFromEnd(0);
        try self.file.writeAll(std.mem.asBytes(&header));
        try self.file.writeAll(key);
        try self.file.writeAll(value);

        // Update in-memory index
        const owned_key = try self.allocator.dupe(u8, key);
        const result = try self.index.getOrPut(owned_key);
        if (result.found_existing) {
            self.allocator.free(owned_key); // key already in map
        }
        result.value_ptr.* = offset;

        self.write_pos = try self.file.getEndPos();
    }

    /// Read the latest value for a key. Returns null if not found/deleted.
    pub fn get(self: *LogEngine, key: []const u8,
               buf: []u8) !?[]const u8 {
        const offset = self.index.get(key) orelse return null;

        try self.file.seekTo(offset);

        var header: RecordHeader = undefined;
        _ = try self.file.read(std.mem.asBytes(&header));

        if (header.value_len == TOMBSTONE) return null; // deleted

        // Skip the key
        try self.file.seekBy(header.key_len);

        // Read the value
        const value_len = header.value_len;
        if (value_len > buf.len) return error.BufferTooSmall;
        _ = try self.file.read(buf[0..value_len]);
        return buf[0..value_len];
    }

    /// Delete a key by writing a tombstone record.
    pub fn delete(self: *LogEngine, key: []const u8) !void {
        if (!self.index.contains(key)) return;

        const header = RecordHeader{
            .key_len = @intCast(key.len),
            .value_len = TOMBSTONE,
        };

        try self.file.seekFromEnd(0);
        try self.file.writeAll(std.mem.asBytes(&header));
        try self.file.writeAll(key);
        // No value bytes for tombstone

        _ = self.index.remove(key);
    }

    /// Rebuild the in-memory index by scanning the entire log.
    /// Called on startup to recover from a previous run.
    fn rebuild_index(self: *LogEngine) !void {
        try self.file.seekTo(0);
        var offset: u64 = 0;

        while (true) {
            var header: RecordHeader = undefined;
            const bytes_read = try self.file.read(std.mem.asBytes(&header));
            if (bytes_read < @sizeOf(RecordHeader)) break; // EOF

            const key = try self.allocator.alloc(u8, header.key_len);
            defer self.allocator.free(key);
            _ = try self.file.read(key);

            if (header.value_len == TOMBSTONE) {
                // Tombstone: remove from index
                if (self.index.fetchRemove(key)) |kv| {
                    self.allocator.free(kv.key);
                }
            } else {
                // Live record: update index to point to this offset
                const owned_key = try self.allocator.dupe(u8, key);
                const result = try self.index.getOrPut(owned_key);
                if (result.found_existing) {
                    self.allocator.free(owned_key);
                }
                result.value_ptr.* = offset;

                // Skip value bytes
                try self.file.seekBy(header.value_len);
            }

            offset = try self.file.getPos();
        }

        self.write_pos = offset;
    }

    /// Compaction: rewrite the log keeping only the latest version of each key.
    /// Reduces space by removing overwritten and deleted records.
    pub fn compact(self: *LogEngine, new_path: []const u8) !void {
        const new_file = try std.fs.cwd().createFile(new_path, .{});
        defer new_file.close();

        var it = self.index.iterator();
        var buf: [65536]u8 = undefined;
        while (it.next()) |entry| {
            const key = entry.key_ptr.*;
            const value = (try self.get(key, &buf)) orelse continue;
            // Write only the live record
            const header = RecordHeader{
                .key_len = @intCast(key.len),
                .value_len = @intCast(value.len),
            };
            try new_file.writeAll(std.mem.asBytes(&header));
            try new_file.writeAll(key);
            try new_file.writeAll(value);
        }

        std.debug.print("Compaction complete: new log at {s}\n", .{new_path});
    }
};
```

---

## Part 8: The Module Project — A Persistent Key-Value Store

### Project Specification

Build a production-quality persistent key-value store by combining the file system concepts from this module: an append-only log for durability, an in-memory index for fast lookups, journaling for crash safety, and `fsync` for durability guarantees.

This is exactly the architecture of real databases: LevelDB, RocksDB, Bitcask, and countless others are built on these same primitives.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   PersistentKvStore                     │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ In-Memory Index: HashMap<key, FileOffset>          │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                          │ lookup                       │
│                          ▼                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Append-Only Data Log (data.log)                   │  │
│  │ [header][key][value][header][key][value]...        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Write-Ahead Journal (journal.log)                 │  │
│  │ Ensures atomicity of multi-key transactions       │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Core Operations

```zig
pub const PersistentKvStore = struct {
    log: LogEngine,
    allocator: std.mem.Allocator,
    dir_path: []const u8,

    pub fn open(allocator: std.mem.Allocator, dir: []const u8) !PersistentKvStore {
        // Create directory if it doesn't exist
        std.fs.cwd().makeDir(dir) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return err,
        };

        const log_path = try std.fs.path.join(allocator, &[_][]const u8{dir, "data.log"});
        defer allocator.free(log_path);

        return .{
            .log = try LogEngine.init(allocator, log_path),
            .allocator = allocator,
            .dir_path = dir,
        };
    }

    pub fn close(self: *PersistentKvStore) void {
        self.log.deinit();
    }

    pub fn put(self: *PersistentKvStore, key: []const u8, value: []const u8) !void {
        try self.log.put(key, value);
        // fsync to guarantee durability
        try self.log.file.sync();
    }

    pub fn get(self: *PersistentKvStore,
               key: []const u8, buf: []u8) !?[]const u8 {
        return self.log.get(key, buf);
    }

    pub fn delete(self: *PersistentKvStore, key: []const u8) !void {
        try self.log.delete(key);
        try self.log.file.sync();
    }
};
```

### The Benchmark

The benchmark measures:
1. Write throughput with and without `fsync`
2. Read throughput for warm (indexed) and cold (scan) reads
3. Recovery time after a simulated crash
4. Space efficiency before and after compaction

```zig
pub fn benchmark_kv_store() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var store = try PersistentKvStore.open(allocator, "benchmark_kv");
    defer store.close();

    const NUM_KEYS = 100_000;
    var key_buf: [32]u8 = undefined;
    var val_buf: [100]u8 = undefined;
    @memset(&val_buf, 0xAB);

    var timer = try std.time.Timer.start();

    // Write benchmark
    for (0..NUM_KEYS) |i| {
        const key = try std.fmt.bufPrint(&key_buf, "key:{d:0>8}", .{i});
        try store.put(key, &val_buf);
    }

    const write_ns = timer.read();
    const writes_per_sec = @as(f64, NUM_KEYS) /
                           (@as(f64, @floatFromInt(write_ns)) / 1e9);
    std.debug.print("Writes: {d:.0} ops/sec\n", .{writes_per_sec});

    // Read benchmark (all keys are indexed)
    timer.reset();
    var read_buf: [256]u8 = undefined;
    for (0..NUM_KEYS) |i| {
        const key = try std.fmt.bufPrint(&key_buf, "key:{d:0>8}", .{i});
        _ = try store.get(key, &read_buf);
    }

    const read_ns = timer.read();
    const reads_per_sec = @as(f64, NUM_KEYS) /
                          (@as(f64, @floatFromInt(read_ns)) / 1e9);
    std.debug.print("Reads:  {d:.0} ops/sec\n", .{reads_per_sec});
}
```

### Extension Challenges

1. **Bloom filter:** Add a Bloom filter to the index — a space-efficient probabilistic data structure that quickly answers "is this key definitely not in the store?" Measure how much it reduces disk seeks for non-existent key lookups.

2. **Crash injection testing:** Write a test harness that randomly crashes the store at different points (between writes, after different numbers of `put` calls) and verifies that after recovery, the store is always in a consistent state — no corrupted records, no partial writes.

3. **Sorted String Tables (SSTables):** Extend the store to periodically flush the in-memory index plus all current key-value pairs to an immutable, sorted file on disk. Multiple SSTables are merged periodically (like LevelDB). This is the foundation of all LSM-tree databases.

---

## Summary

File systems are the bridge between programs and persistent storage. They solve an enormously difficult problem — making structured data survive power loss, crashes, and partial writes — on hardware that provides only numbered, fixed-size, unreliable blocks.

**Storage devices** have dramatically different performance characteristics. HDDs are slow for random access (5ms), fast for sequential (100+ MB/s). SSDs are fast everywhere but have write amplification constraints. Every file system design reflects the performance model of its target hardware.

**On-disk layout** consists of a superblock (file system metadata), inode bitmap, block bitmap, inode table, and data blocks. The inode is the central data structure: it contains all file metadata and a pointer array that maps file offsets to disk blocks through direct, singly-indirect, doubly-indirect, and triply-indirect pointers.

**Directories** are files whose content is a list of (name, inode number) pairs. Path resolution walks the directory tree from the root inode, following each path component to its inode, until reaching the target.

**Crash consistency** is the hardest problem in file system design. Any multi-block operation can leave the disk in an inconsistent state if interrupted by a crash. `fsck` solves this by scanning the entire disk — too slow for large disks. **Journaling** solves it by writing transactions to a log before applying them — recovery replays committed transactions in seconds.

**The page cache** is the OS buffer layer between programs and disk. Writes go to the page cache first and are flushed lazily. `fsync()` forces dirty pages to disk. Programs that need durability guarantees must call `fsync()` after writes.

**Memory-mapped files** expose file data directly as memory, eliminating system call overhead for sequential access and enabling zero-copy I/O. MAP_SHARED writes propagate to the file; MAP_PRIVATE creates a private copy-on-write mapping.

**Log-structured storage** never overwrites data, instead appending every write to a sequential log. This simplifies crash recovery, optimizes write performance, and is the foundation of modern key-value stores and databases.

---

## What's Next

Module 10 — Performance Evaluation and Measurement — is the capstone of the performance track. You have measured individual operations throughout the curriculum. Module 10 teaches you to profile complete systems: how to find the actual bottleneck in a production program, how to use `perf`, `flamegraphs`, and `valgrind` to attribute time accurately, and how to present performance results rigorously.

---

## Reference: File System System Calls

```zig
// Open / create a file
const fd = linux.open(path, flags, mode);
// Flags: O.RDONLY, O.WRONLY, O.RDWR, O.CREAT, O.TRUNC, O.APPEND, O.SYNC

// Read / write
const n = linux.read(fd, buf.ptr, buf.len);
const n = linux.write(fd, data.ptr, data.len);

// Seek
const pos = linux.lseek(fd, offset, whence);
// whence: SEEK.SET (absolute), SEEK.CUR (relative), SEEK.END (from end)

// Metadata
linux.fstat(fd, &stat);   // by file descriptor
linux.stat(path, &stat);  // by path
linux.lstat(path, &stat); // by path, don't follow symlinks
// stat fields: .size, .ino (inode), .nlink, .mode, .uid, .gid,
//              .atime, .mtime, .ctime, .blksize, .blocks

// Durability
linux.fsync(fd);           // flush data + metadata to disk
linux.fdatasync(fd);       // flush data only (faster)

// Memory mapping
const addr = linux.mmap(addr, length, prot, flags, fd, offset);
linux.munmap(addr, length);
linux.msync(addr, length, flags); // flush mmap'd region to disk
// prot: PROT.READ, PROT.WRITE, PROT.EXEC
// flags: MAP{.TYPE = .SHARED} or MAP{.TYPE = .PRIVATE}

// Directory operations
linux.mkdir(path, mode);
linux.rmdir(path);
linux.unlink(path);        // remove directory entry (decrements link count)
linux.rename(old, new);    // atomic rename

// Links
linux.link(old, new);      // hard link: new points to same inode
linux.symlink(target, path); // symbolic link
linux.readlink(path, buf, buf.len); // read symlink target
```

## Reference: Page Cache Behavior

```
write() → page cache (dirty page) → background flush → disk
                                   ↑
                                 fsync() forces this

Page cache benefits:
  - Read: if page is cached, no disk I/O
  - Write: returns immediately, disk write deferred
  - Shared: multiple processes mapping same file share pages

When to call fsync():
  ✓ Database transaction commits
  ✓ Configuration file writes
  ✓ Any write where durability matters before returning to caller
  ✗ Logging to disk (losing last few log lines is usually acceptable)
  ✗ Temporary files
  ✗ High-throughput writes where latency matters more than durability

mmap vs read/write:
  mmap:  better for sequential large file access, enables zero-copy
  read:  better for streaming, simpler error handling, more scalable
  mmap caveats: page faults add latency, SIGBUS on I/O errors,
                limited core scalability for random access patterns
```

---

*End of Module 9*
