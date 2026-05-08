# Module 7: Resource Allocation and Scheduling

## The Craft of Systems Programming — Teaching Material

---

> *"The scheduler is the most consequential piece of software most people have never thought about. Every response time, every stall, every dropped frame traces back to a decision made in a few hundred nanoseconds by code that decides who runs next."*

---

## Before You Begin

Every module so far has focused on a single program — its data, its execution, its memory, its state. This module widens the lens. The CPU is one physical resource, and many programs want it simultaneously. The operating system must decide which program runs when, for how long, and on which core. That decision is scheduling.

Scheduling is deceptively simple to describe and genuinely difficult to get right. The right policy for one workload is the wrong policy for another. A scheduler that minimizes average completion time may starve long-running tasks. A scheduler that is fair may be slow. The tradeoffs are fundamental, not accidental.

By the end of this module, you will have implemented five scheduling algorithms from scratch, measured their behavior on realistic workloads, built a cooperative task scheduler with real context switching using Zig inline assembly, and understood how Linux's Completely Fair Scheduler approaches the problem at the production level.

---

## Learning Objectives

By the end of this module, you will be able to:

- Define the five core scheduling metrics: CPU utilization, throughput, turnaround time, waiting time, and response time
- Implement and simulate FCFS, SJF, STCF, Round Robin, and MLFQ scheduling algorithms
- Calculate all five metrics for a given workload under each algorithm and compare them
- Explain what starvation is and which algorithms are susceptible to it
- Explain the convoy effect and which algorithms exhibit it
- Implement a cooperative task scheduler with context switching using Zig inline assembly
- Explain what the Linux Completely Fair Scheduler (CFS) does and how it uses a red-black tree
- Measure and explain the cost of a context switch on your machine
- Implement a work-stealing thread pool and explain why it outperforms a shared-queue pool under imbalanced workloads

---

## Part 1: The Scheduling Problem

### 1.1 Why Scheduling Exists

A modern computer runs dozens of processes simultaneously: your text editor, your browser, background services, the window manager, network daemons. But a physical CPU can only execute one instruction stream at a time (per core). The illusion of simultaneous execution is created by switching the CPU rapidly between processes — so fast that each process appears to make continuous progress.

The **scheduler** is the OS component that decides which process runs next when the CPU becomes available. The CPU becomes available when:
- The running process calls a blocking system call (waiting for I/O)
- A timer interrupt fires (the process has used its time quantum)
- The running process exits
- A higher-priority process becomes runnable

The scheduler must make this decision in microseconds. It runs more frequently than any other piece of kernel code. Its cumulative effect — over billions of scheduling decisions per day on a busy server — determines the system's responsiveness, fairness, and throughput.

### 1.2 The Five Metrics

Every scheduling algorithm makes tradeoffs. To compare them objectively, you need precise metrics.

**CPU Utilization:** The fraction of time the CPU is executing useful work (not idle). Maximized by keeping the CPU busy whenever there is work to do.

```
CPU Utilization = (time CPU is busy) / (total elapsed time)
```

**Throughput:** The number of processes completed per unit time. Higher is better for batch workloads.

```
Throughput = (number of processes completed) / (total elapsed time)
```

**Turnaround Time:** The total time from when a process arrives until it completes. Includes all waiting time.

```
Turnaround Time = Completion Time - Arrival Time
```

**Waiting Time:** The total time a process spends in the ready queue — not running, not waiting for I/O, just waiting for the CPU. This is what the scheduling algorithm directly controls.

```
Waiting Time = Turnaround Time - Burst Time
(where Burst Time is the total CPU time the process needs)
```

**Response Time:** The time from when a process first arrives until it first gets the CPU. Critical for interactive systems — this is what determines how quickly the system feels.

```
Response Time = First Run Time - Arrival Time
```

These metrics trade off against each other. Minimizing average turnaround time often means running the shortest jobs first, which can starve long jobs. Minimizing response time means giving every job a turn quickly, which may increase average turnaround time.

### 1.3 Workload Assumptions

To analyze scheduling algorithms, you need a model of the workload. Start with simplifying assumptions:

1. Each process runs for a known duration (the burst time)
2. All processes arrive at the same time (arrival time = 0)
3. Once started, a process runs to completion (non-preemptive)
4. The CPU is the only resource

We will relax each assumption as we introduce more sophisticated algorithms.

---

## Part 2: The Scheduling Simulator

Before implementing any algorithm, build the simulation infrastructure. Every algorithm in this module will be evaluated using the same simulator.

```zig
const std = @import("std");

pub const Process = struct {
    pid: u32,
    name: []const u8,
    arrival_time: u64,  // when the process enters the ready queue
    burst_time: u64,    // total CPU time needed

    // Computed by the simulator
    start_time: u64,    // when it first gets the CPU
    finish_time: u64,   // when it completes
    waiting_time: u64,  // time in ready queue
    turnaround_time: u64,
    response_time: u64,
};

pub const ScheduleEvent = struct {
    time: u64,
    pid: u32,
    event: enum { start, preempt, resume, finish },
};

pub const SimResult = struct {
    events: []ScheduleEvent,
    metrics: struct {
        avg_turnaround: f64,
        avg_waiting: f64,
        avg_response: f64,
        throughput: f64,
        cpu_utilization: f64,
    },
};

/// Pretty-print a Gantt chart of scheduling events
pub fn print_gantt(events: []const ScheduleEvent,
                   processes: []const Process) void {
    std.debug.print("\nGantt Chart:\n", .{});
    std.debug.print(" 0", .{});

    var prev_time: u64 = 0;
    for (events) |ev| {
        if (ev.time > prev_time) {
            // Find which process was running
            std.debug.print("---P{d}---", .{ev.pid});
            prev_time = ev.time;
        }
        std.debug.print("{d}", .{ev.time});
    }
    std.debug.print("\n\n", .{});

    // Print per-process metrics
    std.debug.print("{s:<10} {s:>8} {s:>8} {s:>8} {s:>8} {s:>10}\n",
        .{"Process", "Burst", "Start", "Finish", "Wait", "Turnaround"});
    std.debug.print("{s:-<60}\n", .{""});

    var total_tat: u64 = 0;
    var total_wt: u64 = 0;
    var total_rt: u64 = 0;

    for (processes) |p| {
        std.debug.print("{s:<10} {d:>8} {d:>8} {d:>8} {d:>8} {d:>10}\n", .{
            p.name,
            p.burst_time,
            p.start_time,
            p.finish_time,
            p.waiting_time,
            p.turnaround_time,
        });
        total_tat += p.turnaround_time;
        total_wt += p.waiting_time;
        total_rt += p.response_time;
    }

    const n: f64 = @floatFromInt(processes.len);
    std.debug.print("\nAverage turnaround: {d:.2}\n",
        .{@as(f64, @floatFromInt(total_tat)) / n});
    std.debug.print("Average waiting:    {d:.2}\n",
        .{@as(f64, @floatFromInt(total_wt)) / n});
    std.debug.print("Average response:   {d:.2}\n",
        .{@as(f64, @floatFromInt(total_rt)) / n});
}

/// Compute metrics for a set of completed processes
pub fn compute_metrics(processes: []const Process, total_time: u64) void {
    var total_burst: u64 = 0;
    for (processes) |p| total_burst += p.burst_time;

    const utilization = @as(f64, @floatFromInt(total_burst)) /
                        @as(f64, @floatFromInt(total_time)) * 100.0;
    const throughput = @as(f64, @floatFromInt(processes.len)) /
                       @as(f64, @floatFromInt(total_time));

    std.debug.print("CPU utilization: {d:.1}%\n", .{utilization});
    std.debug.print("Throughput:      {d:.3} processes/unit\n", .{throughput});
}
```

