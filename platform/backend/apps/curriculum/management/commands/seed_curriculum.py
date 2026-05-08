from django.core.management.base import BaseCommand
from django.utils.text import slugify
from apps.curriculum.models import Section, Module, LearningObjective

CURRICULUM = [
    {
        "number": 1,
        "title": "The Machine",
        "modules": [
            {
                "number": 1,
                "title": "How Computers Represent Everything",
                "file": "module1_how_computers_represent_everything.md",
                "objectives": [
                    "Convert integers between binary, hexadecimal, and decimal representations fluently",
                    "Explain two's complement representation and implement arithmetic aware of its properties",
                    "Describe the structure of an IEEE 754 floating point number and explain representation error",
                    "Use Zig's type system to reason about integer width, signedness, and overflow behavior",
                    "Inspect memory layout of Zig structs using @sizeOf, @alignOf, and @offsetOf",
                    "Explain alignment and padding and why they exist",
                    "Implement correct floating point comparison accounting for representation error",
                    "Implement basic UTF-8 string operations handling multi-byte characters correctly",
                ],
            },
            {
                "number": 2,
                "title": "How the Processor Works",
                "file": "module2_how_the_processor_works.md",
                "objectives": [
                    "Read x86-64 assembly output from the Zig compiler for basic functions",
                    "Explain pipelining and identify data and control hazards",
                    "Measure the cost of branch misprediction in a benchmark",
                    "Describe the memory hierarchy and explain cache locality",
                    "Implement a cache simulator in Zig",
                ],
            },
            {
                "number": 3,
                "title": "How Programs Actually Run",
                "file": "module3_how_programs_actually_run.md",
                "objectives": [
                    "Trace the full path from Zig source to running process",
                    "Use objdump and readelf to inspect ELF binary structure",
                    "Use strace to observe system calls at process startup",
                    "Write a minimal Zig program that issues syscalls directly",
                    "Explain the difference between static and dynamic linking",
                ],
            },
            {
                "number": 4,
                "title": "Memory — Ownership, Allocation, and the Cost of Getting It Wrong",
                "file": "module4_memory.md",
                "objectives": [
                    "Describe the process memory model: code, data, stack, and heap regions",
                    "Explain stack lifetime and identify dangling pointer patterns",
                    "Use Zig's allocator model: DebugAllocator, ArenaAllocator, FixedBufferAllocator",
                    "Implement a dynamic array from scratch with correct ownership",
                    "Explain virtual memory and implement memory-mapped file I/O",
                ],
            },
        ],
    },
    {
        "number": 2,
        "title": "The Operating System",
        "modules": [
            {
                "number": 5,
                "title": "Processes — The Illusion of Exclusive Control",
                "file": "module5_state_machines.md",
                "objectives": [
                    "Explain what a process is and what it owns",
                    "Implement fork/exec to create child processes in Zig",
                    "Build a minimal shell: read, fork, exec, wait",
                    "Explain context switching cost and measure it",
                    "Handle UNIX signals in a Zig program",
                ],
            },
            {
                "number": 6,
                "title": "The Memory Hierarchy and Why Locality Matters",
                "file": "module6_memory_hierarchy.md",
                "objectives": [
                    "Explain the memory hierarchy from registers to disk",
                    "Demonstrate cache-friendly vs cache-hostile access patterns",
                    "Measure the performance difference of row-major vs column-major traversal",
                    "Implement a cache simulator in Zig",
                ],
            },
            {
                "number": 7,
                "title": "Resource Allocation and Scheduling",
                "file": "module7_scheduling.md",
                "objectives": [
                    "Explain preemptive and cooperative scheduling",
                    "Implement FIFO, SJF, and Round Robin schedulers in Zig",
                    "Measure turnaround time, waiting time, and response time",
                    "Explain priority inversion and how to prevent it",
                ],
            },
            {
                "number": 8,
                "title": "Parallelism and Concurrency",
                "file": "module8_concurrency.md",
                "objectives": [
                    "Precisely distinguish concurrency from parallelism",
                    "Create threads in Zig and share data between them correctly",
                    "Demonstrate a race condition and fix it with a mutex",
                    "Use std.Thread.Mutex, RwLock, and Semaphore correctly",
                    "Implement a thread-safe bounded queue",
                    "Implement a thread pool",
                ],
            },
            {
                "number": 9,
                "title": "File Systems and Persistence",
                "file": "module9_file_systems.md",
                "objectives": [
                    "Explain inode-based file system structure",
                    "Explain journaling and write-ahead logging",
                    "Implement a write-ahead log in Zig",
                    "Use mmap for efficient file I/O",
                    "Explain fsync and durability guarantees",
                ],
            },
        ],
    },
    {
        "number": 3,
        "title": "Performance and I/O",
        "modules": [
            {
                "number": 10,
                "title": "Performance Evaluation and Measurement",
                "file": "module10_performance.md",
                "objectives": [
                    "Write statistically sound microbenchmarks in Zig",
                    "Use perf to identify CPU bottlenecks",
                    "Profile memory allocation patterns",
                    "Identify and eliminate false sharing in concurrent code",
                    "Read and interpret flame graphs",
                ],
            },
            {
                "number": 11,
                "title": "Asynchronous I/O",
                "file": "module11_async_io.md",
                "objectives": [
                    "Explain the difference between blocking, non-blocking, and async I/O",
                    "Build an event loop using epoll in Zig",
                    "Handle thousands of concurrent connections in a single thread",
                    "Explain io_uring and its advantages over epoll",
                ],
            },
        ],
    },
    {
        "number": 4,
        "title": "Networking",
        "modules": [
            {
                "number": 12,
                "title": "Building a Real Concurrent System — A Network Server",
                "file": "module12_network_server.md",
                "objectives": [
                    "Build a TCP echo server in Zig",
                    "Handle concurrent connections with a thread pool",
                    "Handle concurrent connections with an event loop",
                    "Measure and compare throughput and latency of both approaches",
                ],
            },
            {
                "number": 13,
                "title": "The Network Stack",
                "file": "module13_network_stack.md",
                "objectives": [
                    "Explain the layers of the TCP/IP stack",
                    "Parse Ethernet, IP, and TCP headers from raw bytes in Zig",
                    "Explain the TCP handshake and state machine",
                    "Use raw sockets to send and receive packets",
                ],
            },
            {
                "number": 14,
                "title": "Protocol Design",
                "file": "module14_protocol_design.md",
                "objectives": [
                    "Design a binary protocol with length-prefixed framing",
                    "Implement a protocol parser that handles partial reads",
                    "Design protocol versioning for forward and backward compatibility",
                    "Implement a request/response protocol in Zig",
                ],
            },
        ],
    },
    {
        "number": 5,
        "title": "Distributed Systems",
        "modules": [
            {
                "number": 15,
                "title": "The Nature of Distributed Systems",
                "file": "module15_distributed_systems.md",
                "objectives": [
                    "Explain the eight fallacies of distributed computing",
                    "Distinguish between fail-stop, crash-recovery, and Byzantine failures",
                    "Explain the CAP theorem and its practical implications",
                    "Implement a failure detector in Zig",
                ],
            },
            {
                "number": 16,
                "title": "Replication and Consensus — Implementing Raft",
                "file": "module16_raft.md",
                "objectives": [
                    "Explain why consensus is required for replicated state machines",
                    "Implement Raft leader election in Zig",
                    "Implement Raft log replication in Zig",
                    "Handle network partitions correctly in the Raft implementation",
                    "Pass the Raft TLA+ specification's key safety properties",
                ],
            },
            {
                "number": 17,
                "title": "Consistency, Transactions, and the Tradeoffs of Scale",
                "file": "module17_consistency_transactions.md",
                "objectives": [
                    "Explain isolation levels: read uncommitted through serializable",
                    "Implement MVCC (multi-version concurrency control) in Zig",
                    "Explain two-phase locking and optimistic concurrency control",
                    "Implement a simple transaction log",
                ],
            },
            {
                "number": 18,
                "title": "Systems Design Under Load",
                "file": "module18_systems_design.md",
                "objectives": [
                    "Implement a token bucket rate limiter in Zig",
                    "Implement a circuit breaker in Zig",
                    "Explain consistent hashing and implement a ring",
                    "Design a system to handle 10x expected load",
                ],
                "is_capstone": True,
            },
        ],
    },
]

