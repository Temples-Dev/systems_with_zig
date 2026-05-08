# The Craft of Systems Programming
### A Complete Curriculum in Low-Level Software with Zig

---

## Preface

This curriculum exists because of a gap that most developers never close.

You can spend an entire career writing software without understanding what software actually is at the level that matters. You can build web applications, mobile apps, APIs, and data pipelines without ever knowing what happens when your code runs — what the hardware is doing, why some programs are fast and others aren't, how memory works, what an operating system actually does, why distributed systems fail in the ways they do. Most developers live entirely above these questions. Their tools hide the answers.

This curriculum tears the roof off.

It is a complete, practical journey through systems programming — from the binary representation of data to the design of distributed systems that survive hardware failures. It is not a survey. It does not give you a taste of each topic and move on. It goes deep into each area, demands that you implement the ideas you learn, and treats you as someone capable of understanding how things actually work rather than just how to use them.

The implementation language is Zig. This choice is deliberate and sustained across the entire curriculum. Zig is a modern, low-level language designed for systems programming. It compiles to native machine code, requires no runtime, and forces the programmer to be explicit about memory, errors, and control flow. There is no garbage collector making allocations invisible. There is no exception system allowing failures to propagate silently. There is no implicit behavior of any kind. When you write Zig, what you write is what runs — and that transparency is exactly what a systems curriculum requires.

This is not a Zig course. Zig is the lens through which systems concepts become concrete and implementable. A student who completes this curriculum will understand systems deeply — and will be able to demonstrate that understanding through working code. They will also be fluent in Zig. Both outcomes are real and valuable.

The curriculum draws from the best of what exists. The structure of CS:APP from Carnegie Mellon — which has shaped how systems are taught for two decades — informs the early sections on programs and machines. OSTEP, the freely available operating systems textbook from Wisconsin, informs the virtualization, concurrency, and persistence sections. Patterson and Hennessy's Computer Organization and Design informs the processor and architecture section. Kleppmann's Designing Data-Intensive Applications and the academic literature on distributed systems inform the final section. Systems Programming with Zig by Garrison Hinson-Hasty, the Introduction to Zig book by Pedro Faria, and the Zig standard library documentation are used throughout. The curriculum synthesizes these sources into a single, coherent arc — taught in one language, building toward one complete picture of how computer systems work.

---

## Who This Is For

This curriculum is for anyone who wants to understand how computer systems actually work — not conceptually, but deeply enough to build them.

You should be comfortable writing programs in at least one language. You should understand basic data structures and algorithm complexity. You do not need prior experience with C, assembly, operating systems, or Zig. If you have spent years writing application code and feel a growing sense that you do not understand what is happening underneath it — this curriculum is the answer.

If you are a computer science student who has attended lectures on operating systems, computer architecture, and concurrency without ever implementing any of it — this curriculum makes those lectures real.

If you want to work on compilers, kernels, databases, networking infrastructure, embedded systems, or any other domain where understanding the machine matters — this curriculum gives you the foundation.

---

## How to Read This Curriculum

The curriculum is organized into sections and modules. The sections follow a natural arc: from the machine itself, up through programs, memory, the operating system, concurrency, the network, and finally to distributed systems. Each module within a section builds on the ones before it.

Every module has a concept and an implementation. The concept is what you need to understand. The implementation is what you build in Zig to prove you understand it. The understanding comes from the building — not the other way around.

The capstone at the end of each section synthesizes everything in that section into a single working system. The final capstone synthesizes everything in the curriculum.

Do not skip modules. The dependencies are real. A student who skips the memory section will not understand virtual memory. A student who skips virtual memory will not understand processes. A student who skips processes will not understand concurrency. The curriculum is a chain, and each link is load-bearing.

---

# Section I: The Machine

*Everything begins with the machine. Before you can understand programs, you must understand what programs run on — what the hardware is, how it represents information, and how it executes instructions.*

---

## Module 1: How Computers Represent Everything

The computer does not know what a number is. It does not know what a character is, a color, a sound, or a program. It knows only two things: zero and one. Everything else — every data type, every program, every piece of information a computer has ever processed — is an interpretation of patterns of zeros and ones. This module builds the foundations of that interpretation.

### Bits, Bytes, and Words

A bit is the smallest unit of information: a zero or a one. Eight bits make a byte. The number of bytes in a word depends on the architecture — on modern 64-bit systems, a word is typically 8 bytes, or 64 bits. These are not arbitrary choices; they reflect the width of the data paths in the hardware and the registers in the processor.

Students learn to work directly in binary and hexadecimal. They convert between representations fluently — not as a mathematical exercise, but because reading raw memory, understanding instruction encodings, and interpreting hardware documentation all require this fluency.

### Integer Representation

Positive integers are straightforward: binary place values, just like decimal. But computers must also represent negative numbers, and the choice of representation has consequences that reach into every corner of systems programming.

The dominant representation is two's complement. It is not obvious why this was chosen over the simpler sign-magnitude representation, but the reason is elegant: two's complement makes addition and subtraction the same operation. The hardware does not need to know whether the numbers being added are positive or negative. This simplicity at the hardware level propagates upward through every abstraction built on top of it.

Students implement arithmetic in two's complement by hand, then in Zig. They observe overflow behavior: what happens when you add 1 to the maximum value of a `i32`? The answer is not an error in most languages — it wraps silently, producing a large negative number. In Zig's Debug mode, it is a detected error. This is one of the first demonstrations of Zig's approach to systems programming: make the machine's behavior explicit rather than hiding it.

### Floating Point and Its Limits

IEEE 754 is the standard for floating point representation used by virtually every processor built in the last forty years. It represents real numbers in a binary scientific notation: a sign bit, an exponent field, and a significand. The representation is a finite encoding of an infinite set of real numbers, which means that most real numbers cannot be represented exactly.

`0.1 + 0.2 = 0.30000000000000004`. This is not a bug. It is the correct result of IEEE 754 arithmetic. Students learn why, understand the structure of a floating point number at the bit level, and implement correct floating point comparison functions — functions that account for representation error when deciding whether two floating point numbers are equal.

### Characters, Strings, and Encoding

Text is not natively meaningful to hardware. Characters are integers — the letter 'A' is the integer 65 in ASCII, and a different integer in EBCDIC, and a sequence of one to four bytes in UTF-8. Students learn ASCII and Unicode, understand the difference between a character, a code point, and a byte, and implement basic string operations in Zig that work correctly on UTF-8 encoded text.

The key lesson: there is no such thing as plain text. Every string is encoded, and ignoring the encoding produces software that breaks on any non-English input. Systems programmers understand this from first principles because they work at the byte level where the encoding is visible.

### Data Layout in Memory

Memory is a flat sequence of bytes, each with an address. A struct in Zig is a collection of fields laid out at consecutive addresses — but not necessarily without gaps. The processor requires that data be aligned: a 4-byte integer must live at an address divisible by 4, an 8-byte float at an address divisible by 8. When struct fields have different alignment requirements, the compiler inserts padding bytes to satisfy them.

Students use Zig's `@sizeOf`, `@alignOf`, and `@offsetOf` intrinsics to inspect the layout of their own data structures. They observe that reordering fields changes the total size of a struct by changing where padding is inserted. They understand when and why to use `packed struct` to eliminate padding entirely — and what the tradeoff is when they do.

This byte-level view of data is not an advanced topic reserved for experts. It is the foundation on which everything else in the curriculum is built.

---

## Module 2: How the Processor Works

The processor is the engine of computation. It fetches instructions from memory, decodes them, executes them, and stores the results. Understanding this cycle — and understanding how modern processors accelerate it — is essential for writing code that performs well and for reasoning about what your programs are actually doing.