---

## Part 3: First-Come First-Served (FCFS)

### 3.1 The Algorithm

FCFS is the simplest possible scheduling policy: processes get the CPU in the order they arrive. The ready queue is a FIFO. Once a process starts, it runs to completion (non-preemptive).

```zig
/// FCFS: sort by arrival time, run each to completion
pub fn schedule_fcfs(processes: []Process) void {
    // Sort by arrival time (stable sort preserves order of ties)
    std.mem.sort(Process, processes, {}, struct {
        fn lessThan(_: void, a: Process, b: Process) bool {
            return a.arrival_time < b.arrival_time;
        }
    }.lessThan);

    var current_time: u64 = 0;

    for (processes) |*p| {
        // If CPU is idle, advance to process arrival
        if (current_time < p.arrival_time) {
            current_time = p.arrival_time;
        }

        p.start_time      = current_time;
        p.response_time   = current_time - p.arrival_time;
        p.waiting_time    = current_time - p.arrival_time;

        current_time += p.burst_time;

        p.finish_time     = current_time;
        p.turnaround_time = current_time - p.arrival_time;
    }
}
```

### 3.2 The Convoy Effect

FCFS suffers from the **convoy effect**: if a long process arrives before short processes, the short processes must wait for the long one to finish. This is devastating for interactive workloads.

Consider this workload:

| Process | Arrival | Burst |
|---------|---------|-------|
| P1      | 0       | 100   |
| P2      | 1       | 5     |
| P3      | 2       | 5     |

Under FCFS:
- P1 runs from 0 to 100
- P2 runs from 100 to 105 — waited 99 time units for a 5-unit job
- P3 runs from 105 to 110 — waited 103 time units for a 5-unit job

Average waiting time: (0 + 99 + 103) / 3 = **67.3 units**

P2 and P3 are waiting for a process that arrived 1 and 2 units before them respectively. The convoy forms behind P1, just like cars stacking up behind a slow truck on a highway.

```zig
pub fn demonstrate_convoy_effect() void {
    var procs = [_]Process{
        .{ .pid=1, .name="P1 (long)",  .arrival_time=0, .burst_time=100,
           .start_time=0, .finish_time=0, .waiting_time=0,
           .turnaround_time=0, .response_time=0 },
        .{ .pid=2, .name="P2 (short)", .arrival_time=1, .burst_time=5,
           .start_time=0, .finish_time=0, .waiting_time=0,
           .turnaround_time=0, .response_time=0 },
        .{ .pid=3, .name="P3 (short)", .arrival_time=2, .burst_time=5,
           .start_time=0, .finish_time=0, .waiting_time=0,
           .turnaround_time=0, .response_time=0 },
    };

    std.debug.print("=== FCFS: Convoy Effect Demo ===\n", .{});
    schedule_fcfs(&procs);
    print_gantt(&[_]ScheduleEvent{}, &procs);
    compute_metrics(&procs, procs[procs.len-1].finish_time);
}
```

---

## Part 4: Shortest Job First (SJF) and STCF

### 4.1 Shortest Job First

SJF always runs the process with the shortest remaining burst time. It is provably optimal for average turnaround time when all processes arrive simultaneously. The intuition: running short jobs first gets more jobs done sooner.

```zig
/// SJF (non-preemptive): among available processes, run shortest first
pub fn schedule_sjf(processes: []Process) void {
    var remaining = std.ArrayList(*Process).init(std.heap.page_allocator);
    defer remaining.deinit();
    for (processes) |*p| remaining.append(p) catch unreachable;

    var current_time: u64 = 0;

    while (remaining.items.len > 0) {
        // Find the shortest job available at current_time
        var best_idx: usize = 0;
        var best_burst: u64 = std.math.maxInt(u64);

        for (remaining.items, 0..) |p, i| {
            if (p.arrival_time <= current_time and p.burst_time < best_burst) {
                best_burst = p.burst_time;
                best_idx = i;
            }
        }

        const p = remaining.swapRemove(best_idx);

        // Advance time if CPU was idle
        if (current_time < p.arrival_time) current_time = p.arrival_time;

        p.start_time      = current_time;
        p.response_time   = current_time - p.arrival_time;
        p.waiting_time    = current_time - p.arrival_time;

        current_time += p.burst_time;

        p.finish_time     = current_time;
        p.turnaround_time = current_time - p.arrival_time;
    }
}
```

SJF on the convoy example:

| Process | Arrival | Burst | Start | Finish | Wait | TAT |
|---------|---------|-------|-------|--------|------|-----|
| P2      | 1       | 5     | 1     | 6      | 0    | 5   |
| P3      | 2       | 5     | 6     | 11     | 4    | 9   |
| P1      | 0       | 100   | 11    | 111    | 11   | 111 |

Wait: P1 arrives at 0, P2 at 1 — SJF can start P1 at 0 since it's the only process. But if P2 and P3 arrive before P1 is dispatched... Actually with all processes available at t=0 for same-time arrival, SJF runs P2(5), then P3(5), then P1(100). Average waiting = (0 + 5 + 10) / 3 = **5 units** vs 67.3 for FCFS.

### 4.2 The Oracle Problem

SJF has one fatal flaw: it requires knowing job lengths in advance. In a real OS, you do not know how long a process will run before it terminates or blocks for I/O.

Real schedulers approximate SJF using exponential averaging — estimating the next burst based on past behavior:

```
predicted_next_burst = α × actual_last_burst + (1-α) × predicted_last_burst
```

where α is typically 0.5. This gives more weight to recent behavior: a CPU-bound job that historically uses full time quanta is predicted to continue doing so; a job that frequently yields early is predicted to do so again.

### 4.3 Shortest Time to Completion First (STCF)

STCF (also called Preemptive SJF or SRTF) extends SJF with preemption: whenever a new process arrives, if its burst time is less than the remaining burst time of the currently-running process, the running process is preempted.

