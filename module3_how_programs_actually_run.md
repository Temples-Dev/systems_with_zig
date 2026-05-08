# Module 3: How Programs Actually Run

## The Craft of Systems Programming — Teaching Material

---

> *"A program is just a file until it runs. The moment between those two states — between bytes on disk and instructions in flight — is where the operating system lives."*

---

## Before You Begin

Modules 1 and 2 gave you the two foundations: how data is represented in memory, and how the processor executes instructions. This module bridges them into the runtime reality of a program.

You have written Zig code. You have compiled it and run it. You have looked at the assembly it produces. But there is an enormous amount happening between those two states — between source code and a running process — that you have taken on faith. The compiler turns source into a binary. The binary runs. What exactly happens in between?

This module makes that visible. You will inspect the binary format that the Zig compiler produces. You will watch the operating system load and execute a program in real time using `strace`. You will understand what a process is and what resources it has. You will make system calls directly — not through a wrapper, but through the raw hardware interface — and feel exactly where the boundary between user code and the operating system lies.

By the end of this module, you will no longer be a programmer who *uses* the operating system without knowing what it is. You will be a programmer who understands the machine from hardware instructions all the way up to running processes.

---

## Learning Objectives

By the end of this module, you will be able to:

- Describe the structure of an ELF binary: the ELF header, program headers, section headers, and their roles
- Use `readelf` and `objdump` to inspect a compiled Zig binary at the byte level
- Explain the virtual address space of a process: code, data, BSS, stack, heap, and their layout
- Trace the life of a program from `execve()` to `main()` using `strace`
- Explain what a system call is, how the `syscall` instruction works, and what happens at the user/kernel boundary
- Write Zig programs that make system calls directly using `std.os.linux`
- Describe what ASLR is and why it exists
- Explain demand paging and why programs do not read their entire binary into memory at startup
- Implement a minimal program that reads from stdin and writes to stdout using only system calls

---

## Setting Up Your Environment

This module requires several Linux tools. Verify each:

```bash
readelf --version        # part of binutils
strace --version         # system call tracer
file zig-out/bin/main    # identifies file type
```

If `strace` is not installed:
```bash
sudo apt install strace   # Debian/Ubuntu
sudo dnf install strace   # Fedora/RHEL
```

You will also use:
- `hexdump -C` — display file contents in hex + ASCII
- `/proc/PID/maps` — the virtual memory map of a running process
- `size` — displays binary section sizes

All code in this module targets `x86_64-linux`. If you are on a different OS, the system call numbers and some tooling differ, but the concepts are identical.

---

## Part 1: The Binary — What the Compiler Produces

### 1.1 From Source to File

When you run `zig build-exe src/main.zig`, the Zig compiler:

1. Parses your source into an abstract syntax tree
2. Performs semantic analysis and type checking
3. Lowers to an intermediate representation (Zig IR)
4. Generates machine code for the target architecture
5. Runs the linker to combine object files and libraries into a final executable

The result is a file on disk. On Linux, this file uses the **ELF format** — Executable and Linkable Format. ELF is the standard binary format on Linux, BSD, Solaris, and most other Unix-like systems.

Let's start by looking at what the compiler actually produces. Create a minimal Zig program:

```zig
// src/main.zig
const std = @import("std");

pub fn main() void {
    std.debug.print("hello\n", .{});
}
```

Compile it:
```bash
zig build-exe src/main.zig -O ReleaseFast
```

Now inspect it as a file:
```bash
file zig-out/bin/main
# Output: ELF 64-bit LSB executable, x86-64, dynamically linked, ...

ls -la zig-out/bin/main
# Note the file size

hexdump -C zig-out/bin/main | head -4
# The first bytes: 7f 45 4c 46 = 0x7f 'E' 'L' 'F'
```

Every ELF file starts with the four-byte **magic number** `7f 45 4c 46` — that is, the byte `0x7F` followed by the ASCII characters 'E', 'L', 'F'. This is how the kernel and tools know they are dealing with an ELF file.

### 1.2 The ELF Header

The ELF header occupies the first 64 bytes of the file. It describes the overall structure:

```bash
readelf -h zig-out/bin/main
```

You will see output like:

```
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              EXEC (Executable file)
  Machine:                           Advanced Micro Devices X86-64
  Version:                           0x1
  Entry point address:               0x401000
  Start of program headers:          64 (bytes into file)
  Start of section headers:          NNNN (bytes into file)
  Flags:                             0x0
  Size of this header:               64 (bytes)
  Size of program headers:           56 (bytes)
  Number of program headers:         N
  Size of section headers:           64 (bytes)
  Number of section headers:         N
```

The **entry point address** is the virtual address of the first instruction to execute. When the OS loads this binary, it will jump to this address to start the program. For a Zig program, this is typically the `_start` function in the Zig runtime, which sets up the environment and then calls `main`.

The **type** field `EXEC` means this is an executable. Other types include `DYN` (shared library), `REL` (relocatable object file, not yet linked), and `CORE` (crash dump).

### 1.3 Sections vs. Segments

ELF has two perspectives on the binary's content:

**Sections** describe the binary from the linker's perspective — how code and data are organized for the purpose of linking. The section header table maps section names to their locations in the file.

**Segments (Program Headers)** describe the binary from the loader's perspective — what the OS needs to do to run the program. Each segment tells the OS: "load this region of the file into memory at this virtual address, with these permissions."

The same bytes may appear in both a section and a segment; they are different views of the same data.

```bash
# View sections:
readelf -S zig-out/bin/main

# View segments (program headers):
readelf -l zig-out/bin/main
```

The sections you will see in a Zig binary:

| Section | Purpose |
|---------|---------|
| `.text` | Machine code (executable, read-only) |
| `.rodata` | Read-only data: string literals, constants |
| `.data` | Initialized global/static variables (read-write) |
| `.bss` | Uninitialized globals (not stored in file, zeroed at load) |
| `.symtab` | Symbol table (function/variable names and addresses) |
| `.strtab` | String table (names referenced by `.symtab`) |
| `.debug_*` | Debug information (present in Debug builds) |
| `.dynamic` | Dynamic linking information (shared libraries) |

**The key insight about `.bss`:** BSS stands for "Block Started by Symbol" — a historical term. Its content is always zeros, so the binary does not need to store those zeros on disk. The ELF format records the size of the BSS section and the OS zeroes that memory region when loading. This is why large zero-initialized global arrays do not make binaries larger.

```zig
// These two variables have very different effects on binary size:
var big_initialized = [_]u8{1} ** (1024 * 1024);  // 1MB in .data — increases binary by 1MB
var big_zeroed = [_]u8{0} ** (1024 * 1024);       // 1MB in .bss — binary size unchanged
```

### 1.4 The Binary's Section Sizes

```bash
size zig-out/bin/main
```

Output:
```
   text    data     bss     dec     hex filename
  12345     456      78   12879    3246 main
```

- `text`: size of the code section in bytes
- `data`: size of initialized data
- `bss`: size of zero-initialized data (not in the file, allocated at runtime)
- `dec`/`hex`: total of the three, in decimal and hex

Compare Debug and ReleaseFast builds:
```bash
zig build-exe src/main.zig               # Debug
size zig-out/bin/main
mv zig-out/bin/main zig-out/bin/main_debug

zig build-exe src/main.zig -O ReleaseFast # Release
size zig-out/bin/main
```

The Debug build is much larger because it includes:
- Debug information in `.debug_*` sections
- Safety checks compiled into the code
- More verbose symbol tables

### 1.5 Inspecting Symbols

A **symbol** is a name associated with an address in the binary. Function names and global variable names become symbols. They are stored in the symbol table so debuggers, profilers, and other tools can associate addresses with meaningful names.

```bash
# Show all symbols:
readelf -s zig-out/bin/main | head -30

# Find a specific function:
readelf -s zig-out/bin/main | grep main
```

In a ReleaseFast build, some symbols may be stripped for smaller binary size. The Debug build preserves all symbols.

---

> **Exercise 3.1: Binary Archaeology**
>
> Compile the following Zig program in both Debug and ReleaseFast modes:
>
> ```zig
> const std = @import("std");
>
> var counter: u64 = 0;
> var buffer: [4096]u8 = undefined;
> const greeting = "Hello, Systems Programmer!\n";
>
> pub fn main() void {
>     counter += 1;
>     std.debug.print("{s} (call #{d})\n", .{ greeting, counter });
> }
> ```
>
> For each build, use `readelf`, `size`, and `hexdump` to answer:
> 1. What is the entry point address? Does it differ between Debug and Release?
> 2. What section is `counter` in? What about `buffer`? What about `greeting`?
> 3. How large is the `.text` section in each build? What explains the difference?
> 4. Find the bytes of the `greeting` string in the binary using `hexdump`. At what file offset do they appear?

---

> **Answer 3.1**
>
> `counter` — initialized to 0, but since it is mutable it goes in `.bss` (zero-initialized globals). Actually in Zig, `var counter: u64 = 0` will go in `.bss` because it is a zero-initialized writable global.
>
> `buffer` — uninitialized, goes in `.bss`.
>
> `greeting` — a string constant, goes in `.rodata`.
>
> The string bytes can be found in the binary at the offset of `.rodata`. Use:
> ```bash
> readelf -S binary | grep rodata  # find the offset
> hexdump -C binary | grep -A1 "Hello"
> ```

---

## Part 2: The Virtual Address Space

### 2.1 What a Process Sees

From the perspective of a running program, memory appears to be a single, contiguous address space stretching from address 0 up to 2⁶⁴ - 1 (on a 64-bit system). But this is an illusion — a very useful illusion — created by the operating system and the hardware.

The actual physical memory in the machine is shared among all running processes. The OS gives each process its own **virtual address space**: a private mapping where each virtual address corresponds to some physical memory (or disk storage, or nothing at all). Two processes can have the same virtual address point to completely different physical memory — they are isolated from each other.

This mechanism is **virtual memory**. The hardware component that translates virtual addresses to physical addresses is the **Memory Management Unit (MMU)**, working with data structures maintained by the OS called **page tables**.

### 2.2 The Layout of a Process's Address Space

A process's virtual address space is divided into several regions, each with distinct purposes and permissions:

```
Virtual Address Space (64-bit Linux)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

0xFFFF_FFFF_FFFF_FFFF  ─────────────────────────
                         Kernel space
                         (inaccessible from user mode)
0xFFFF_8000_0000_0000  ─────────────────────────

         ↑ large gap ↑  (canonical hole — invalid addresses)

0x0000_7FFF_FFFF_FFFF  ─────────────────────────
                         Stack
                         (grows downward ↓)
                         (contains local variables,
                          return addresses, saved regs)
                       ─────────────────────────
                         Memory-mapped region
                         (shared libraries, mmap'd files)
                       ─────────────────────────
                         Heap
                         (grows upward ↑)
                         (dynamic allocations)
                       ─────────────────────────
                         BSS segment
                         (zero-initialized globals)
                       ─────────────────────────
                         Data segment
                         (initialized globals)
                       ─────────────────────────
                         Text segment
                         (machine code — read-only)
0x0000_0000_0040_0000  ─────────────────────────
                         (typical text segment start)
0x0000_0000_0000_0000  ─────────────────────────
                         NULL (unmapped — accessing
                          address 0 causes SIGSEGV)
```