### The Instruction Set

The instruction set architecture (ISA) is the contract between hardware and software. It defines the instructions the processor can execute, the registers it exposes, the memory model it provides, and the conventions for calling functions. Everything above the ISA — every programming language, every compiler, every operating system — is built on this contract.

Students work with x86-64, the ISA that runs on most desktop and server hardware today. They read the machine code that the Zig compiler generates for simple functions: assignments, arithmetic, conditionals, loops, and function calls. They learn the basic instruction categories: data movement (MOV), arithmetic (ADD, SUB, IMUL), logical (AND, OR, XOR, NOT), comparison (CMP, TEST), and control flow (JMP and the conditional jumps, CALL, RET).

The goal is not to become an assembly programmer. The goal is to be able to read assembly — to look at what the compiler produces and understand it, to recognize when the compiler has done something clever, and to notice when something is wrong.

### Registers and the Call Stack

The processor has a small number of registers — named storage locations inside the chip itself that are orders of magnitude faster than main memory. On x86-64, the general-purpose registers are 64 bits wide. The calling convention — the agreement between caller and callee about how to pass arguments and return values — determines which registers are used for which purpose.

When a function is called, the processor pushes a return address onto the stack and jumps to the function's code. The function allocates a stack frame for its local variables. When it returns, the stack frame is discarded and execution resumes at the return address. Students trace this process for a recursive function, watching the stack grow and shrink, understanding exactly where each local variable lives and why stack overflow happens.

### Pipelining

A modern processor does not execute one instruction fully before starting the next. It pipelines: it breaks instruction execution into stages (fetch, decode, execute, memory access, write back) and processes multiple instructions simultaneously, each at a different stage. At any given moment, the processor is doing work on five or more instructions concurrently.

Pipelining creates hazards: situations where the next instruction cannot proceed because it depends on the result of an instruction still in the pipeline, or because a branch changes the instruction stream in a way the processor did not anticipate. Students learn about data hazards, control hazards, and how the processor handles them through stalling, forwarding, and branch prediction.

The lesson for programmers: branch mispredictions are expensive. A mispredicted branch typically costs 15-20 cycles — cycles spent on instructions that must be discarded when the processor discovers it went the wrong way. Students measure the cost of branch misprediction in Zig by comparing sorted versus unsorted data access in a tight loop, observing the performance difference that a single predictable branch makes.

### The Memory Hierarchy

The processor is fast. Memory is slow. This mismatch is the central performance problem of modern computing, and the solution — the memory hierarchy — shapes the design of every high-performance system.

The hierarchy exists because of physical reality: faster memory is smaller and more expensive. The processor has a handful of registers. Outside the processor is the L1 cache (kilobytes, ~4 cycles), then L2 (megabytes, ~12 cycles), then L3 (tens of megabytes, ~40 cycles), then main memory (gigabytes, ~200 cycles), then storage (terabytes, milliseconds). The gap between the fastest and slowest levels is eight orders of magnitude.

The cache works because programs exhibit locality: they tend to access the same data repeatedly (temporal locality) and data near recently accessed data (spatial locality). The hardware automatically promotes data from lower levels to higher levels when it is accessed, and evicts data from higher levels when space is needed.

Students implement two versions of the same computation — one cache-friendly, one cache-hostile — and measure the difference. Row-major versus column-major traversal of a large matrix is the canonical example: the same arithmetic, the same result, a 5-10x runtime difference caused entirely by cache behavior. They also implement a cache simulator in Zig, determining hit and miss rates for a sequence of memory accesses and making the abstract notion of a cache concrete.

---

## Module 3: From Source Code to Running Program

A Zig source file is text. A running process is something entirely different. This module traces the full path between them: compilation, linking, loading, and execution. Understanding this path is prerequisite to understanding everything that follows, because every abstraction the operating system provides is built on top of the running process.

### Compilation

The Zig compiler translates source code into machine code. This is not a simple text substitution — it involves lexing, parsing, semantic analysis, intermediate representation, optimization, and code generation. Students do not need to understand every stage, but they need to understand what the compiler is doing at a high level and, crucially, how to influence it.

They compile programs in Debug mode and ReleaseFast mode and compare the results. Debug mode includes safety checks: integer overflow detection, bounds checking on slice accesses, null pointer detection. ReleaseFast mode disables these checks and enables aggressive optimization. The difference in generated code is striking — students use `objdump` to compare the assembly output and observe how the optimizer transforms their code.

### Linking

Compilation produces object files — binary files containing machine code and metadata, but not yet executable. The linker combines object files, resolves references between them, and produces an executable. Students learn what a symbol is (a named location in object code), what a reference is (a use of a symbol defined elsewhere), and what the linker does when it cannot find a symbol (undefined reference errors, which are among the most common and most confusing errors in systems programming).

They build a multi-file Zig program and observe how the build system manages the linking process. They understand the difference between static linking (copying library code into the executable) and dynamic linking (referencing shared library code that is loaded at runtime), and the tradeoffs between them.

### The Binary Format

The output of the linker on Linux is an ELF (Executable and Linkable Format) binary. Students use `readelf` to inspect the structure: the ELF header describing the file, the program headers describing how to load the file into memory, and the sections — `.text` (machine code), `.rodata` (read-only data), `.data` (initialized global variables), `.bss` (uninitialized globals).

A key observation: the stack and heap are not in the binary. They are regions of memory created at runtime by the operating system. The binary is a static description of the program; the running process is a dynamic instantiation of it.

### Loading and Execution

When you run a program, the operating system creates a process: it maps the binary's sections into the process's virtual address space, sets up the initial stack, and transfers control to the program's entry point. Students trace this process using `strace` — a tool that intercepts and prints every system call a program makes — and observe the sequence of operations that transform a file on disk into a running process.

They write a minimal Zig program that issues system calls directly, bypassing the standard library, and observe the raw interaction between the program and the operating system. This strips away abstraction and reveals the actual interface between user space and kernel space — which is simply a convention for placing arguments in registers and invoking a software interrupt.

---

## Module 4: Memory — The Heart of Systems Programming

If there is one concept that separates systems programmers from application programmers, it is memory. Application programmers allocate and the runtime frees. Systems programmers allocate, track ownership, and free — deliberately, explicitly, and correctly. Memory is not a background concern. It is the central resource that every system manages.

### The Process Memory Model

A running process sees a virtual address space — a range of memory addresses that appear contiguous from the process's perspective but may be mapped to physical memory in any order. This space is divided into regions with different purposes and different properties.

The code segment holds the machine instructions of the program, mapped read-only and executable. The data segment holds initialized global variables, mapped read-write. The BSS segment holds uninitialized globals, also read-write. The stack holds the call stack — automatic storage for local variables, function arguments, and return addresses — growing downward from a high address. The heap is the region where dynamic allocations are made, growing upward from a lower address.

Students build a mental model of this layout by writing programs that print the addresses of global variables, stack variables, and heap-allocated data, and observing how these addresses relate to each other.

### The Stack in Depth

The stack is managed automatically by the processor's calling convention. Every function call allocates a stack frame; every return deallocates it. This allocation and deallocation is not free — it involves incrementing and decrementing the stack pointer — but it is extremely fast compared to heap allocation.

The limitation of the stack is lifetime: data on the stack lives only as long as the function that created it. Return a pointer to a stack variable, and you have a pointer to memory that no longer belongs to you. In Zig, the compiler detects the simplest cases of this mistake and reports them as errors. Students study the cases the compiler catches and the cases it does not, building an intuition for stack lifetime.