```zig
/// STCF: preemptive SJF — always run process with least remaining time
pub fn schedule_stcf(processes_in: []const Process,
                     allocator: std.mem.Allocator) ![]Process {
    var procs = try allocator.alloc(Process, processes_in.len);
    @memcpy(procs, processes_in);

    // Track remaining burst time separately
    var remaining = try allocator.alloc(u64, procs.len);
    defer allocator.free(remaining);
    for (procs, 0..) |p, i| remaining[i] = p.burst_time;

    var started = try allocator.alloc(bool, procs.len);
    defer allocator.free(started);
    @memset(started, false);

    var current_time: u64 = 0;
    var completed: usize = 0;
    const total = procs.len;

    while (completed < total) {
        // Find process with minimum remaining time among arrived processes
        var min_remaining: u64 = std.math.maxInt(u64);
        var chosen: ?usize = null;

        for (procs, 0..) |p, i| {
            if (p.arrival_time <= current_time and remaining[i] > 0) {
                if (remaining[i] < min_remaining) {
                    min_remaining = remaining[i];
                    chosen = i;
                }
            }
        }

        if (chosen == null) {
            // CPU idle: advance to next arrival
            var next_arrival: u64 = std.math.maxInt(u64);
            for (procs) |p| {
                if (remaining[procs.len - 1] > 0 and p.arrival_time > current_time) {
                    next_arrival = @min(next_arrival, p.arrival_time);
                }
            }
            current_time = next_arrival;
            continue;
        }

        const idx = chosen.?;

        // Record start time on first execution
        if (!started[idx]) {
            procs[idx].start_time = current_time;
            procs[idx].response_time = current_time - procs[idx].arrival_time;
            started[idx] = true;
        }

        // Run for 1 time unit (unit-step simulation)
        remaining[idx] -= 1;
        current_time += 1;

        if (remaining[idx] == 0) {
            procs[idx].finish_time = current_time;
            procs[idx].turnaround_time = current_time - procs[idx].arrival_time;
            procs[idx].waiting_time = procs[idx].turnaround_time - procs[idx].burst_time;
            completed += 1;
        }
    }

    return procs;
}
```

STCF is optimal for average turnaround time. But it requires knowing burst times (same problem as SJF) and can starve long processes if short processes continually arrive.

---

> **Exercise 7.1: Compare FCFS, SJF, and STCF**
>
> Given this workload:
>
> | Process | Arrival | Burst |
> |---------|---------|-------|
> | P1      | 0       | 8     |
> | P2      | 1       | 4     |
> | P3      | 2       | 9     |
> | P4      | 3       | 5     |
>
> Simulate each algorithm by hand, drawing the Gantt chart and computing:
> - Average turnaround time
> - Average waiting time
> - Average response time
>
> Then implement the simulation in Zig and verify your hand calculations. Which algorithm minimizes average turnaround? Which minimizes average response time?

---

> **Answer 7.1**
>
> **FCFS:** P1(0-8), P2(8-12), P3(12-21), P4(21-26)
> - TAT: P1=8, P2=11, P3=19, P4=23 → avg = 15.25
> - Wait: P1=0, P2=7, P3=10, P4=18 → avg = 8.75
> - Response: same as wait for FCFS → avg = 8.75
>
> **SJF (non-preemptive, arrivals at t=0 all present):** Not all arrive simultaneously. At t=0: only P1 available. Run P1(0-8). At t=8: P2(4), P3(9), P4(5) available. Shortest is P2. Run P2(8-12), then P4(12-17), then P3(17-26).
> - TAT: P1=8, P2=11, P4=14, P3=24 → avg = 14.25
> - Wait: P1=0, P2=7, P4=9, P3=15 → avg = 7.75
>
> **STCF:** P1 runs until P2 arrives at t=1 (P2 remaining=4 < P1 remaining=7). Preempt P1, run P2. P2 finishes at t=5. At t=5: P1(7), P3(9), P4(5) available. P4 shortest. Run P4 until t=10. At t=10: P1(7), P3(9). Run P1 to t=17. Then P3 to t=26.
> - TAT: P1=17, P2=4, P3=24, P4=7 → avg = 13.0
> - Response: P1=0, P2=0, P3=10, P4=0 → avg = 2.5

---

## Part 5: Round Robin

### 5.1 The Algorithm

Round Robin (RR) addresses FCFS's convoy effect and SJF's oracle problem by running each process for a fixed **time quantum** then preempting it to the back of the ready queue. Every process gets a fair share of the CPU regardless of its burst time.

```zig
/// Round Robin: fixed time quantum, circular ready queue
pub fn schedule_round_robin(processes: []Process,
                             quantum: u64,
                             allocator: std.mem.Allocator) !void {
    // Ready queue: indices into processes
    var ready = std.fifo.LinearFifo(usize, .Dynamic).init(allocator);
    defer ready.deinit();

    var remaining = try allocator.alloc(u64, processes.len);
    defer allocator.free(remaining);
    for (processes, 0..) |p, i| remaining[i] = p.burst_time;

    var started = try allocator.alloc(bool, processes.len);
    defer allocator.free(started);
    @memset(started, false);

    var current_time: u64 = 0;
    var next_arrival_idx: usize = 0;

    // Sort processes by arrival time for efficient arrival checking
    // (assume already sorted for this implementation)

    var completed: usize = 0;

    // Enqueue processes that have arrived at t=0
    for (processes, 0..) |p, i| {
        if (p.arrival_time == 0) {
            try ready.writeItem(i);
            next_arrival_idx = @max(next_arrival_idx, i + 1);
        }
    }

    while (completed < processes.len) {
        if (ready.readItem()) |idx| {
            const p = &processes[idx];

            // Record first start time
            if (!started[idx]) {
                p.start_time = current_time;
                p.response_time = current_time - p.arrival_time;
                started[idx] = true;
            }

            // Run for min(quantum, remaining)
            const run_time = @min(quantum, remaining[idx]);
            current_time += run_time;
            remaining[idx] -= run_time;

            // Enqueue newly arrived processes
            for (processes, 0..) |np, i| {
                if (np.arrival_time > current_time - run_time and
                    np.arrival_time <= current_time and
                    !started[i] and i != idx)
                {
                    try ready.writeItem(i);
                }
            }

            if (remaining[idx] == 0) {
                // Process complete
                p.finish_time = current_time;
                p.turnaround_time = current_time - p.arrival_time;
                p.waiting_time = p.turnaround_time - p.burst_time;
                completed += 1;
            } else {
                // Re-queue at back
                try ready.writeItem(idx);
            }
        } else {
            // Ready queue empty, advance to next arrival
            if (next_arrival_idx < processes.len) {
                current_time = processes[next_arrival_idx].arrival_time;
                try ready.writeItem(next_arrival_idx);
                next_arrival_idx += 1;
            }
        }
    }
}
```

### 5.2 The Quantum Tradeoff

The time quantum is the most important parameter in Round Robin. Its size drives a fundamental tradeoff:

**Small quantum → good response time, high context switch overhead.** If the quantum is 1ms and a context switch costs 0.1ms, 10% of CPU time is wasted on switching. With 100 processes running, every process gets a turn every 100ms — good responsiveness. But if each process has millions of quantum-length turns, the total context switch overhead is enormous.