**Text segment** (`r-x` — readable, executable, not writable): The machine code of the program. The OS maps this read-only both to prevent the program from modifying its own code and to allow the same physical pages to be shared between multiple instances of the same program.

**Data segment** (`rw-` — readable, writable, not executable): Initialized global and static variables that have non-zero initial values.

**BSS segment** (`rw-`): Zero-initialized globals. The OS allocates and zeroes this region; it is not stored in the binary.

**Heap** (`rw-`): Dynamic memory allocations, managed by the allocator. The heap grows upward from the end of BSS.

**Memory-mapped region**: Shared libraries, memory-mapped files, and anonymous mappings created by `mmap()` typically live in this region.

**Stack** (`rw-`): The call stack. Grows downward from a high address. Each thread has its own stack.

**Kernel space** (inaccessible from user mode): The upper portion of the virtual address space is reserved for the kernel. Attempting to access a kernel address from user mode causes an immediate fault.

### 2.3 Observing the Address Space in Practice

You can inspect the actual memory map of a running process using `/proc/PID/maps`:

```zig
// src/main.zig — print own memory map
const std = @import("std");

pub fn main() !void {
    // Print addresses of things in different segments
    var stack_var: u64 = 42;
    const global_const = "I am in rodata";

    std.debug.print("stack var address:  0x{X}\n", .{@intFromPtr(&stack_var)});
    std.debug.print("string literal:     0x{X}\n", .{@intFromPtr(global_const.ptr)});
    std.debug.print("main() address:     0x{X}\n", .{@intFromPtr(&main)});

    // Print our own memory map
    const maps_file = try std.fs.openFileAbsolute("/proc/self/maps",
        .{ .mode = .read_only });
    defer maps_file.close();

    var buf: [4096]u8 = undefined;
    const n = try maps_file.read(&buf);
    std.debug.print("\n/proc/self/maps:\n{s}\n", .{buf[0..n]});
}
```

Run this and study the output. You will see lines like:

```
00400000-00401000 r--p 00000000 08:01 12345  /path/to/main  ← ELF header
00401000-00450000 r-xp 00001000 08:01 12345  /path/to/main  ← .text
00450000-00460000 r--p 00050000 08:01 12345  /path/to/main  ← .rodata
00460000-00461000 rw-p 00060000 08:01 12345  /path/to/main  ← .data/.bss
7fff80000000-7fff80021000 rw-p 00000000 00:00 0             ← heap
7ffff7dc0000-7ffff7fe0000 r--p 00000000 08:01 ...  libc.so  ← shared lib
7ffffffde000-7ffffffff000 rwxp 00000000 00:00 0  [stack]    ← stack
```

Each line shows: start address, end address, permissions (`r`=read, `w`=write, `x`=execute, `p`=private), file offset, device, inode, and the mapped file (if any).

Notice that:
- The text segment (`.text`) has `r-x` — readable and executable, but not writable
- The data/BSS segments have `rw-` — readable and writable, but not executable
- The stack has `rw-` — writable but not executable (modern Linux disables executable stacks by default as a security measure)

### 2.4 Address Space Layout Randomization (ASLR)

If you run the address-printing program multiple times, you will notice the addresses change on each run. This is **ASLR — Address Space Layout Randomization**.

```bash
./main | grep stack
./main | grep stack
./main | grep stack
# Different address each time
```

ASLR is a security mitigation: it randomizes the base addresses of the stack, heap, and memory-mapped regions each time a program starts. This makes it much harder for attackers to exploit buffer overflows and other vulnerabilities that rely on knowing where specific code or data is in memory.

On modern Linux, ASLR randomizes:
- The stack base address (high bits of the stack pointer)
- The heap base address
- The base addresses of shared libraries

The text segment of a non-PIE (Position-Independent Executable) binary is typically loaded at a fixed address. PIE binaries (which the Zig compiler produces by default in some configurations) randomize the text segment base address as well.

You can disable ASLR for a specific process using `setarch`:
```bash
setarch $(uname -m) -R ./main  # disable ASLR for this run
setarch $(uname -m) -R ./main  # same addresses as previous run
```

### 2.5 Demand Paging — Why Programs Don't Read the Whole Binary

When the OS loads a program, it does not read the entire binary into physical memory. Instead it sets up page table entries that point to the file on disk, marked as not-present. When the processor first tries to access one of these pages, it triggers a **page fault**: an exception that says "this page is mapped but not currently in physical memory."

The OS handles the page fault by:
1. Reading the required page from disk into a physical frame
2. Updating the page table to mark the page as present
3. Resuming execution at the instruction that faulted

This is **demand paging** — pages are loaded on demand, not up front. The benefit is that a large program (say, a text editor with hundreds of features) starts quickly even if only a small fraction of its code is ever used during any given run.

You can observe this with `strace`:
```bash
strace -e trace=mmap,mprotect,open zig-out/bin/main 2>&1 | head -30
```

You will see a sequence of `mmap` calls that map the binary's segments into the address space — but no `read` calls at startup. The kernel maps the file; physical memory is populated lazily.

---

## Part 3: From execve to main()

### 3.1 The execve System Call

When you type a command in a shell, the shell calls `execve()` — the system call that replaces the current process image with a new program. `execve` takes three arguments:

1. The path to the executable file
2. An array of argument strings (argv)
3. An array of environment variable strings (envp)

`execve` is a one-way operation: if it succeeds, the calling process's code, data, and stack are completely replaced by the new program. The process ID remains the same. If it fails (file not found, wrong permissions, etc.), `execve` returns an error and the calling process continues.