They also understand stack overflow: the stack has a fixed maximum size (typically 8 MB on Linux). Unbounded recursion, or allocating very large local variables, can exhaust it. Students write programs that trigger stack overflow, observe the resulting crash, and understand what signal the OS delivers and why.

### Heap Allocation and Zig's Allocator Model

The heap is where data lives when its lifetime cannot be determined at compile time, when it needs to outlive the function that creates it, or when its size is not known until runtime. Heap allocation is more flexible than the stack but more expensive and more dangerous — because the programmer is responsible for freeing what they allocate.

Zig has no global allocator. There is no `malloc`. Every allocation in Zig goes through an `Allocator` interface — a value passed explicitly to functions that need to allocate memory. This design forces the programmer to think about allocation strategy at every callsite, and it makes testing straightforward: swap the allocator, and the behavior of allocation changes without changing any other code.

The allocators available in Zig's standard library each represent a different allocation strategy:

**`std.heap.DebugAllocator`** (previously called GeneralPurposeAllocator, renamed in 0.16.0) is designed for development. It tracks every allocation and every free, and reports memory leaks when the program exits. It catches double-frees, use-after-free, and invalid frees. In Debug builds, it fills freed memory with a pattern that makes use-after-free bugs immediately apparent. Students use this allocator for all development work.

**`std.heap.ArenaAllocator`** allocates from a growing buffer and frees everything at once when the arena is destroyed. In Zig 0.16.0, the ArenaAllocator became thread-safe and lock-free natively. It has zero per-allocation overhead and is ideal for allocations that share a lifetime — parsing a request, processing a transaction, compiling a function.

**`std.heap.FixedBufferAllocator`** allocates from a fixed-size buffer — stack memory or a static array — without touching the heap at all. It is used in embedded systems, real-time systems, and anywhere that heap allocation is unacceptable.

**`std.testing.allocator`** is a wrapper that detects leaks in tests, failing the test if any allocation is not freed by the time the test completes.

Students implement the same data structure using each allocator and measure the performance and behavior differences. Choosing the right allocator is a systems design decision with real consequences.

### Ownership — The Hard Problem

The hardest bugs in systems programming arise from ownership violations: using memory after it has been freed, freeing memory twice, or freeing memory that was never heap-allocated. These bugs are undefined behavior in C and C++, where they silently corrupt memory and produce crashes or incorrect behavior that may be unrelated in time and space to the actual bug.

Zig makes ownership explicit but does not enforce it automatically. The programmer must track who owns each allocation and ensure it is freed exactly once. The `DebugAllocator` provides runtime detection of violations in Debug builds, but the real goal is to design code where ownership violations cannot occur.

Students learn ownership patterns: single-owner allocation (one code path allocates, one code path frees, no shared pointers), arena allocation (many allocations, one free), and the dangers of shared raw pointers (avoided in idiomatic Zig through careful interface design).

They implement a dynamic array from scratch: allocates a buffer, grows it when capacity is exceeded (reallocating and copying), tracks length and capacity separately, and frees the buffer when destroyed. This single implementation touches allocation, reallocation, ownership transfer, and the relationship between capacity and length.

### Virtual Memory

The addresses a program uses are not physical memory addresses. They are virtual addresses, translated by the hardware to physical addresses through a page table maintained by the operating system. This translation is the foundation of process isolation — two processes can use the same virtual addresses and refer to different physical memory — and the foundation of memory protection — a process cannot access memory outside its own address space.

Students understand the page table conceptually: a multi-level data structure mapping virtual page numbers to physical frame numbers. They understand what a page fault is — the hardware exception that occurs when a program accesses a virtual address with no current physical mapping — and how the OS handles it: either mapping the page (if the address is valid and the page is not yet resident) or killing the process (if the address is invalid).

They observe virtual memory in action by implementing memory-mapped file I/O in Zig: mapping a file into the address space and accessing it as if it were an array of bytes. The OS pages the file content in on demand as the program accesses it, making the file indistinguishable from memory from the program's perspective.

---

# Section II: The Operating System

*The operating system is the manager of the machine. It virtualizes the hardware — making one CPU appear to be many, making physical memory appear to be a large private address space for each program — and it provides the interfaces through which programs do I/O, communicate, and control their own execution. Understanding the OS is understanding the environment in which every program runs.*

---

## Module 5: Processes — The Illusion of Exclusive Control

A process is an abstraction: the illusion that a program has the CPU entirely to itself and that its memory is private. The OS creates this illusion through time-sharing and virtual memory. Understanding how it does so is the first step to understanding everything the OS provides.

### What a Process Is

A process is a running instance of a program. It has a virtual address space (the memory it can access), a set of open file descriptors (its connections to the outside world), a current directory, a process ID, a parent process, and at least one thread of execution. Creating a process does not require writing a new program — the same program can run as multiple simultaneous processes, each with its own private state.

On Linux, processes are created with `fork()` — a system call that creates an exact copy of the calling process. The child process has the same memory, the same file descriptors, and the same program counter as the parent, differing only in its process ID and the return value of `fork()`. Students implement fork-based process creation in Zig and observe what the child inherits and what it does not.

### execve and Program Loading

`fork()` creates a copy of the existing process. `execve()` replaces the current process image with a new program. Together, fork and exec are the Unix model for spawning new programs: fork to create a new process, exec to load a different program into it.

Students implement a minimal shell: a loop that reads a command from the user, forks, execs the command in the child, and waits for the child to complete. This is not a toy — it is the same fundamental structure as every shell on every Unix system ever built. Building it from scratch makes the process model concrete.

### Context Switching

The OS creates the illusion of multiple processes running simultaneously by time-sharing the CPU. At regular intervals (driven by a hardware timer), the OS interrupts the running process, saves its state (registers, program counter, stack pointer), selects the next process to run, restores that process's state, and transfers control to it. This is a context switch.

Students measure the cost of a context switch: it is not free. Saving and restoring registers takes time. The cache and TLB (translation lookaside buffer, which caches recent virtual-to-physical translations) must be flushed or are invalidated by the switch. Context switches happen hundreds of times per second; their aggregate cost is significant for performance-sensitive systems.

### Signals

Signals are the OS mechanism for asynchronous notification. A signal is a small integer sent to a process — by the kernel, by another process, or by the process itself. When a signal arrives, the process's normal execution is interrupted and a signal handler runs.

Students implement signal handlers in Zig for SIGINT (Ctrl-C), SIGTERM (graceful shutdown request), and SIGCHLD (child process state change). They understand the severe constraints on what is safe to do inside a signal handler — signal handlers run asynchronously and may interrupt any point in the program, including critical sections, so only a small set of operations are safe.

The key lesson: signals are difficult to use correctly. Most systems code tries to minimize their use and handle them in a controlled way, such as by writing a byte to a pipe in the signal handler and reading that pipe in the main event loop.

---

## Module 6: Scheduling — Who Runs When

The scheduler is the OS component that decides which process runs next. It is one of the most studied problems in systems research, because the choice of scheduler profoundly affects user experience, system throughput, and fairness.

### Scheduling Metrics

Different workloads want different things from the scheduler. A batch processing system wants to maximize throughput — the number of jobs completed per unit time. An interactive system wants to minimize response time — the time between user input and visible response. A real-time system wants to meet deadlines — guaranteeing that certain tasks complete within specified time bounds.

These goals conflict. A scheduler optimized for throughput runs jobs to completion before switching, which is terrible for response time. A scheduler optimized for response time switches frequently, which adds overhead and reduces throughput. Understanding these tradeoffs is the work of scheduler design.

### Classic Scheduling Algorithms

Students implement and measure five scheduling algorithms, computing turnaround time, waiting time, and response time for each under the same workload:

**First-Come First-Served (FCFS)** runs jobs in arrival order. Simple. Fair in one sense — no job is skipped. Poor average turnaround time when a long job arrives before many short ones, because the short jobs must wait (the convoy effect).

**Shortest Job First (SJF)** always runs the shortest remaining job. Provably optimal for average turnaround time. Requires knowing job length in advance, which is rarely possible. In practice, schedulers estimate job length from past behavior.

**Shortest Time to Completion First (STCF)** is SJF with preemption: if a new short job arrives while a longer job is running, the scheduler preempts the long job and runs the short one. Better response time than SJF for interactive workloads.

**Round Robin (RR)** gives each job a fixed time quantum (typically 1-100ms) and cycles through the ready queue. Good response time for interactive workloads. The quantum size is a critical parameter: too small, and context-switching overhead dominates; too large, and response time degrades.

**Multi-Level Feedback Queue (MLFQ)** is the scheduler used in most real operating systems. It approximates SJF without requiring advance knowledge of job length by observing job behavior: jobs that use their full time quantum are likely CPU-bound and get lower priority; jobs that yield before their quantum expires (waiting for I/O) are likely interactive and get higher priority.

### A Cooperative Scheduler in Zig

Students implement a cooperative multitasking scheduler. Tasks voluntarily yield control by calling a `yield()` function; the scheduler maintains a ready queue and dispatches tasks in turn. Tasks can block on events (simulated I/O) and be woken when the event completes.

This requires context switching between tasks — saving the current task's stack pointer and registers and restoring the next task's. In 0.16.0, Zig removed `ucontext_t`, so students implement context switching using Zig's inline assembly, directly manipulating the stack pointer and instruction pointer. This is one of the most low-level exercises in the curriculum: students write assembly code that changes the thread of execution, and they understand exactly what a context switch is at the machine level.

---

## Module 7: Memory Management — The OS Perspective

The OS is responsible for managing physical memory: allocating it to processes, reclaiming it when processes exit, and providing the virtual memory abstraction that makes each process believe it has a large, private address space. This module covers virtual memory from the OS's perspective, complementing the programmer's perspective covered in Module 4.

### Page Tables and Address Translation

The virtual address space is divided into fixed-size pages (typically 4KB). The OS maintains a page table for each process mapping virtual page numbers to physical frame numbers. Address translation happens in hardware, assisted by the Translation Lookaside Buffer (TLB) — a cache of recent translations that avoids a full page table walk on every memory access.

Students implement a page table simulator in Zig. Given a sequence of virtual addresses and a page table, the simulator translates each address to a physical address (or reports a page fault for unmapped addresses), maintains a TLB, and reports hit and miss rates. This makes the abstract mechanism of virtual memory concrete and countable.

### Page Replacement

Physical memory is finite. When all physical frames are occupied and a new page must be brought in (from disk or from the binary), the OS must evict an existing page. The page replacement algorithm determines which page is evicted, and the choice has dramatic performance implications.

The optimal algorithm — OPT — evicts the page that will not be used for the longest time in the future. It is optimal but clairvoyant: it requires knowledge of future accesses that is not available at runtime. It is used as a baseline for evaluating practical algorithms.