**Large quantum → low overhead, poor response time.** As quantum → ∞, Round Robin becomes FCFS. Response time degrades toward the convoy scenario.

The rule of thumb: choose a quantum large enough that context switch overhead is less than 1% of the quantum, but small enough that interactive jobs get a turn within acceptable response latency. In practice, Linux historically used 100ms quanta, modern kernels use dynamic quanta based on system load.

```zig
pub fn demonstrate_quantum_effect() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Five equal-length jobs: RR with various quanta
    const burst: u64 = 100;
    const quanta = [_]u64{ 1, 5, 10, 25, 50, 100 };

    std.debug.print("\nRound Robin quantum effect (5 processes, burst={d}):\n", .{burst});
    std.debug.print("{s:>8}  {s:>12}  {s:>12}  {s:>14}\n",
        .{"Quantum", "Avg Response", "Avg Turnaround", "Context Switches"});

    for (quanta) |q| {
        var procs = [_]Process{
            .{ .pid=1, .name="P1", .arrival_time=0, .burst_time=burst,
               .start_time=0, .finish_time=0, .waiting_time=0,
               .turnaround_time=0, .response_time=0 },
            .{ .pid=2, .name="P2", .arrival_time=0, .burst_time=burst,
               .start_time=0, .finish_time=0, .waiting_time=0,
               .turnaround_time=0, .response_time=0 },
            .{ .pid=3, .name="P3", .arrival_time=0, .burst_time=burst,
               .start_time=0, .finish_time=0, .waiting_time=0,
               .turnaround_time=0, .response_time=0 },
            .{ .pid=4, .name="P4", .arrival_time=0, .burst_time=burst,
               .start_time=0, .finish_time=0, .waiting_time=0,
               .turnaround_time=0, .response_time=0 },
            .{ .pid=5, .name="P5", .arrival_time=0, .burst_time=burst,
               .start_time=0, .finish_time=0, .waiting_time=0,
               .turnaround_time=0, .response_time=0 },
        };

        try schedule_round_robin(&procs, q, allocator);

        var avg_rt: f64 = 0;
        var avg_tat: f64 = 0;
        for (procs) |p| {
            avg_rt  += @floatFromInt(p.response_time);
            avg_tat += @floatFromInt(p.turnaround_time);
        }
        avg_rt  /= @floatFromInt(procs.len);
        avg_tat /= @floatFromInt(procs.len);

        const context_switches = burst * procs.len / q;

        std.debug.print("{d:>8}  {d:>12.1}  {d:>12.1}  {d:>14}\n",
            .{ q, avg_rt, avg_tat, context_switches });
    }
}
```

---

## Part 6: Multi-Level Feedback Queue (MLFQ)

### 6.1 The Problem MLFQ Solves

SJF minimizes turnaround time but requires knowing burst times. Round Robin gives good response time but poor turnaround time. MLFQ approximates the behavior of SJF without knowing burst times in advance — by learning from a process's past behavior.

The insight: if a process uses its entire time quantum without blocking, it is likely CPU-bound (long burst). If it frequently blocks before exhausting its quantum, it is likely I/O-bound (short effective burst). MLFQ uses this observation to prioritize short/interactive jobs without requiring advance knowledge.

### 6.2 The Rules

MLFQ maintains multiple queues, each with a different priority level. The rules:

1. If Priority(A) > Priority(B): A runs, B does not
2. If Priority(A) = Priority(B): A and B run in Round Robin
3. When a process first enters the system: it starts in the highest-priority queue
4. If a process uses up its entire quantum: its priority is reduced (moved down one queue)
5. If a process yields the CPU before its quantum expires: its priority stays the same
6. After a fixed time period (the boost interval): all processes are moved to the highest-priority queue (prevents starvation)

Rules 4 and 5 are the learning mechanism: a process that repeatedly uses its full quantum migrates down to lower-priority queues (treated as long CPU-bound job). A process that frequently yields stays in high-priority queues (treated as short interactive job).

Rule 6 is the starvation prevention mechanism: without it, CPU-bound jobs could be starved indefinitely by a stream of short jobs.

```zig
const std = @import("std");

const NUM_QUEUES: usize = 3;

const MlfqProcess = struct {
    pid: u32,
    name: []const u8,
    arrival_time: u64,
    burst_time: u64,
    remaining: u64,
    current_queue: usize,
    time_in_queue: u64,  // time used in current queue without blocking

    // Result metrics
    start_time: u64,
    finish_time: u64,
    first_run: bool,
    response_time: u64,
};

pub fn schedule_mlfq(
    processes: []MlfqProcess,
    queue_quanta: [NUM_QUEUES]u64,  // time quantum for each queue
    boost_interval: u64,
    allocator: std.mem.Allocator,
) !void {
    // Ready queues: one per priority level
    var queues: [NUM_QUEUES]std.fifo.LinearFifo(usize, .Dynamic) = undefined;
    for (&queues) |*q| q.* = std.fifo.LinearFifo(usize, .Dynamic).init(allocator);
    defer for (&queues) |*q| q.deinit();

    var current_time: u64 = 0;
    var completed: usize = 0;
    var time_since_boost: u64 = 0;

    // Enqueue all processes that have arrived
    for (processes, 0..) |p, i| {
        if (p.arrival_time == 0) {
            try queues[0].writeItem(i); // all start in highest queue
        }
    }

    while (completed < processes.len) {
        // Priority boost: move all processes to top queue
        if (time_since_boost >= boost_interval) {
            for (0..NUM_QUEUES) |qi| {
                while (queues[qi].readItem()) |idx| {
                    processes[idx].current_queue = 0;
                    processes[idx].time_in_queue = 0;
                    try queues[0].writeItem(idx);
                }
            }
            time_since_boost = 0;
        }

        // Find highest-priority non-empty queue
        var chosen_queue: ?usize = null;
        var chosen_idx: ?usize = null;

        for (0..NUM_QUEUES) |qi| {
            if (queues[qi].count > 0) {
                chosen_queue = qi;
                // Peek at front of queue
                chosen_idx = queues[qi].peekItem(0);
                break;
            }
        }

        if (chosen_queue == null) {
            // No runnable processes: advance to next arrival
            var next: u64 = std.math.maxInt(u64);
            for (processes) |p| {
                if (p.remaining > 0 and p.arrival_time > current_time) {
                    next = @min(next, p.arrival_time);
                }
            }
            if (next == std.math.maxInt(u64)) break;
            current_time = next;
            // Enqueue newly arrived processes
            for (processes, 0..) |p, i| {
                if (p.arrival_time == current_time) {
                    try queues[0].writeItem(i);
                }
            }
            continue;
        }

        const qi = chosen_queue.?;
        const idx = queues[qi].readItem().?;
        const p = &processes[idx];
        const quantum = queue_quanta[qi];

        // Record first run
        if (!p.first_run) {
            p.start_time = current_time;
            p.response_time = current_time - p.arrival_time;
            p.first_run = true;
        }

        // Run for min(quantum, remaining)
        const run_time = @min(quantum, p.remaining);
        current_time += run_time;
        p.remaining -= run_time;
        p.time_in_queue += run_time;
        time_since_boost += run_time;

        // Enqueue newly arrived processes (into top queue)
        for (processes, 0..) |np, i| {
            if (np.arrival_time > current_time - run_time and
                np.arrival_time <= current_time and
                np.first_run == false and
                i != idx and np.remaining == np.burst_time)
            {
                try queues[0].writeItem(i);
            }
        }

        if (p.remaining == 0) {
            // Process complete
            p.finish_time = current_time;
            completed += 1;
        } else if (p.time_in_queue >= quantum) {
            // Used full quantum: demote to lower queue
            const next_q = @min(qi + 1, NUM_QUEUES - 1);
            p.current_queue = next_q;
            p.time_in_queue = 0;
            try queues[next_q].writeItem(idx);
        } else {
            // Yielded before quantum: stay in same queue
            // (In this simulation, we run to completion within quantum
            //  unless preempted by higher-priority arrival)
            try queues[qi].writeItem(idx);
        }
    }

    // Compute final metrics
    for (processes) |*p| {
        if (p.finish_time > 0) {
            p.finish_time = p.finish_time; // already set
        }
    }
}
```