```zig
// Demonstrate execve conceptually (don't run this without care —
// it will replace the current process!)
const linux = std.os.linux;

// This is what the shell does when you type "./main":
const path = "/path/to/main";
const argv = [_:null]?[*:0]const u8{ path, null };
const envp = [_:null]?[*:0]const u8{ null };
_ = linux.execve(path, &argv, &envp);
```

### 3.2 What the Kernel Does in execve

When `execve` is called, the Linux kernel:

1. **Validates the path:** Opens the file, checks permissions (is it executable?), reads the first 128 bytes into a buffer to identify the file format.

2. **Identifies the format:** The kernel checks the magic bytes. If the file starts with `7f 45 4c 46` (ELF magic), it calls the ELF loader. Other recognized formats include scripts starting with `#!` (the shebang line — the kernel extracts the interpreter path and calls it).

3. **Flushes the old address space:** The old process's memory mappings are torn down. All virtual memory from the previous program is gone.

4. **Maps the new binary:** The kernel reads the program headers. For each `PT_LOAD` segment, it calls `mmap()` internally to map that segment into the new address space:
   - The text segment is mapped `PROT_READ | PROT_EXEC`
   - The data segment is mapped `PROT_READ | PROT_WRITE`
   - BSS is mapped as anonymous zeroed memory

5. **Handles dynamic linking:** If the binary has a `PT_INTERP` segment (which most programs do — it specifies `/lib/ld-linux-x86-64.so.2`, the dynamic linker), the kernel also maps the dynamic linker into the address space and sets the entry point to the dynamic linker, not the program itself.

6. **Sets up the initial stack:** The kernel places the argument strings, environment strings, and auxiliary vectors on the stack. The auxiliary vector (`auxv`) is a set of key-value pairs that the kernel passes to the process at startup: things like the program entry point, the page size, the address of the vDSO.

7. **Transfers control:** The kernel sets `rip` to the entry point (either the program's `_start` or the dynamic linker's entry point) and returns to user mode.

### 3.3 The Dynamic Linker

Most programs depend on shared libraries — `libc.so`, `libm.so`, or others. These libraries are not linked directly into the binary; instead, the binary records which libraries it needs and which symbols it expects from them.

The **dynamic linker** (`ld.so`) is itself an ELF shared library that is mapped into every dynamically-linked process. When `execve` transfers control to the dynamic linker, it:

1. Reads the binary's `.dynamic` section to find the list of required libraries
2. Opens and maps each required library into the address space
3. Resolves **relocations**: replaces placeholder addresses in the binary with the actual addresses of symbols found in the loaded libraries
4. Calls any initialization functions in the loaded libraries (`__init` functions, constructors)
5. Transfers control to the actual program entry point (`_start`)

You can see this process with:
```bash
strace -e trace=open,mmap zig-out/bin/main 2>&1 | head -50
```

Zig programs that do not link against C libraries may produce statically-linked binaries that skip the dynamic linker entirely:
```bash
zig build-exe src/main.zig -target x86_64-linux-musl  # static linking with musl
```

### 3.4 From _start to main

The entry point for a Zig program is not `main` — it is `_start`. `_start` is generated by the Zig runtime and does several things before calling `main`:

1. Sets up the stack pointer to be properly aligned
2. Reads `argc`, `argv`, and `envp` from the stack (the kernel placed them there in step 6 of `execve`)
3. Initializes the Zig standard library runtime
4. Calls `main()`
5. Calls `exit()` with `main`'s return value (or 0 if `main` returns `void`)

You can see this in the disassembly:
```bash
objdump -d -M intel zig-out/bin/main | grep -A 20 "<_start>"
```

### 3.5 Tracing a Program's Entire Startup

`strace` is the tool for observing system calls in real time. It intercepts every system call the program makes and prints them to stderr:

```bash
strace zig-out/bin/main
```

The first few system calls will be from the dynamic linker loading libraries. Then you will see the program's own system calls. The last call before the program exits is typically `exit_group(0)`.

Key things to observe:
- `execve(...)` — this is the first call; the OS just started the program
- `mmap(...)` calls — loading the binary's segments and shared libraries
- `write(1, ...)` — writing to stdout (file descriptor 1)
- `exit_group(0)` — exiting with code 0

To count system calls and see where time is spent:
```bash
strace -c zig-out/bin/main
```

---

> **Exercise 3.2: Tracing Hello World**
>
> Compile a minimal "Hello, World" program and trace its execution:
>
> ```zig
> const std = @import("std");
> pub fn main() void {
>     std.debug.print("Hello, World!\n", .{});
> }
> ```
>
> Using `strace`, answer:
> 1. How many total system calls does this program make?
> 2. Which system call actually writes "Hello, World!" to the terminal?
> 3. What is the file descriptor number used for the write?
> 4. What is the last system call before the program exits?
> 5. Compare the system call count between Debug and ReleaseFast builds. Which makes more calls?

---

## Part 4: System Calls — The Boundary

### 4.1 What a System Call Is

A **system call** is a request from a user-space program to the operating system kernel. It is how programs do anything that requires privileged access: reading files, writing to the terminal, allocating memory, creating processes, establishing network connections.

The processor enforces a strict separation between **user mode** (ring 3 on x86-64) and **kernel mode** (ring 0). User-mode code cannot directly access hardware, cannot modify page tables, cannot disable interrupts. These restrictions exist so that one program cannot crash or corrupt the entire system, and so that the OS can enforce security boundaries between processes.

System calls are the controlled gateway across this boundary.

### 4.2 The syscall Convention on x86-64

On x86-64 Linux, system calls use the `syscall` instruction. The convention:

| Register | Role |
|----------|------|
| `rax` | System call number |
| `rdi` | 1st argument |
| `rsi` | 2nd argument |
| `rdx` | 3rd argument |
| `r10` | 4th argument (note: `r10`, not `rcx`!) |
| `r8` | 5th argument |
| `r9` | 6th argument |
| `rax` (after) | Return value (negative values are errors) |

This differs slightly from the function call convention: the 4th argument uses `r10` instead of `rcx` (because `syscall` clobbers `rcx` to save the return address).

The kernel destroys `rcx` and `r11` during system call execution. All other registers are preserved.

**Important system call numbers on x86-64 Linux:**

| Number | Name | Description |
|--------|------|-------------|
| 0 | `read` | Read from file descriptor |
| 1 | `write` | Write to file descriptor |
| 2 | `open` | Open a file |
| 3 | `close` | Close a file descriptor |
| 9 | `mmap` | Map memory |
| 11 | `munmap` | Unmap memory |
| 12 | `brk` | Adjust heap break |
| 39 | `getpid` | Get process ID |
| 57 | `fork` | Create child process |
| 59 | `execve` | Execute a program |
| 60 | `exit` | Exit current thread |
| 231 | `exit_group` | Exit all threads |

The full list: `man 2 syscalls` or `/usr/include/asm/unistd_64.h`.

### 4.3 What Happens During a System Call

When a program executes the `syscall` instruction:

1. **The CPU saves state:** The current instruction pointer is saved in `rcx`. The current `rflags` value is saved in `r11`. Both will be restored on return.

2. **The CPU switches to kernel mode:** The privilege level changes from ring 3 (user) to ring 0 (kernel). The CPU also switches to the kernel stack — each process has a separate kernel stack that is only used during system call execution.

3. **The CPU jumps to the kernel's system call entry point:** The address of this entry point is stored in the `IA32_LSTAR` model-specific register (MSR), set during kernel initialization. The kernel's entry code is in `arch/x86/entry/entry_64.S`.

4. **The kernel saves all user registers:** The kernel pushes all registers onto the kernel stack so they can be restored later.

5. **The kernel dispatches the call:** The system call number in `rax` is used as an index into the **system call table** — an array of function pointers. The kernel jumps to the appropriate handler.

6. **The handler executes:** The kernel function runs in kernel mode with access to all physical resources. It validates the arguments (checking pointer validity, permissions, etc.) and performs the requested operation.

7. **The return value is placed in `rax`:** A non-negative value indicates success. A value between -4095 and -1 indicates an error (it is the negated errno code).

8. **The CPU restores state and returns to user mode:** The `sysret` instruction restores `rip` from `rcx`, restores `rflags` from `r11`, and switches back to ring 3.

The entire sequence takes roughly 100-200 nanoseconds on a modern processor — much more than a function call (a few nanoseconds), but unavoidable for operations that require kernel intervention.

### 4.4 Making System Calls Directly in Zig

Zig's standard library provides access to system calls through `std.os.linux`. You can use these to bypass the standard library and make system calls directly:

```zig
const std = @import("std");
const linux = std.os.linux;

pub fn main() !void {
    // sys_write(fd, buf, count)
    // syscall number: 1
    // fd=1 is stdout
    const message = "Hello from a raw system call!\n";
    const result = linux.write(1, message, message.len);

    if (linux.getErrno(result) != .SUCCESS) {
        return error.WriteFailed;
    }

    // sys_getpid()
    // syscall number: 39
    const pid = linux.getpid();
    var buf: [32]u8 = undefined;
    const pid_str = try std.fmt.bufPrint(&buf, "PID: {d}\n", .{pid});
    _ = linux.write(1, pid_str, pid_str.len);

    // sys_exit_group(0)
    // syscall number: 231
    linux.exit(0);
}
```

### 4.5 Making System Calls with Inline Assembly

To make a system call directly — without using `std.os.linux` — you use inline assembly:

```zig
const std = @import("std");

/// Make the write(2) system call directly using inline assembly.
/// write(fd, buf, count) → bytes_written
fn sys_write(fd: usize, buf: [*]const u8, count: usize) isize {
    return asm volatile ("syscall"
        : [ret] "={rax}" (-> isize)
        : [syscall_number] "{rax}" (@as(usize, 1)), // syscall 1 = write
          [fd]             "{rdi}" (fd),
          [buf]            "{rsi}" (buf),
          [count]          "{rdx}" (count)
        : "rcx", "r11", "memory"
    );
}

/// Make the exit_group(2) system call.
/// exit_group(status) → noreturn
fn sys_exit(status: u8) noreturn {
    _ = asm volatile ("syscall"
        :
        : [syscall_number] "{rax}" (@as(usize, 231)), // syscall 231 = exit_group
          [status]         "{rdi}" (@as(usize, status))
        : "rcx", "r11"
    );
    unreachable;
}

pub fn main() noreturn {
    const message = "Written via raw syscall assembly\n";
    _ = sys_write(1, message.ptr, message.len);
    sys_exit(0);
}
```

The Zig inline assembly syntax:
- `asm volatile("syscall" ...)` — the assembly instruction
- `: [ret] "={rax}" (-> isize)` — output: the value of `rax` after the syscall, returned as `isize`
- `: [name] "{reg}" (value)` — input: put `value` into `reg` before the syscall
- `: "rcx", "r11", "memory"` — clobbers: registers destroyed by `syscall`, plus "memory" to prevent the compiler from reordering memory accesses across the syscall

This is what your Zig standard library ultimately does when it calls `write` or `read`.

### 4.6 The Cost of System Calls

System calls are not free. The context switch between user mode and kernel mode involves:
- Saving and restoring registers
- Switching stacks (user stack ↔ kernel stack)
- Flushing some CPU caches and prediction state (for security reasons — see Spectre/Meltdown mitigations)
- Running kernel validation code