**FIFO** evicts the oldest page. Simple. Has the counterintuitive property (Bélády's anomaly) that adding more physical memory can sometimes increase the page fault rate.

**LRU** (Least Recently Used) evicts the page that was accessed least recently, approximating OPT. Near-optimal in practice because temporal locality means recently used pages are likely to be used again soon. Expensive to implement precisely; approximate LRU (using a reference bit set by hardware) is used in real OSes.

**Clock** (Second-Chance) is an efficient approximation of LRU used in real operating systems. Students implement it and observe how closely it approximates LRU in practice.

### Memory-Mapped Files and Demand Paging

When the OS loads an executable, it does not read the entire binary into physical memory. It maps the binary's sections into the process's address space and pages them in on demand — only reading from disk when the program actually accesses a page. This is demand paging.

The same mechanism is available to programs directly through memory-mapped files: the program maps a file into its address space and the OS pages in file content as the program accesses it. Students use Zig's file system API to implement a memory-mapped file reader, observing how the OS turns file I/O into memory access.

---

## Module 8: Concurrency — Shared State and the Problems It Creates

Concurrency is one of the most difficult topics in systems programming. The bugs it creates are non-deterministic, reproducible only under specific timing conditions, and potentially catastrophic in production systems. This module confronts concurrency directly — not sanitizing it, but teaching the actual hazards and the actual tools for managing them.

### Threads

A thread is a unit of execution within a process. Threads in the same process share the same virtual address space, the same file descriptors, and the same global state. They each have their own stack and their own program counter. Creating a thread is cheaper than creating a process because there is no address space to copy.

Students create threads in Zig using `std.Thread`. They write a program where multiple threads each increment a shared counter, expect the result to be the number of threads times the number of increments per thread, and observe that the actual result is wrong — and different each time. This is the canonical demonstration of a race condition.

### Race Conditions and Data Races

A race condition occurs when the correctness of a computation depends on the relative timing of operations in multiple threads. A data race is a specific type of race condition: a non-atomic read-write or write-write of a shared variable without synchronization. Data races are undefined behavior in C and C++, and even in Zig they produce incorrect results.

The increment operation — read the current value, add one, write back — is not atomic. It is three separate machine instructions. Two threads executing this sequence concurrently can interleave their instructions in a way that causes one thread's increment to be lost. Students observe this interleaving by examining the assembly generated for the increment, confirming that it is indeed multiple instructions, and measuring the magnitude of the error produced by unprotected concurrent access.

### Mutexes

A mutex (mutual exclusion lock) serializes access to a critical section. Only one thread can hold the mutex at a time; other threads that attempt to acquire it block until it is released. Protecting the increment with a mutex makes it correct: the read-add-write sequence is now atomic from the perspective of other threads.

Students implement a correct concurrent counter using `std.Thread.Mutex`. They measure the throughput under different levels of contention and observe the overhead of mutex acquisition: uncontended mutex acquisition is fast (a few nanoseconds), but contended acquisition — where threads must wait — is expensive and adds latency.

They also observe mutex overhead in the context of false sharing: two variables that happen to share a cache line, protected by separate mutexes, still cause contention because modifying one variable invalidates the cache line for all other CPU cores that have it cached. The fix — padding variables to separate cache lines — demonstrates that understanding the memory hierarchy and understanding concurrency are inseparable.

### Condition Variables

Mutexes prevent concurrent access. Condition variables allow threads to wait for a condition to become true and to notify other threads when it does. Together they are the primitive building blocks for coordinating threads.

Students implement a producer-consumer queue using a mutex and condition variables. Producers add items to the queue and signal when items are available; consumers wait until items are available and remove them. This pattern is ubiquitous in systems software: it is the foundation of thread pools, event queues, and worker systems of every kind.

### Semaphores and Reader-Writer Locks

A semaphore is a generalization of a mutex: it allows up to N threads to access a resource simultaneously. A binary semaphore (N=1) is equivalent to a mutex. A counting semaphore allows N simultaneous readers, or coordinates access to a pool of N resources.

A reader-writer lock allows unlimited concurrent readers or one exclusive writer, but not both simultaneously. This is the right tool for data structures that are read frequently but written infrequently: using a plain mutex would serialize all readers, even though concurrent reads are safe.

Students implement both and understand their appropriate uses. They observe that reader-writer locks can cause writer starvation if there is a continuous stream of readers, and learn the strategies for preventing it.

### Deadlock

Deadlock occurs when two or more threads each hold a lock the other needs, and each waits for the other to release. The program hangs forever. Students produce a deadlock deliberately — two threads, two mutexes, each acquiring them in opposite order — then analyze the four conditions for deadlock (mutual exclusion, hold-and-wait, no preemption, circular wait) and implement the standard prevention: always acquire locks in the same order.

They also encounter livelock — threads actively running but making no progress, each yielding to the other in a cycle — and starvation, where a thread is perpetually bypassed by the scheduler or by lock acquisition logic.

### Atomics and Lock-Free Data Structures

Some operations can be made atomic by the hardware itself, without involving a mutex. x86-64 provides atomic read-modify-write instructions: compare-and-swap (CAS), fetch-and-add, and others. These are the primitives from which lock-free data structures are built.

Students use Zig's atomic operations (`@atomicRmw`, `@atomicLoad`, `@atomicStore`, `@cmpxchgStrong`) to implement a lock-free counter and a lock-free stack. They observe that lock-free does not mean contention-free — it means no blocking, but spinning on a CAS under high contention can be slower than a mutex.

They also encounter the ABA problem: a CAS succeeds even though the value has changed from A to B and back to A between the read and the compare, potentially invalidating an assumption made when the value was read. This is a subtle but important class of bug in lock-free code.

### The Memory Model and Ordering

Modern processors do not execute instructions in the order the programmer wrote them. They reorder memory operations for performance — executing independent operations out of order, buffering writes before they become visible to other processors. Compilers do the same. The result is that without explicit ordering constraints, concurrent code can observe memory in states that the programmer never intended.

The memory model defines the rules for what orderings are possible and how to constrain them. Zig's memory model aligns with LLVM's, which is based on C++11's. Students learn the ordering constraints — relaxed, acquire, release, sequentially consistent — and understand when each is appropriate. The lesson is that relaxed ordering is fast but dangerous; sequentially consistent ordering is safe but expensive; and the right choice depends on what invariants the code is trying to maintain.

---

## Module 9: File Systems and Persistence

Everything discussed so far is volatile: when the process exits or the power goes out, it is gone. File systems are how programs make data persist. They are also one of the most interesting and complex components of an operating system, because they must efficiently manage a storage medium that is orders of magnitude slower than memory.

### Storage Devices

Spinning hard drives read and write magnetic platters. The time to access data depends on where the read head is and how fast the platter rotates — seek time is typically 3-10ms, rotational latency another 3-5ms. Random access is much slower than sequential access, which motivates decades of file system design: how do you organize data on disk to minimize expensive seeks?

SSDs read and write flash memory. They have no moving parts, so seek time is irrelevant. But they have their own constraints: they write in pages (4-8KB), erase in blocks (128KB-1MB), and wear out after a limited number of erase cycles. These constraints shape SSD file system design.

Students implement a simple disk simulator in Zig that models the latency characteristics of both spinning disks and SSDs, and use it to evaluate the performance of different data layout strategies.

### File System Abstraction

The file system presents a directory hierarchy: a tree of directories, each containing files and other directories. Each file has a name (relative to its directory), a set of metadata (size, permissions, timestamps), and a contents (a sequence of bytes).

Beneath this abstraction is a complex implementation: the on-disk representation of the directory tree, the mapping from file offsets to disk blocks, the mechanisms for allocating and freeing disk blocks, the caching of recently accessed data in memory, and the strategies for ensuring that the file system remains consistent even when the system crashes in the middle of an operation.

Students implement a minimal file system in Zig operating on a simulated disk image. The file system supports a flat namespace (no directories, just files), stores files in fixed-size blocks, and maintains a free block list. This is not a production file system — it is a vehicle for understanding the core data structures: the superblock (file system metadata), inodes (per-file metadata and block pointers), and data blocks (the actual file content).

### Crash Consistency

A file system operation like "write data to a file and update its size" involves multiple disk writes. If the system crashes after some of those writes but before all of them, the file system ends up in an inconsistent state: the data was written but the size was not updated, or the size was updated but the data was not written, or the free block list does not match the allocated blocks.

Making file systems crash-consistent is a deep problem. The traditional solution is fsck — a repair tool that scans the entire file system after a crash and fixes inconsistencies. fsck is correct but slow: it must read every block on disk, which takes minutes on large file systems.

The modern solution is journaling (also called write-ahead logging): before making any update to the file system, write a description of the update to a dedicated journal region. When the journal entry is committed, apply the update to the actual file system. If the system crashes, the journal can be replayed to complete any interrupted operations. Students implement journaling in their simulated file system and verify that it maintains consistency across simulated crashes.

### I/O in Zig 0.16.0 — I/O as an Interface

Zig 0.16.0 introduced a fundamental redesign of the I/O system under the banner "I/O as an Interface." The old `GenericReader`, `AnyReader`, and `FixedBufferStream` types are gone. I/O is now built around `std.Io`, an interface that supports both synchronous and asynchronous operation and integrates with the new async primitives.

Students learn the new I/O model: how to read from and write to files, how buffering works, and how the interface design enables the same code to work with in-memory buffers, files, network sockets, and any other I/O source without modification. The key lesson is the value of abstraction in I/O: code that is written against the `std.Io` interface works identically regardless of what the actual I/O medium is.

---

# Section III: Concurrency at Scale

*The previous section covered concurrency within a single process on a single machine. This section extends that to the full complexity of production systems: multi-core parallelism, asynchronous I/O, and eventually distributed systems spanning multiple machines.*

---

## Module 10: Parallel Programming

Modern processors have multiple cores. A program that uses only one core leaves the remaining cores idle, which is waste. Parallel programming is the practice of structuring computations to use multiple cores simultaneously. It is harder than sequential programming because all the concurrency hazards from Module 8 apply, and because the performance behavior of parallel programs is counterintuitive in ways that require careful analysis.

### Data Parallelism

The simplest form of parallelism is data parallelism: the same operation applied independently to many elements of a collection. Because there are no dependencies between elements, any number of cores can process different elements simultaneously without synchronization.

Students implement parallel map and parallel reduce in Zig: splitting work across a configurable number of threads, executing it, and collecting the results. They vary the number of threads and the amount of work per element, measuring how speedup scales. They observe that for small amounts of work per element, the overhead of creating and synchronizing threads dominates and parallel is slower than sequential. The crossover point is a function of the work-per-element, the synchronization overhead, and the number of cores.

### Amdahl's Law

Amdahl's Law gives the theoretical maximum speedup achievable by parallelizing a program: if a fraction `p` of the program can be parallelized and the remaining `1-p` is inherently sequential, the maximum speedup from using infinite cores is `1/(1-p)`. If 20% of a program is sequential, the maximum speedup is 5x, regardless of how many cores you have.

Students measure this empirically: they construct programs with varying fractions of sequential and parallel work, run them with different numbers of threads, and plot actual speedup against Amdahl's prediction. The gap between actual and theoretical is itself informative — it reveals the overhead of synchronization and memory bandwidth contention.

### Work Stealing

A naive parallel implementation assigns work to threads statically — each thread gets a fixed subset of the work. This works well when all work items take the same time. When they don't — which is the common case — some threads finish early and sit idle while others are still working.

Work stealing solves this: each thread has a local deque of work items. When a thread's deque is empty, it steals items from the back of another thread's deque. This dynamic load balancing keeps all threads busy as long as there is work to be done.

Students implement a work-stealing thread pool in Zig. This is a non-trivial data structure: the local deque must be thread-safe, the stealing protocol must be lock-free or minimally locking to avoid adding back the overhead that work stealing is trying to eliminate. Students work through the Chase-Lev work-stealing deque algorithm, implement it, and measure its performance against a simpler mutex-protected global queue.

Note: Zig 0.16.0 removed `std.Thread.Pool` from the standard library. This means students must implement their own. This is the right outcome for a systems curriculum: building the thread pool from scratch is more educational than using a library.

### SIMD — Single Instruction, Multiple Data

Modern processors can apply a single instruction to multiple data values simultaneously using SIMD (Single Instruction, Multiple Data) registers. An AVX-512 instruction on a 512-bit register can perform 16 single-precision floating point operations in a single clock cycle. This is the mechanism behind the performance of numerical computing, image processing, and many other data-intensive applications.

Students use Zig's vector types and intrinsics to implement SIMD versions of array operations, measure the speedup against scalar implementations, and understand what the hardware is doing. They also observe that SIMD is not always a win: the overhead of loading and storing SIMD registers, alignment requirements, and the difficulty of expressing irregular computations in SIMD form mean that it is appropriate only for certain patterns of code.

---

## Module 11: Asynchronous I/O

Threads are an expensive way to handle I/O concurrency. Each thread consumes memory (for its stack, typically 1-8 MB), and context switching between threads has cost. When a server has thousands of clients, creating a thread per client does not scale.

Asynchronous I/O allows a single thread to manage many concurrent I/O operations: the thread initiates an I/O operation, registers to be notified when it completes, and immediately moves on to other work. When the OS signals that an I/O operation has completed, the thread handles the result and initiates the next operation.

### The Event Loop

An event loop is the mechanism at the center of asynchronous I/O. It waits for events — I/O completions, timers, signals — and dispatches handlers. The `epoll` system call on Linux (and `kqueue` on BSD/macOS, `io_uring` on modern Linux) allows a single thread to monitor thousands of file descriptors simultaneously, waking only when one is ready for I/O.

Students implement a simple event loop in Zig using `epoll`. The loop waits for events on a set of monitored file descriptors, dispatches callbacks when events occur, and manages a timer wheel for time-based events. This is the foundation of every high-performance server: nginx, Redis, Node.js, and countless other systems are built on this pattern.

### Zig's I/O Interface and Async Design

Zig 0.16.0's "I/O as an Interface" redesign is directly relevant here. The `std.Io` interface is designed to support both synchronous and asynchronous operation through the same API. The `Future` and `Group` types enable composition of asynchronous operations. Students use these primitives to build a concurrent file processor that reads multiple files simultaneously using a single thread, completing each in the order they finish rather than the order they were started.

### io_uring

`io_uring` is a Linux kernel interface (available since kernel 5.1) for high-performance asynchronous I/O. Unlike `epoll`, which notifies when an operation can be performed, `io_uring` submits operations to the kernel and receives completion notifications — more like Windows IOCP or macOS's GCD. It uses a ring buffer shared between user space and kernel space to minimize system call overhead.

Students implement a file reader using `io_uring` directly via Zig's `std.os.linux` interface, comparing its performance to the epoll-based event loop for the same workload. They observe that `io_uring` has significantly less overhead for high-throughput I/O because it can batch operations and reduce system call frequency.

---

## Module 12: Building a Real Concurrent System — A Network Server

Everything in this section comes together in a network server. A server is a concurrent system that accepts connections from multiple clients, processes their requests, and sends responses. It exercises process management, memory management, file I/O, and the concurrency primitives from Modules 8-11, all in a single application.

### TCP Sockets from First Principles

Students implement TCP communication starting from the system calls: `socket()`, `bind()`, `listen()`, `accept()`, `send()`, `recv()`, and `close()`. They understand what each call does, what errors it can produce, and how to handle partial sends and receives — a common source of bugs in network code.

They build a TCP echo server: accepts a connection, reads data from the client, sends it back, and repeats until the connection closes. This is simple enough to implement in a few hours but rich enough to expose the full TCP state machine.

### Multiplexing with epoll

The echo server handles one client at a time. To handle many clients simultaneously, students add `epoll` to monitor multiple connections. The server now accepts connections, adds them to the epoll set, and services whatever connection is ready when epoll returns. This transforms the server from sequential to concurrent without adding a single thread.

### Protocol Design and Parsing

Real servers don't exchange raw bytes — they exchange messages defined by a protocol. Students design a simple binary protocol (a length-prefixed framing format) and implement a state machine parser that handles partial reads — receiving only part of a message in a single `recv()` call.

This is the state machine from Section I applied to a real networking problem. The parser maintains state between calls, advances through the message header and body states as bytes arrive, and signals to the caller when a complete message has been received.

### The Finished Server

Students assemble the complete server: epoll-based multiplexing for connection management, the protocol parser for message framing, a thread pool for computationally expensive request handling (so that slow requests don't block the event loop), and a ring buffer for efficient buffering. The result is a production-quality server architecture — the same fundamental structure used by Redis, nginx, and most other high-performance network servers.

---

# Section IV: The Network

*Programs do not run in isolation. They communicate: with other programs on the same machine, with programs on other machines, with services across the internet. Understanding the network — how data moves, how protocols work, how the reliability of TCP is achieved on top of unreliable hardware — is essential for anyone who writes networked software.*

---

## Module 13: The Network Stack

The network is built in layers. Each layer provides a service to the layer above it and uses the services of the layer below it. This layering is not just organizational — it is the fundamental design decision that made the internet possible, because it means each layer can change its implementation without affecting the others.

### Physical and Link Layer

At the bottom is physical transmission: radio waves, light pulses, electrical signals. Above that is the link layer, which moves frames between directly connected devices. Ethernet is the dominant link layer technology in wired networks; 802.11 (Wi-Fi) in wireless networks.

Students don't implement link-layer protocols — that would require hardware. They do understand what a MAC address is, what a frame is, how ARP maps IP addresses to MAC addresses, and why the link layer matters for understanding the layers above it.

### IP — The Internet Layer

The Internet Protocol (IP) moves packets from source to destination across multiple networks. Each packet carries source and destination IP addresses. Routers examine the destination address and forward the packet toward its destination, one hop at a time, with no guarantee of delivery, ordering, or absence of duplication.

Students implement a basic IP packet parser in Zig: given the bytes of an IP packet, extract the header fields (version, header length, protocol, source address, destination address, TTL) and validate the checksum. This makes the protocol concrete — not an abstraction but a specific byte layout that the code must interpret.

They also implement a simple ICMP ping: construct an ICMP echo request packet, send it to a target address, and wait for the reply. This requires raw socket access — sending IP packets directly rather than through TCP or UDP — and reveals the structure of the network stack beneath the abstractions normally provided by the OS.

### UDP

UDP (User Datagram Protocol) is the simplest transport protocol: it adds port numbers (to address specific applications on a host) and a checksum to IP, and nothing else. No connection establishment, no reliability, no ordering guarantees. A UDP datagram may be lost, duplicated, or delivered out of order.

This simplicity is a feature for applications that need low latency and can tolerate some loss: DNS queries, NTP time synchronization, video streaming, and modern application-level protocols like QUIC all use UDP. Students implement a UDP echo server and client in Zig, and build a simple DNS resolver that sends queries and parses responses.

### TCP

TCP (Transmission Control Protocol) provides reliable, ordered delivery on top of unreliable IP. It achieves this through a connection-oriented design: before data can be exchanged, a three-way handshake establishes a connection. Every byte of data is sequenced. The receiver acknowledges received data; the sender retransmits unacknowledged data after a timeout. Flow control (the receiver advertises how much data it can accept) prevents the sender from overwhelming the receiver. Congestion control (the sender reduces its rate when it detects packet loss) prevents the sender from overwhelming the network.

Students implement a minimal TCP stack in Zig — not connected to real hardware, but implementing the state machine, sequence number tracking, acknowledgment logic, and basic retransmission. This is the most ambitious implementation in this section, but it is the one that makes TCP truly comprehensible. Students who have implemented even a simplified TCP understand what every networking textbook says, because they have lived through the edge cases.

### TLS

TCP gives reliable delivery. TLS (Transport Layer Security) adds confidentiality and authentication on top of TCP. Students do not implement TLS from scratch — cryptography is a specialized field and implementation errors are catastrophic — but they understand how it works: the handshake that establishes a shared secret using asymmetric cryptography, the symmetric encryption of application data, and the authentication of the server's identity through certificates.

They use Zig's standard library to establish TLS connections and understand what the library is doing on their behalf.

---

## Module 14: Protocol Design

Network protocols are the contracts between communicating systems. Designing a protocol well is a deep engineering skill: a protocol that is ambiguous, fragile, or inefficient will cause problems for the lifetime of the systems that use it.

### What Makes a Good Protocol

Good protocols share several properties. They are unambiguous: given a sequence of bytes, there is exactly one correct interpretation. They are extensible: new features can be added without breaking implementations that do not understand them. They are efficient: the overhead of framing, encoding, and parsing is low relative to the data being transmitted. They handle errors gracefully: malformed messages, unexpected states, and connection failures produce defined behavior rather than undefined behavior.

### Binary vs. Text Protocols

Text protocols (HTTP/1.1, SMTP, Redis RESP2) are human-readable, easy to debug with simple tools, but slower to parse. Binary protocols (gRPC/protobuf, FASP, DNS wire format) are compact and fast to parse, but require tooling to inspect. The choice depends on the use case: debugging ease matters in development, parsing efficiency matters under load.

Students implement both versions of the same protocol — a simple key-value store protocol — and benchmark the parsing overhead. They measure how much CPU time is spent parsing text headers versus binary headers under simulated load.

### State Machines as Protocol Parsers

Every protocol with multiple message types and connection state is a state machine. The connection is in a state; an incoming message is an input; the state machine produces a response and transitions to a new state. Students formalize the protocol they have designed as a state machine, implement it exhaustively using Zig's enum-based switch, and verify that the implementation correctly handles all valid inputs and rejects all invalid ones.

### Versioning and Backward Compatibility

A protocol deployed in production cannot be changed without careful planning. Clients running old code must continue to work after a server upgrade, and vice versa. Students design a versioning scheme for their protocol and implement a server that handles both the old and new protocol versions, routing to the appropriate handler based on the negotiated version.

---

# Section V: Distributed Systems

*A single machine, no matter how powerful, is finite. It has limited memory, limited compute, and it will eventually fail. Distributed systems spread work and data across multiple machines, achieving capacity, performance, and reliability that no single machine can provide. They are also dramatically more complex — and the complexity is inherent, not accidental.*

---

## Module 15: The Nature of Distributed Systems

A distributed system is a collection of computers that communicate over a network to provide a service that appears unified to its users. This definition conceals an enormous amount of complexity: the computers may fail independently, the network may drop or delay messages, clocks on different machines drift apart, and there is no global shared state.

### Why Distribution Is Hard

Building a distributed system requires abandoning assumptions that hold in single-machine programming. On a single machine, if you write a value to memory and then read it back, you get the value you wrote. In a distributed system, a value written on one machine may not be visible on another machine immediately — or ever, if the message carrying the write is lost.

On a single machine, if a function returns, it completed. In a distributed system, a message sent to another machine may be lost in transit: you do not know whether the remote operation completed, whether it failed, or whether it is still in progress. This is the fundamental difficulty of distributed systems, articulated by the two generals problem and the impossibility of distributed consensus in the presence of message loss.

Martin Kleppmann's formulation of the problem is useful: distributed systems must be designed under the assumption that any operation may fail in any of several ways — the message was lost before delivery, the message was delivered but the response was lost, the message was delivered after a long delay, the remote machine crashed midway through processing, or the remote machine recovered and re-processed the request.

### Fault Models

Not all failures are equal. The fault model specifies what kinds of failures a system must tolerate. The simplest is crash-stop: a failed machine stops permanently. More realistic is crash-recovery: a failed machine eventually restarts, potentially with its state intact. Most realistic is Byzantine: a failed machine may behave arbitrarily, including sending incorrect data. Designing for Byzantine faults is dramatically more expensive than designing for crash-stop, and most commercial distributed systems assume crash-recovery.

Network partitions — situations where the network splits into two groups that cannot communicate with each other — are also a form of failure that distributed systems must handle. The CAP theorem states that in the presence of network partitions, a distributed system cannot simultaneously provide both consistency (all nodes see the same data) and availability (every request receives a response). This is not a theorem about trade-offs to optimize; it is a fundamental impossibility result.

### Time and Clocks

Clocks on different machines drift apart. Without a global clock, events on different machines cannot be totally ordered by time alone. Distributed systems must reason about ordering without relying on synchronized clocks.

**Logical clocks** (Lamport clocks) assign sequence numbers to events such that if event A causally precedes event B, A's sequence number is less than B's. They do not capture all causal relationships — two events with incomparable sequence numbers might or might not be causally related.

**Vector clocks** solve this: each machine maintains a vector of sequence numbers, one per machine. A vector clock captures causality exactly: A causally precedes B if and only if A's vector is less than B's in every component.

Students implement both Lamport clocks and vector clocks in Zig, apply them to a simulated message-passing system, and use them to reconstruct the causal order of events in a distributed execution.

---

## Module 16: Replication and Consensus

Replication — storing the same data on multiple machines — is the primary tool for fault tolerance in distributed systems. If one replica fails, others can serve requests. But maintaining consistency across replicas when writes can go to any of them, and when replicas may fail and recover at any time, is one of the deepest problems in distributed systems.

### Single-Leader Replication

The simplest replication strategy designates one replica as the leader. All writes go to the leader, which replicates them to followers. Reads can be served by any replica (at the cost of possibly returning stale data) or only by the leader (at the cost of higher load and latency). If the leader fails, a new leader must be elected.

Students implement single-leader replication for a simple key-value store in Zig. The implementation must handle the case where a follower is behind the leader (replication lag) and the case where the leader fails and a follower must take over.

### Replication Lag and Read Anomalies

When a client writes to the leader and immediately reads from a follower, it may read a stale value — the follower has not yet received the write. This is called replication lag, and it produces anomalies that are surprising to users: a user posts a comment and immediately refreshes the page, but their comment does not appear.

Strong consistency (all reads see the most recent write) requires routing reads through the leader, which eliminates the performance benefit of followers. Eventual consistency (reads may return stale data, but all replicas eventually converge) provides better performance at the cost of more complex application logic. Students implement both and understand the tradeoff.

### Consensus Algorithms

Leader election — deciding which replica is the new leader after a failure — requires consensus: all non-failed replicas must agree on which replica was elected, and they must do so despite the possibility of message loss and further failures. This is the consensus problem, and it is one of the most studied problems in distributed systems.

Students study the Raft consensus algorithm, which was designed specifically to be understandable. Raft decomposes consensus into three sub-problems: leader election, log replication, and safety. Students implement a simplified version of the Raft leader election protocol in Zig, handling normal operation and the case where the leader fails and a new election must be held.

---

## Module 17: Consistency, Transactions, and the Tradeoffs of Scale

Real distributed systems make explicit choices about the consistency guarantees they provide. These choices have direct consequences for correctness, performance, and operational complexity.

### Linearizability

Linearizability (also called strong consistency or atomic consistency) is the strongest consistency model for single-object operations: a linearizable system behaves as if there is a single copy of the data and all operations on it happen atomically at some point between their start and end. If a write completes, all subsequent reads must return the written value.

Linearizability is expensive: every operation must coordinate across replicas before completing. It is incompatible with availability during network partitions (the C in CAP). But for operations where correctness is critical — account balances, inventory counts, distributed locks — linearizability is the right choice.

### Serializability

Serializability is the consistency model for transactions: a database that executes transactions serializably behaves as if transactions execute one at a time in some serial order, even if they actually execute concurrently. It prevents all the anomalies that concurrent transactions can produce (dirty reads, non-repeatable reads, phantom reads).

Two-phase locking (2PL) is the classic algorithm for achieving serializability: a transaction acquires a lock on every data item it accesses before it can proceed. This prevents conflicting concurrent accesses at the cost of reduced concurrency and potential deadlock.

Students implement a simple transactional key-value store in Zig that uses two-phase locking, and observe how it handles conflicting transactions.

### Distributed Transactions — Two-Phase Commit

A transaction that spans multiple machines requires a protocol to ensure that all machines either commit or abort. Two-phase commit (2PC) is the standard protocol: a coordinator sends a "prepare" message to all participants; each participant votes "yes" or "no"; if all vote yes, the coordinator sends "commit"; otherwise it sends "abort".

2PC has a serious limitation: if the coordinator fails after sending "prepare" but before sending "commit" or "abort", the participants are blocked — they cannot commit (because they don't know if all participants voted yes) and they cannot abort (because the coordinator might have sent "commit" to some participants before failing). Students implement 2PC and observe this blocking behavior, then study the practical mitigations: timeouts, recovery logs, and three-phase commit.

### Eventual Consistency and CRDTs

For systems where availability matters more than strong consistency — collaborative text editing, distributed counters, shopping carts — eventual consistency is the right model: all replicas eventually converge to the same value if no new writes arrive, but replicas may diverge temporarily.

CRDTs (Conflict-free Replicated Data Types) are data structures designed for eventual consistency: all concurrent updates can be merged automatically without conflict resolution logic. A CRDT counter allows concurrent increments on different replicas that will always merge correctly. Students implement a grow-only counter, a PN-counter (positive/negative, supporting both increment and decrement), and a last-write-wins register, observing how each handles concurrent updates.

---

## Module 18: Systems Design Under Load

Real distributed systems must handle load that exceeds what a single machine can serve. This module covers the tools and patterns for scaling: caching, sharding, load balancing, and the design of systems that degrade gracefully under overload.

### Caching

Caching stores the results of expensive computations or lookups so that future requests for the same data can be served faster. A cache hit avoids the cost of the underlying operation; a cache miss incurs both the cost of the underlying operation and the cost of updating the cache.

Cache invalidation — determining when a cached value is no longer valid — is one of the two hard problems in computer science. Students implement a cache in Zig with TTL-based expiration, LRU eviction, and explicit invalidation, and reason about the consistency properties of each strategy.

They observe the difference between a read-through cache (the cache is transparent, misses are automatically filled from the source), a write-through cache (writes update both the cache and the source simultaneously), and a write-back cache (writes update the cache immediately and the source lazily).

### Sharding

A single database server eventually hits its capacity limit. Sharding splits the data across multiple servers, each responsible for a subset. The sharding key determines which server owns which data: a hash of the user ID, a range of creation timestamps, or a geographic region.

Students design a sharded key-value store in Zig: a client-side routing layer that maps keys to shards, multiple shard servers, and a rebalancing protocol that handles the addition and removal of shards without downtime. They observe the challenge of cross-shard operations — queries that access data on multiple shards — and understand why sharding forces application design changes.

### Backpressure and Load Shedding

A system under overload has two options: accept all requests and degrade for everyone, or reject some requests and maintain acceptable quality for the rest. Backpressure — signaling to callers that the system is at capacity — allows the system to regulate its own load. Load shedding — deliberately dropping requests when the system is overloaded — protects the system from collapse.

Students implement both patterns in their network server: a bounded request queue that provides backpressure when full, and a load shedding strategy that drops the newest requests (to keep latency for existing requests bounded) when the queue is full.

---

# Final Capstone: Build a Distributed Key-Value Store

The final capstone integrates every concept from the curriculum into a single, non-trivial distributed system.

Students build a distributed key-value store that is persistent, replicated, and consistent. The system consists of multiple server nodes and a client library. It handles node failures, network partitions, and client disconnections gracefully.

### What the System Does

The key-value store supports three operations: `put(key, value)`, `get(key) → value`, and `delete(key)`. Keys and values are arbitrary byte strings. The store is replicated across three nodes. Writes are accepted by the leader node and replicated to followers before being acknowledged. Reads are served by any node. The system tolerates the failure of one node while remaining available.

### The Architecture

**The storage engine** is an append-only log with an in-memory index — a simplified version of the LSM tree structure used in LevelDB and RocksDB. Every write appends a new entry to the log; the index maps keys to their most recent log entries. Compaction periodically rewrites the log to remove superseded entries.

**The replication layer** implements Raft leader election and log replication. The leader appends writes to its log and sends them to followers. An entry is committed when a majority of nodes have acknowledged it. Committed entries are applied to the storage engine. If the leader fails, the Raft election protocol elects a new leader without data loss.

**The network layer** uses the binary protocol and TCP server architecture from Sections III and IV. Clients connect to any node; if they connect to a follower, the follower redirects them to the leader. The server uses epoll-based multiplexing to handle multiple clients simultaneously.

**The client library** handles connection management, request retries, and leader redirection transparently. Clients do not need to know which node is the leader.

### What Students Demonstrate

Every section of the curriculum is present in the final capstone:

- Binary data representation in the storage engine's log format
- Machine-level understanding in the protocol parser's bit manipulation
- Memory management through explicit allocators throughout
- Process model in the multi-process server architecture
- Scheduling in the thread pool and event loop
- File system knowledge in the storage engine's persistence layer
- Concurrency in the replication layer and the network server
- Parallel programming in the compaction process
- Asynchronous I/O in the network layer
- Network protocols in the client-server communication
- Distributed systems in the Raft replication and consistency guarantees

The capstone is presented not as a code walkthrough but as a systems design discussion: what design decisions were made, what the performance characteristics are under different failure scenarios, and what would change if the system needed to scale to ten nodes instead of three.

---

## Where This Leads

This curriculum is a foundation, not a destination. A student who completes it has the conceptual and practical depth to go anywhere in systems:

**Compilers** — understanding the machine, the ISA, and memory management are prerequisites for compiler work. The next step is studying intermediate representations, optimization passes, and code generation.

**Database engines** — the storage engine in the capstone is a simplified version of a real database storage layer. The next step is transaction processing, query optimization, and the design of OLAP versus OLTP systems.

**Operating system development** — the curriculum covers the OS from the outside. The next step is to go inside: kernel development, writing device drivers, implementing a hypervisor.

**Network infrastructure** — the curriculum covers the network stack conceptually. The next step is load balancer design, protocol implementation at scale, and the design of network-level systems like CDNs and anycast routing.

**Embedded systems** — the curriculum's treatment of memory, allocation, and the hardware-software interface applies directly to embedded targets. The next step is hardware interfacing, RTOS design, and the specific constraints of resource-constrained devices.

**Security** — understanding the machine at the level this curriculum demands is the prerequisite for systems security: understanding what buffer overflows actually do, how privilege escalation works, what memory safety bugs mean at the machine level, and how to build systems that are resistant to these attacks.

The common thread is Zig. The language learned in this curriculum is not a toy, not a teaching language, and not a language that will be left behind. It is a production systems language used in real software. The skills built here are directly applicable.

---

*This curriculum is designed for anyone serious about systems programming — the kind of depth that takes most working engineers a decade to accumulate, built in one coherent arc. The only prerequisite is the willingness to go deep.*