### 6.3 Why MLFQ Approximates SJF

Consider two processes: a CPU-bound job (burst=1000) and an interactive job (burst=10, but it yields frequently).

- The interactive job stays in the top queue — it always yields before its quantum expires
- The CPU-bound job migrates to lower queues after using full quanta
- When both are in the system, the interactive job runs first (higher priority)
- This approximates SJF: the short interactive jobs run before the long CPU-bound job

The approximation is imperfect — MLFQ does not actually know job lengths — but it adapts to actual behavior and gets close to optimal for mixed workloads.

---

> **Exercise 7.2: MLFQ Priority Gaming**
>
> MLFQ has a known vulnerability: a process can game the scheduler by deliberately yielding before its quantum expires, staying in the highest-priority queue forever.
>
> Design an experiment:
> 1. Create a "CPU-bound" process with burst=500 and a "gaming" process with burst=500 but that calls `yield()` every 9ms (just before the 10ms quantum).
> 2. Simulate MLFQ with 3 queues, quanta of 10/20/40ms, boost interval of 100ms.
> 3. Show how much more CPU time the gaming process receives vs the honest CPU-bound process.
>
> Then modify the MLFQ rules: instead of resetting time-in-queue on every yield, accumulate total CPU time used. Demote when accumulated time exceeds the quantum. How does this fix the gaming vulnerability?

---

## Part 7: Context Switching in Practice

### 7.1 What a Context Switch Actually Is

Every scheduling decision involves a context switch: saving the state of the current process and restoring the state of the next one. This is not a software abstraction — it is a concrete operation on physical hardware registers.

At minimum, a user-space context switch must save and restore:
- All callee-saved registers: `rbx`, `rbp`, `r12`, `r13`, `r14`, `r15` (on x86-64)
- The stack pointer (`rsp`)
- The instruction pointer (`rip`) — implicitly, via `call`/`ret`

The kernel also saves/restores caller-saved registers and the flags register during OS-level preemptive switches. User-space cooperative switches can save less (only what the calling convention requires callee to preserve).

From the Linux kernel's `entry_64.S`, the switch_to macro saves and restores:
```asm
pushq %rbp
pushq %rbx
pushq %r12
pushq %r13
pushq %r14
pushq %r15
movq %rsp, OLD_RSP(%rdi)   // save stack pointer
movq NEW_RSP(%rsi), %rsp   // load new stack pointer
popq %r15
popq %r14
popq %r13
popq %r12
popq %rbx
popq %rbp
```

The stack pointer swap is the heart of the context switch. By saving `rsp` and loading a different one, you are now executing on a completely different stack — the new process's stack. When `ret` executes, it returns to wherever the new process was when it was last switched out.

### 7.2 Implementing Context Switching in Zig

Zig 0.16.0 removed `ucontext_t`, so cooperative context switching must use inline assembly directly. This is a low-level but educational exercise: you are implementing the mechanism that all cooperative schedulers, coroutine libraries, and green thread runtimes use.

```zig
const std = @import("std");

/// A fiber context: the minimum state needed to resume a fiber
const FiberContext = struct {
    rsp: u64,  // stack pointer — restored on switch
    // rip is implicit: the address pushed by 'call' to switch_to
};

/// Switch from current fiber to next fiber.
/// Saves callee-saved registers and stack pointer for 'current',
/// restores them for 'next'.
///
/// This works because:
/// 1. switch_to is called as a normal function
/// 2. The return address is pushed on current's stack by the call instruction
/// 3. We save rsp (includes the return address)
/// 4. We load next's rsp (which has its own return address from its last switch)
/// 5. ret pops that address and resumes next from where it left off
fn switch_to(current: *FiberContext, next: *const FiberContext) void {
    asm volatile (
        // Save callee-saved registers on current stack
        "push %%rbp\n"
        "push %%rbx\n"
        "push %%r12\n"
        "push %%r13\n"
        "push %%r14\n"
        "push %%r15\n"
        // Save current stack pointer
        "mov %%rsp, (%[current_ctx])\n"
        // Load next stack pointer
        "mov (%[next_ctx]), %%rsp\n"
        // Restore callee-saved registers from next's stack
        "pop %%r15\n"
        "pop %%r14\n"
        "pop %%r13\n"
        "pop %%r12\n"
        "pop %%rbx\n"
        "pop %%rbp\n"
        // ret pops next's return address and jumps there
        :
        : [current_ctx] "r" (&current.rsp),
          [next_ctx] "r" (&next.rsp)
        : "memory", "rbp", "rbx", "r12", "r13", "r14", "r15"
    );
}

/// Initialize a fiber context to start executing fn_ptr(arg)
/// stack must be sufficiently large and aligned
fn init_fiber(ctx: *FiberContext,
              stack: []u8,
              fn_ptr: *const fn() void) void {
    // Stack grows downward. Place initial frame at top of stack.
    // Stack must be 16-byte aligned before the call instruction,
    // which means 8-byte aligned at the point of a push.
    const stack_top = @intFromPtr(stack.ptr) + stack.len;
    const aligned_top = stack_top & ~@as(usize, 15);

    // Set up the stack as if switch_to was called from fn_ptr:
    // [fn_ptr return addr] [rbp] [rbx] [r12] [r13] [r14] [r15]
    //                      ↑ rsp points here after pops in switch_to
    var sp = aligned_top;

    // Push a sentinel return address (fiber_exit handler)
    sp -= 8;
    @as(*u64, @ptrFromInt(sp)).* = @intFromPtr(&fiber_exit);

    // Push the fiber's entry point as the "return address"
    // that will be jumped to when switch_to does its final ret
    sp -= 8;
    @as(*u64, @ptrFromInt(sp)).* = @intFromPtr(fn_ptr);

    // Push space for the 6 callee-saved registers that switch_to will pop
    // (rbp, rbx, r12, r13, r14, r15 — all initialized to 0)
    sp -= 6 * 8;
    @memset(@as([*]u8, @ptrFromInt(sp))[0..48], 0);

    ctx.rsp = sp;
}

fn fiber_exit() noreturn {
    // Called when a fiber returns from its entry function
    // In a real scheduler, this would yield back to the scheduler
    // and mark the fiber as complete
    std.debug.print("fiber exited\n", .{});
    std.process.exit(0);
}
```