On a modern processor, a simple system call like `getpid()` takes approximately 100-300 nanoseconds. Compare this to:
- A function call: ~1-5 nanoseconds
- An L1 cache access: ~1-4 nanoseconds
- An L2 cache access: ~5-10 nanoseconds

This is why high-performance code batches I/O operations — reading or writing large chunks at once instead of one byte at a time — and why the number of system calls per second is a relevant performance metric for server applications.

```zig
// Slow: one system call per byte (many calls, each with ~200ns overhead)
for (data) |byte| {
    _ = linux.write(fd, &[_]u8{byte}, 1);
}

// Fast: one system call for all data
_ = linux.write(fd, data.ptr, data.len);
```

The vDSO (virtual Dynamic Shared Object) is a small shared library that the kernel maps into every process. It contains implementations of certain system calls that can be executed entirely in user space — notably `clock_gettime`. This avoids the kernel transition for very frequent, low-overhead operations.

---

> **Exercise 3.3: System Call Spy**
>
> Write a program that measures the cost of a single `getpid()` system call:
>
> ```zig
> const iterations = 1_000_000;
> var timer = try std.time.Timer.start();
>
> for (0..iterations) |_| {
>     _ = linux.getpid();
> }
>
> const elapsed_ns = timer.read();
> std.debug.print("{d} syscalls in {d} ns = {d} ns/syscall\n",
>     .{ iterations, elapsed_ns, elapsed_ns / iterations });
> ```
>
> Run this and record the cost per system call on your machine.
>
> Then measure the cost of a simple function call (just call an empty function in a loop) and compare. What is the overhead ratio?
>
> Extension: Measure `write(1, buf, 1)` (writing 1 byte) versus `write(1, buf, 4096)` (writing 4096 bytes). How does the time per byte compare between the two?

---

## Part 5: File Descriptors and I/O

### 5.1 File Descriptors

Every process has a **file descriptor table** — an array of open "file descriptions" indexed by small non-negative integers. The first three entries are always open by default:

| FD | Name | Default destination |
|----|------|---------------------|
| 0 | stdin | Terminal input |
| 1 | stdout | Terminal output |
| 2 | stderr | Terminal error output |

When you call `open()` to open a file, the kernel returns the lowest available file descriptor number (starting from 3). When you call `write(1, ...)` to write to stdout, you are writing to file descriptor 1 — a handle that the kernel maps to whatever stdout is pointing at (terminal, pipe, file, etc.).

The beauty of this design: the same `write()` system call works identically whether the destination is a terminal, a file, a socket, a pipe, or any other I/O resource. The abstraction is uniform.

### 5.2 A Minimal I/O Program

Let's build a minimal `cat`-like program that reads from stdin and writes to stdout, using only system calls — no standard library:

```zig
const linux = @import("std").os.linux;

pub fn main() noreturn {
    var buf: [4096]u8 = undefined;

    while (true) {
        // read(fd=0, buf, count)
        const bytes_read = linux.read(0, &buf, buf.len);

        // read returns 0 at EOF
        if (bytes_read == 0) break;

        // Negative return indicates error
        if (@as(isize, @bitCast(bytes_read)) < 0) break;

        // write(fd=1, buf, count)
        var written: usize = 0;
        while (written < bytes_read) {
            const n = linux.write(1, buf[written..bytes_read].ptr,
                bytes_read - written);
            if (@as(isize, @bitCast(n)) <= 0) break;
            written += n;
        }
    }

    linux.exit(0);
}
```

This program handles partial writes — a critical detail in real I/O code. The `write()` system call is not guaranteed to write all requested bytes in one call (this can happen with pipes, sockets, or slow terminals). The inner while loop retries until all bytes are written.

### 5.3 Redirecting File Descriptors

The `dup2()` system call copies one file descriptor to another, which is how shells implement redirection:

```bash
./program > output.txt
```

The shell does:
1. `fork()` to create a child process
2. In the child: `open("output.txt", ...)` to get an fd (say, 3)
3. In the child: `dup2(3, 1)` to make fd 1 (stdout) point to the file
4. In the child: `close(3)` to close the original fd
5. In the child: `execve("./program", ...)` to run the program

The program, when it calls `write(1, ...)`, now writes to the file. It has no idea its stdout was redirected — it just uses fd 1 as always.

```zig
const linux = @import("std").os.linux;

// Redirect stdout to a file
fn redirect_stdout_to_file(path: [*:0]const u8) !void {
    const flags = linux.O.WRONLY | linux.O.CREAT | linux.O.TRUNC;
    const fd = linux.open(path, flags, 0o644);
    if (@as(isize, @bitCast(fd)) < 0) return error.OpenFailed;

    const result = linux.dup2(fd, 1); // copy fd to stdout
    if (@as(isize, @bitCast(result)) < 0) return error.Dup2Failed;

    _ = linux.close(fd); // close original fd
}
```

---

## Part 6: Process Creation

### 6.1 fork() and exec()

Unix process creation follows a two-step model: **fork** to create a copy of the current process, then **exec** to replace that copy with a new program.

**`fork()`** creates an identical copy of the calling process. After `fork()`:
- The child process has the same code, the same open file descriptors, and a copy of the parent's memory
- The child is a separate process with a unique PID
- `fork()` returns 0 to the child and the child's PID to the parent

**`execve()`** replaces the current process image with a new program. It does not create a new process — it transforms the existing one.

Together, they allow a shell to run a program:
1. Fork to create a child
2. In the child, redirect file descriptors (for I/O redirection)
3. In the child, exec the program
4. In the parent, wait for the child to finish