FINAL_CAPSTONE = {
    "number": 19,
    "title": "Capstone: Build ZigKV — A Distributed Key-Value Store",
    "file": "capstone_distributed_kv.md",
    "is_capstone": True,
    "objectives": [
        "Accept connections from any Redis client using the RESP protocol",
        "Replicate writes across a 3-node cluster using Raft consensus",
        "Persist data to disk and recover correctly after a crash",
        "Handle node failures and network partitions gracefully",
        "Serve 50,000+ operations per second on a three-node cluster",
        "Document all architectural decisions and tradeoffs",
    ],
}


class Command(BaseCommand):
    help = "Seed the database with all 18 curriculum modules and the ZigKV capstone"

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing data before seeding")

    def handle(self, *args, **options):
        if options["reset"]:
            Section.objects.all().delete()
            self.stdout.write("Existing curriculum data deleted.")

        for section_data in CURRICULUM:
            section, created = Section.objects.get_or_create(
                number=section_data["number"],
                defaults={
                    "title": section_data["title"],
                    "slug": slugify(section_data["title"]),
                },
            )
            action = "Created" if created else "Found"
            self.stdout.write(f"{action} section {section.number}: {section.title}")

            for mod_data in section_data["modules"]:
                is_capstone = mod_data.get("is_capstone", False)
                module, _ = Module.objects.get_or_create(
                    number=mod_data["number"],
                    defaults={
                        "section": section,
                        "title": mod_data["title"],
                        "slug": slugify(f"module-{mod_data['number']}-{mod_data['title']}"),
                        "content_file": mod_data["file"],
                        "order": mod_data["number"],
                        "is_capstone": is_capstone,
                    },
                )

                for i, obj_text in enumerate(mod_data.get("objectives", []), start=1):
                    LearningObjective.objects.get_or_create(
                        module=module,
                        order=i,
                        defaults={"text": obj_text},
                    )

                self.stdout.write(f"  Module {module.number}: {module.title}")

        # Final capstone lives in its own section
        capstone_section, _ = Section.objects.get_or_create(
            number=6,
            defaults={"title": "Final Capstone", "slug": "final-capstone"},
        )
        capstone_module, _ = Module.objects.get_or_create(
            number=FINAL_CAPSTONE["number"],
            defaults={
                "section": capstone_section,
                "title": FINAL_CAPSTONE["title"],
                "slug": "capstone-zigkv",
                "content_file": FINAL_CAPSTONE["file"],
                "order": FINAL_CAPSTONE["number"],
                "is_capstone": True,
            },
        )
        for i, obj_text in enumerate(FINAL_CAPSTONE["objectives"], start=1):
            LearningObjective.objects.get_or_create(
                module=capstone_module,
                order=i,
                defaults={"text": obj_text},
            )
        self.stdout.write(f"  Capstone: {capstone_module.title}")

        self.stdout.write(self.style.SUCCESS("Curriculum seeded successfully."))