### 7.3 A Minimal Cooperative Scheduler

Using the context switching primitive above, build a minimal cooperative scheduler:

```zig
const MAX_FIBERS = 8;

const FiberState = enum { runnable, blocked, done };

const Fiber = struct {
    ctx: FiberContext,
    stack: []u8,
    state: FiberState,
    id: u32,
};

var fibers: [MAX_FIBERS]Fiber = undefined;
var fiber_count: usize = 0;
var current_fiber: usize = 0;
var scheduler_ctx: FiberContext = .{ .rsp = 0 };

pub fn yield() void {
    // Find next runnable fiber (round robin)
    const start = (current_fiber + 1) % fiber_count;
    var next = start;

    while (true) {
        if (fibers[next].state == .runnable) break;
        next = (next + 1) % fiber_count;
        if (next == start) {
            // No runnable fibers: return to scheduler
            switch_to(&fibers[current_fiber].ctx, &scheduler_ctx);
            return;
        }
    }

    const prev = current_fiber;
    current_fiber = next;
    switch_to(&fibers[prev].ctx, &fibers[next].ctx);
}

pub fn spawn_fiber(allocator: std.mem.Allocator,
                   func: *const fn() void) !void {
    const stack = try allocator.alignedAlloc(u8, 16, 64 * 1024); // 64 KB stack
    const id = fiber_count;
    fiber_count += 1;

    fibers[id] = .{
        .ctx = .{ .rsp = 0 },
        .stack = stack,
        .state = .runnable,
        .id = @intCast(id),
    };

    init_fiber(&fibers[id].ctx, stack, func);
}

// Example fibers
fn fiber_a() void {
    for (0..3) |i| {
        std.debug.print("Fiber A: iteration {d}\n", .{i});
        yield();
    }
    fibers[current_fiber].state = .done;
}

fn fiber_b() void {
    for (0..3) |i| {
        std.debug.print("Fiber B: iteration {d}\n", .{i});
        yield();
    }
    fibers[current_fiber].state = .done;
}

pub fn run_scheduler(allocator: std.mem.Allocator) !void {
    try spawn_fiber(allocator, fiber_a);
    try spawn_fiber(allocator, fiber_b);

    current_fiber = 0;
    switch_to(&scheduler_ctx, &fibers[0].ctx);

    std.debug.print("All fibers completed\n", .{});
}
```

Output:
```
Fiber A: iteration 0
Fiber B: iteration 0
Fiber A: iteration 1
Fiber B: iteration 1
Fiber A: iteration 2
Fiber B: iteration 2
All fibers completed
```

The fibers take turns, each voluntarily yielding control. No OS scheduler is involved — this is pure user-space cooperative multitasking.

### 7.4 Measuring Context Switch Cost

```zig
pub fn measure_context_switch_cost() !void {
    // Measure the round-trip cost of a cooperative context switch
    // by switching between two fibers that each immediately yield back

    const ITERS = 1_000_000;
    var timer = try std.time.Timer.start();

    // ... (spawn two fibers that ping-pong ITERS times)
    // ... measure total time / ITERS

    // Baseline: a function call
    timer.reset();
    var sum: u64 = 0;
    for (0..ITERS) |i| sum += i;
    const call_ns = timer.read() / ITERS;
    std.mem.doNotOptimizeAway(sum);

    std.debug.print("Function call:             ~{d} ns\n", .{call_ns});
    std.debug.print("Cooperative context switch: ~{d} ns (estimate)\n",
        .{call_ns * 6}); // rough: ~6 push/pop pairs
    // OS thread context switch: measure with getpid() benchmark from Module 2
    std.debug.print("OS thread context switch:   ~100-300 ns (see Module 2)\n",
        .{});
}
```

The comparison reveals why cooperative schedulers and coroutine libraries exist: a cooperative context switch costs roughly 10-50ns versus 100-300ns for an OS thread context switch. For systems that create thousands of concurrent tasks, this 10x difference in switching cost is significant.

---

## Part 8: The Linux Completely Fair Scheduler

### 8.1 Beyond MLFQ — The CFS Philosophy

Linux's Completely Fair Scheduler (CFS), introduced in kernel 2.6.23, takes a different approach from MLFQ. Rather than managing multiple priority queues, CFS maintains a single concept: **virtual runtime**.

Each process has a `vruntime` counter that tracks how much CPU time it has received, normalized by priority. The scheduler always runs the process with the smallest `vruntime` — the process that has received the least CPU time relative to its priority.

This provides perfect fairness: in steady state, all processes of equal priority will have the same `vruntime`. A process that has been waiting (blocked on I/O) will have a low `vruntime` and will be immediately prioritized when it becomes runnable.

### 8.2 The Red-Black Tree

CFS stores runnable processes in a **red-black tree** ordered by `vruntime`. The leftmost node is always the process with the smallest `vruntime` — the next process to run. This makes scheduling decisions O(log n) for finding the minimum and O(log n) for insertion.

The leftmost node is cached, making the common case O(1): the scheduler simply takes `tree.min()` and runs it.

```
Red-black tree ordered by vruntime:

         [P3: vrt=10]
        /             \
  [P1: vrt=5]    [P5: vrt=15]
       /
  [P2: vrt=2]  ← leftmost: run next
```

When the running process is preempted (timer interrupt), its `vruntime` is increased by the actual time it ran (divided by its weight, which is determined by its nice value). It is reinserted into the tree at its new position. The new leftmost node becomes the next process to run.

### 8.3 Implementing a Simplified CFS