```zig
const std = @import("std");
const linux = std.os.linux;

pub fn main() !void {
    const pid = linux.fork();

    if (pid == 0) {
        // Child process
        std.debug.print("Child: PID={d}\n", .{linux.getpid()});

        // Replace the child with /bin/echo
        const path = "/bin/echo";
        const argv = [_:null]?[*:0]const u8{
            "echo",
            "Hello from execve!",
            null,
        };
        const envp = [_:null]?[*:0]const u8{null};
        _ = linux.execve(path, &argv, &envp);

        // If execve succeeds, we never reach here
        // If it fails, exit the child
        linux.exit(1);
    } else if (@as(isize, @bitCast(pid)) > 0) {
        // Parent process
        std.debug.print("Parent: spawned child PID={d}\n", .{pid});

        // Wait for child to finish
        var status: u32 = 0;
        _ = linux.wait4(pid, &status, 0, null);
        std.debug.print("Parent: child exited\n", .{});
    } else {
        return error.ForkFailed;
    }
}
```

### 6.2 Copy-on-Write

When `fork()` creates a child process, it would be wasteful to physically copy the parent's entire address space — the child might immediately call `exec`, discarding everything. Instead, modern OS kernels use **copy-on-write (CoW)**: the parent's and child's page tables initially point to the same physical pages, all marked read-only.

When either process tries to *write* to one of these shared pages, a page fault occurs. The OS handles it by:
1. Allocating a new physical page
2. Copying the contents from the shared page
3. Updating the writing process's page table to point to the new page
4. Marking the new page as writable

The other process continues to use the original page. Each process now has its own private copy of the modified page — but only for pages that were actually written.

This is why `fork()` is cheap even for large processes: no data is copied until it is needed.

---

## Part 7: The Module Project — A Process Inspector

The module project uses everything from this module to build a tool that introspects running processes.

### Project Specification

Build `pinspect` — a process inspector that reads and displays detailed information about a running process from `/proc`:

```
$ ./pinspect 1234

Process 1234: bash
═══════════════════════════════════════════════════

Status:
  State:    S (sleeping)
  Threads:  1
  Parent:   1200

Memory:
  Virtual:  8,456,192 bytes (8.1 MB)
  RSS:      4,096,000 bytes (3.9 MB)
  Stack:    131,072 bytes

File Descriptors:
  fd 0 → /dev/pts/0  (stdin)
  fd 1 → /dev/pts/0  (stdout)
  fd 2 → /dev/pts/0  (stderr)
  fd 3 → /home/user/.bash_history

Memory Map (segments):
  0x55a2a3400000-0x55a2a34a5000  r--p  /usr/bin/bash
  0x55a2a34a5000-0x55a2a3818000  r-xp  /usr/bin/bash  (.text)
  0x55a2a3818000-0x55a2a38c7000  r--p  /usr/bin/bash  (.rodata)
  ...
```

### Implementation

**Step 1: Read /proc/PID/status**

The `/proc/PID/status` file contains key-value pairs with process information:

```zig
fn read_proc_status(pid: u32, allocator: std.mem.Allocator) !void {
    var path_buf: [64]u8 = undefined;
    const path = try std.fmt.bufPrint(&path_buf, "/proc/{d}/status", .{pid});

    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();

    const content = try file.readToEndAlloc(allocator, 65536);
    defer allocator.free(content);

    // Parse key: value pairs
    var lines = std.mem.splitScalar(u8, content, '\n');
    while (lines.next()) |line| {
        if (line.len == 0) continue;
        if (std.mem.indexOf(u8, line, ':')) |colon| {
            const key = std.mem.trim(u8, line[0..colon], " \t");
            const value = std.mem.trim(u8, line[colon+1..], " \t");

            if (std.mem.eql(u8, key, "Name") or
                std.mem.eql(u8, key, "State") or
                std.mem.eql(u8, key, "Pid") or
                std.mem.eql(u8, key, "PPid") or
                std.mem.eql(u8, key, "Threads") or
                std.mem.eql(u8, key, "VmRSS") or
                std.mem.eql(u8, key, "VmSize"))
            {
                std.debug.print("{s}: {s}\n", .{key, value});
            }
        }
    }
}
```

**Step 2: Parse /proc/PID/maps**

```zig
const MemoryRegion = struct {
    start: u64,
    end: u64,
    perms: [4]u8,
    offset: u64,
    path: []const u8,
};

fn read_memory_map(pid: u32, allocator: std.mem.Allocator) ![]MemoryRegion {
    var path_buf: [64]u8 = undefined;
    const path = try std.fmt.bufPrint(&path_buf, "/proc/{d}/maps", .{pid});

    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();

    const content = try file.readToEndAlloc(allocator, 4 * 1024 * 1024);
    defer allocator.free(content);

    var regions = std.ArrayList(MemoryRegion).init(allocator);

    var lines = std.mem.splitScalar(u8, content, '\n');
    while (lines.next()) |line| {
        if (line.len == 0) continue;

        // Format: start-end perms offset dev inode pathname
        // Example: 00400000-00401000 r--p 00000000 08:01 12345 /path/to/binary
        var parts = std.mem.splitScalar(u8, line, ' ');

        const addr_range = parts.next() orelse continue;
        const perms = parts.next() orelse continue;

        if (std.mem.indexOf(u8, addr_range, '-')) |dash| {
            const start = try std.fmt.parseInt(u64, addr_range[0..dash], 16);
            const end = try std.fmt.parseInt(u64, addr_range[dash+1..], 16);

            // Skip to path (5th whitespace-separated field)
            _ = parts.next(); // offset
            _ = parts.next(); // dev
            _ = parts.next(); // inode

            // Remaining is the path (may have leading spaces)
            const remaining = line[addr_range.len + 1 + perms.len..];
            const path_part = std.mem.trim(u8, remaining, " \t");

            // Skip offset, dev, inode fields
            var path_start: usize = 0;
            var field: usize = 0;
            var in_space = false;
            for (path_part, 0..) |c, i| {
                if (c == ' ' or c == '\t') {
                    in_space = true;
                } else if (in_space) {
                    field += 1;
                    in_space = false;
                    if (field == 3) {
                        path_start = i;
                        break;
                    }
                }
            }

            try regions.append(.{
                .start = start,
                .end = end,
                .perms = perms[0..4].*,
                .offset = 0,
                .path = path_part[path_start..],
            });
        }
    }

    return regions.toOwnedSlice();
}
```