```zig
const std = @import("std");

const CfsProcess = struct {
    pid: u32,
    name: []const u8,
    vruntime: u64,    // virtual runtime (normalized by weight)
    weight: u64,      // determined by nice value: nice=0 → weight=1024
    remaining: u64,   // actual CPU time still needed

    // For the ordered set: binary search tree key
    pub fn lessThan(a: *const CfsProcess, b: *const CfsProcess) bool {
        return a.vruntime < b.vruntime;
    }
};

/// A simplified CFS simulation using a sorted array as the "tree"
/// (A real implementation would use a balanced BST for O(log n))
pub fn schedule_cfs(processes: []CfsProcess,
                    min_granularity: u64) void {
    var current_time: u64 = 0;
    var completed: usize = 0;
    const total = processes.len;

    while (completed < total) {
        // Find process with minimum vruntime (the "leftmost tree node")
        var min_vrt: u64 = std.math.maxInt(u64);
        var chosen: ?usize = null;

        for (processes, 0..) |p, i| {
            if (p.remaining > 0 and p.vruntime < min_vrt) {
                min_vrt = p.vruntime;
                chosen = i;
            }
        }

        if (chosen == null) break;
        const idx = chosen.?;
        const p = &processes[idx];

        // Run for min_granularity (the minimum time before preemption)
        const run_time = @min(min_granularity, p.remaining);
        current_time += run_time;
        p.remaining -= run_time;

        // Update vruntime: normalized by weight
        // Higher weight (lower nice value) → vruntime increases more slowly
        // Lower weight (higher nice value) → vruntime increases faster
        const vrt_delta = run_time * 1024 / p.weight;
        p.vruntime += vrt_delta;

        if (p.remaining == 0) completed += 1;
    }
}

pub fn demonstrate_cfs_fairness() void {
    // Three processes: same priority (weight=1024)
    var procs = [_]CfsProcess{
        .{ .pid=1, .name="P1", .vruntime=0, .weight=1024, .remaining=50 },
        .{ .pid=2, .name="P2", .vruntime=0, .weight=1024, .remaining=30 },
        .{ .pid=3, .name="P3", .vruntime=0, .weight=1024, .remaining=70 },
    };

    schedule_cfs(&procs, 10);

    std.debug.print("CFS with equal weights:\n", .{});
    for (procs) |p| {
        std.debug.print("  {s}: vruntime={d}\n", .{p.name, p.vruntime});
    }

    // Three processes: different priorities
    var procs2 = [_]CfsProcess{
        .{ .pid=1, .name="P1(hi)", .vruntime=0, .weight=2048, .remaining=50 }, // nice=-5
        .{ .pid=2, .name="P2(lo)", .vruntime=0, .weight=512,  .remaining=50 }, // nice=5
        .{ .pid=3, .name="P3(nm)", .vruntime=0, .weight=1024, .remaining=50 }, // nice=0
    };

    schedule_cfs(&procs2, 10);

    std.debug.print("\nCFS with different weights (hi=2x, lo=0.5x):\n", .{});
    for (procs2) |p| {
        std.debug.print("  {s}: vruntime={d}\n", .{p.name, p.vruntime});
    }
}
```

---

## Part 9: The Module Project — A Work-Stealing Thread Pool

### Project Specification

Build a **work-stealing thread pool** — the production-grade approach to parallel task execution used in most real-world parallel runtimes.

A naive thread pool uses a single shared queue protected by a mutex. All worker threads compete for the same lock to get work. Under high contention, threads spend more time acquiring the lock than doing work.

A work-stealing thread pool gives each thread its own local deque (double-ended queue). Threads take work from the front of their own deque. When a thread's deque is empty, it "steals" work from the back of another thread's deque. This eliminates lock contention in the common case (each thread works from its own deque) while providing automatic load balancing (idle threads steal work from busy ones).

### Why Work-Stealing Works

Consider a parallel tree traversal where each subtree takes different amounts of time to process. A static partition assigns subtrees to threads upfront — if some subtrees are large and some small, some threads finish early while others are still working. Work-stealing fixes this: a thread that finishes early steals remaining subtrees from the back of overloaded threads' deques.

The key implementation challenge is making the deque thread-safe efficiently. The Chase-Lev deque is the standard solution: the owner thread accesses the front (push/pop) without locks; stealers access the back (steal) with a CAS (compare-and-swap) operation.

### Implementation

```zig
const std = @import("std");
const atomic = std.atomic;

/// A task to be executed
const Task = struct {
    func: *const fn (*anyopaque) void,
    data: *anyopaque,
};

/// Chase-Lev work-stealing deque (simplified version)
/// Owner: push/pop from bottom (front)
/// Stealers: steal from top (back)
const WorkDeque = struct {
    buffer: []atomic.Value(Task),
    top: atomic.Value(usize),     // stealers read/write
    bottom: atomic.Value(usize),  // owner reads/writes

    const INITIAL_CAPACITY = 256;

    pub fn init(allocator: std.mem.Allocator) !WorkDeque {
        const buf = try allocator.alloc(atomic.Value(Task), INITIAL_CAPACITY);
        for (buf) |*slot| slot.* = atomic.Value(Task).init(undefined);
        return .{
            .buffer = buf,
            .top    = atomic.Value(usize).init(0),
            .bottom = atomic.Value(usize).init(0),
        };
    }

    pub fn deinit(self: *WorkDeque, allocator: std.mem.Allocator) void {
        allocator.free(self.buffer);
    }

    /// Owner pushes a task (call only from owning thread)
    pub fn push(self: *WorkDeque, task: Task) void {
        const b = self.bottom.load(.monotonic);
        const t = self.top.load(.acquire);
        const size = b - t;

        if (size >= self.buffer.len - 1) {
            // Deque full — in a real implementation, grow the buffer
            // For this implementation, panic (caller must size appropriately)
            @panic("work deque overflow");
        }

        self.buffer[b % self.buffer.len].store(task, .relaxed);
        // Ensure task is visible before updating bottom
        self.bottom.store(b + 1, .release);
    }

    /// Owner pops a task from its own deque (LIFO)
    pub fn pop(self: *WorkDeque) ?Task {
        const b = self.bottom.load(.monotonic) -% 1;
        self.bottom.store(b, .monotonic);

        // Memory fence: ensure bottom update is visible before reading top
        const t = self.top.load(.seq_cst);

        if (@as(isize, @bitCast(t)) <= @as(isize, @bitCast(b))) {
            const task = self.buffer[b % self.buffer.len].load(.relaxed);
            if (t == b) {
                // Last element: may race with a steal
                if (self.top.cmpxchgStrong(t, t + 1, .seq_cst, .relaxed) == null) {
                    self.bottom.store(b + 1, .monotonic);
                    return task;
                } else {
                    self.bottom.store(b + 1, .monotonic);
                    return null; // stolen by another thread
                }
            }
            return task;
        } else {
            self.bottom.store(b + 1, .monotonic);
            return null; // deque was empty
        }
    }

    /// Stealer takes a task from the other end (FIFO steal)
    pub fn steal(self: *WorkDeque) ?Task {
        const t = self.top.load(.acquire);
        const b = self.bottom.load(.acquire);

        if (@as(isize, @bitCast(t)) >= @as(isize, @bitCast(b))) {
            return null; // empty
        }

        const task = self.buffer[t % self.buffer.len].load(.relaxed);
        // CAS to claim this slot
        if (self.top.cmpxchgStrong(t, t + 1, .seq_cst, .relaxed) == null) {
            return task;
        }
        return null; // CAS failed: another stealer got it
    }
};

/// The thread pool
pub const ThreadPool = struct {
    threads: []std.Thread,
    deques: []WorkDeque,
    shutdown: atomic.Value(bool),
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, num_threads: usize) !*ThreadPool {
        const pool = try allocator.create(ThreadPool);
        pool.* = .{
            .threads  = try allocator.alloc(std.Thread, num_threads),
            .deques   = try allocator.alloc(WorkDeque, num_threads),
            .shutdown = atomic.Value(bool).init(false),
            .allocator = allocator,
        };

        for (pool.deques) |*d| d.* = try WorkDeque.init(allocator);

        for (pool.threads, 0..) |*t, i| {
            t.* = try std.Thread.spawn(.{}, worker_thread, .{ pool, i });
        }

        return pool;
    }

    pub fn deinit(self: *ThreadPool) void {
        self.shutdown.store(true, .release);
        for (self.threads) |t| t.join();
        for (self.deques) |*d| d.deinit(self.allocator);
        self.allocator.free(self.threads);
        self.allocator.free(self.deques);
        self.allocator.destroy(self);
    }

    /// Submit a task to a specific worker's deque
    pub fn submit(self: *ThreadPool, worker_id: usize, task: Task) void {
        self.deques[worker_id].push(task);
    }

    fn worker_thread(pool: *ThreadPool, id: usize) void {
        while (!pool.shutdown.load(.acquire)) {
            // Try to get work from own deque
            if (pool.deques[id].pop()) |task| {
                task.func(task.data);
                continue;
            }

            // Own deque empty: try to steal from others
            const n = pool.threads.len;
            var stolen = false;
            for (0..n) |offset| {
                const victim = (id + 1 + offset) % n;
                if (pool.deques[victim].steal()) |task| {
                    task.func(task.data);
                    stolen = true;
                    break;
                }
            }

            if (!stolen) {
                // Nothing to steal: yield CPU briefly
                std.Thread.yield() catch {};
            }
        }
    }
};
```

### Benchmark: Shared Queue vs Work-Stealing

```zig
pub fn benchmark_pool() !void {
    var gpa: std.heap.DebugAllocator(.{}) = .init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const NUM_TASKS = 10_000;
    const NUM_THREADS = 4;

    // Task: compute sum of first N integers (variable N for imbalance)
    const TaskData = struct {
        n: u64,
        result: u64,
    };

    fn compute_sum(data: *anyopaque) void {
        const td: *TaskData = @ptrCast(@alignCast(data));
        var sum: u64 = 0;
        for (0..td.n) |i| sum += i;
        td.result = sum;
    }

    // Create imbalanced workload: 90% small tasks, 10% large tasks
    const tasks = try allocator.alloc(TaskData, NUM_TASKS);
    defer allocator.free(tasks);

    var rng = std.rand.DefaultPrng.init(42);
    for (tasks) |*t| {
        if (rng.random().float(f32) < 0.9) {
            t.n = 1_000;     // small task
        } else {
            t.n = 100_000;   // large task (100x bigger)
        }
        t.result = 0;
    }

    var timer = try std.time.Timer.start();

    // Work-stealing pool
    const pool = try ThreadPool.init(allocator, NUM_THREADS);
    defer pool.deinit();

    // Distribute tasks round-robin to workers
    for (tasks, 0..) |*t, i| {
        pool.submit(i % NUM_THREADS, .{
            .func = compute_sum,
            .data = t,
        });
    }

    // Wait for all tasks (simplified: in real code, use a barrier or counter)
    std.time.sleep(100_000_000); // 100ms — enough for all tasks to complete

    const elapsed = timer.read();
    std.debug.print("Work-stealing ({d} threads, {d} tasks): {d} ms\n",
        .{ NUM_THREADS, NUM_TASKS, elapsed / 1_000_000 });
}
```

### Extension Challenges

1. **Scheduler visualization:** Modify the scheduling simulator to output a timeline in SVG format — each process as a colored bar, time on the x-axis. This makes the Gantt chart visual and helps compare algorithms at a glance.

2. **Priority inversion:** Implement a scenario demonstrating priority inversion — a high-priority task is blocked waiting for a resource held by a low-priority task, while a medium-priority task runs. Implement priority inheritance as the fix.

3. **Real-time scheduling:** Add a deadline field to processes and implement Earliest Deadline First (EDF) scheduling. Show that EDF is optimal for real-time systems: if any feasible schedule exists that meets all deadlines, EDF will find it.

---

## Summary

Scheduling is the OS mechanism that creates the illusion of simultaneous execution on finite hardware. Every scheduling algorithm embodies a set of tradeoffs, and no algorithm is universally best.

**FCFS** is simple and fair in arrival order but suffers from the convoy effect — short jobs stuck behind long ones produce terrible average turnaround and response times.

**SJF and STCF** minimize average turnaround time but require knowing burst times in advance (the oracle problem) and can starve long processes if short processes continuously arrive.

**Round Robin** provides good response time and prevents starvation by giving every process a turn, but average turnaround time is poor because each job takes many quantum-length slices to complete.

**MLFQ** approximates SJF without oracle knowledge by observing process behavior: processes that use full quanta are demoted; processes that yield stay at high priority. Priority boosts prevent starvation.

**CFS** takes the fairness-based approach: every process gets a perfectly equal share of CPU time (weighted by priority), tracked via virtual runtime in a red-black tree. It is the default Linux scheduler.

**Context switching** is not free. A cooperative switch costs ~10-50ns; an OS thread switch costs ~100-300ns. Work-stealing thread pools reduce lock contention by giving each thread its own task deque, with stealing from other deques when idle.

---

## What's Next

Module 8 — Parallelism and Concurrency — builds directly on everything in this module. You have seen scheduling from the OS perspective; Module 8 goes inside the program, showing how to write code that uses multiple threads or cores effectively, how synchronization primitives work, and why concurrent programming is hard. The context switching you implemented here is the same mechanism that makes multithreading work.

---

## Reference: Scheduling Algorithm Comparison

```
Algorithm      Turnaround  Response   Starvation?  Oracle Needed?  Preemptive?
─────────────────────────────────────────────────────────────────────────────
FCFS           Poor        Poor       No           No              No
SJF            Optimal     Poor       Yes (long)   Yes             No
STCF           Optimal     Good       Yes (long)   Yes             Yes
Round Robin    Poor        Good       No           No              Yes
MLFQ           Good        Good       No (w/boost) No              Yes
CFS            Good        Good       No           No              Yes

Convoy effect: FCFS (always), RR (with large quantum)
Gaming vulnerability: MLFQ (fixed by accounting total CPU time per queue)
Best for batch: SJF/STCF
Best for interactive: Round Robin / CFS
Best for mixed: MLFQ / CFS
```

## Reference: Scheduling Metrics Formulas

```
Arrival Time (AT):    when process enters ready queue
Burst Time (BT):      total CPU time needed
Start Time (ST):      when process first gets CPU
Finish Time (FT):     when process completes
Response Time:        ST - AT
Waiting Time:         TAT - BT  = (FT - AT) - BT
Turnaround Time:      FT - AT
Throughput:           processes_completed / total_elapsed_time
CPU Utilization:      busy_time / total_elapsed_time × 100%
```

---

*End of Module 7*