**Step 3: List file descriptors**

The `/proc/PID/fd/` directory contains symlinks, one per open file descriptor. Each symlink points to what the fd is connected to:

```zig
fn list_file_descriptors(pid: u32) !void {
    var path_buf: [64]u8 = undefined;
    const dir_path = try std.fmt.bufPrint(&path_buf, "/proc/{d}/fd", .{pid});

    var dir = try std.fs.openDirAbsolute(dir_path, .{ .iterate = true });
    defer dir.close();

    var it = dir.iterate();
    while (try it.next()) |entry| {
        var link_buf: [512]u8 = undefined;
        const target = dir.readLink(entry.name, &link_buf) catch continue;
        std.debug.print("  fd {s} → {s}\n", .{entry.name, target});
    }
}
```

### Extension Challenges

1. **ELF inspector:** Given the path to a binary in the process's memory map, parse the ELF header directly and display section information.

2. **System call tracer (minimal strace):** Use `ptrace()` to attach to a child process and intercept its system calls. This is exactly how `strace` works:
   ```zig
   // PTRACE_TRACEME makes the current process traceable
   _ = linux.ptrace(linux.PTRACE.TRACEME, 0, 0, 0);
   // After exec, the child stops and the parent can inspect system calls
   ```

3. **Memory content reader:** Read arbitrary memory from the target process using `/proc/PID/mem`. This is how debuggers read process memory.

---

## Summary

This module has traced the complete lifecycle of a program — from a file on disk to a running process.

**The ELF binary** is a structured file format with sections (linker's view) and segments (loader's view). Key sections: `.text` for code, `.rodata` for constants, `.data` for initialized globals, `.bss` for zero-initialized globals (not stored in the file). The ELF header records the entry point address, architecture, and locations of the program and section header tables.

**The virtual address space** is the OS abstraction that gives each process the illusion of private, contiguous memory. The actual layout — text at low addresses, then data, BSS, heap (growing up), stack (growing down from high addresses) — is implemented through page tables managed by the kernel. ASLR randomizes base addresses for security. Demand paging means pages are loaded from disk only when first accessed.

**execve and program loading** follow a precise sequence: validate the binary, flush the old address space, map the new segments, set up the initial stack, transfer control to the dynamic linker (which loads shared libraries), then to `_start`, then to `main`.

**System calls** are the boundary between user space and the kernel. On x86-64, the `syscall` instruction transfers control to the kernel's entry point, which dispatches to the appropriate handler based on the number in `rax`. Arguments go in `rdi`, `rsi`, `rdx`, `r10`, `r8`, `r9`. Return value in `rax`. The cost is ~100-300ns — orders of magnitude more than a function call.

**File descriptors** are the universal I/O abstraction. fd 0, 1, and 2 are stdin, stdout, stderr. Every I/O operation — files, sockets, pipes, terminals — uses the same `read()` and `write()` system calls.

**fork and exec** are the Unix process creation model. `fork()` creates a copy using copy-on-write — fast because no data is copied until written. `exec()` replaces the current process with a new program.

---

## What's Next

Module 4 — Memory: Ownership, Allocation, and the Cost of Getting It Wrong — goes deep on the programmer's side of memory management. You now understand the virtual address space that programs live in. Module 4 teaches how to use that memory correctly: the difference between stack and heap, Zig's allocator model, ownership, and how memory bugs manifest at the machine level.

---

## Reference: Key Linux System Call Numbers (x86-64)

```
read(0):           read(fd, buf, count)
write(1):          write(fd, buf, count)
open(2):           open(path, flags, mode)
close(3):          close(fd)
stat(4):           stat(path, &stat)
fstat(5):          fstat(fd, &stat)
mmap(9):           mmap(addr, len, prot, flags, fd, offset)
munmap(11):        munmap(addr, len)
brk(12):           brk(addr)
ioctl(16):         ioctl(fd, request, arg)
dup2(33):          dup2(oldfd, newfd)
getpid(39):        getpid()
fork(57):          fork()
execve(59):        execve(path, argv, envp)
exit(60):          exit(status)
wait4(61):         wait4(pid, &status, options, &rusage)
kill(62):          kill(pid, signal)
getdents64(217):   getdents64(fd, buf, count)
exit_group(231):   exit_group(status)
openat(257):       openat(dirfd, path, flags, mode)
```

## Reference: /proc Filesystem Key Files

```
/proc/PID/status     Process status and statistics
/proc/PID/maps       Virtual memory map
/proc/PID/fd/        Open file descriptors (symlinks)
/proc/PID/cmdline    Command line arguments (null-separated)
/proc/PID/environ    Environment variables (null-separated)
/proc/PID/mem        Process memory (readable/writable via pread/pwrite)
/proc/PID/exe        Symlink to executable binary
/proc/PID/cwd        Symlink to current working directory
/proc/self/          Refers to the current process (no need for PID)
```

---

*End of Module 3*
