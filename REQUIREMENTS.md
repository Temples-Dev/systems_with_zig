# Systems Learning Platform — Product Requirements
### "The Craft of Systems Programming with Zig"

---

## 1. Product Overview

A web-based interactive learning platform that delivers the 18-module systems programming curriculum. Students read concept material, write and execute Zig code directly in the browser, complete graded exercises, and build toward a final capstone (ZigKV — a distributed key-value store).

The platform is not a video course, not a passive reader, and not a document host. It is an environment where understanding is built through working code. Every module culminates in a running implementation that the student wrote.

**Zig version target:** 0.16.0 (curriculum base). Platform must track Zig releases and flag breaking changes.

---

## 2. User Personas

### 2.1 Primary — Career Developer Filling the Gap
- 3-10 years experience in application/web/backend code
- Comfortable in Python, JS, Go, or similar
- Zero prior Zig, C, or systems experience
- Goal: understand what actually happens when code runs
- Constraint: limited time; needs sessions to save state reliably

### 2.2 Secondary — CS Student
- Has attended OS/architecture lectures without implementing anything
- Moderate C exposure; no Zig
- Goal: make theoretical knowledge concrete through implementation
- Constraint: academic deadlines; may need to work in bursts

### 2.3 Tertiary — Compiler/Kernel/DB Aspirant
- Specific career target requiring systems depth
- May have partial knowledge; does not want to repeat what they know
- Goal: fill specific gaps (e.g., knows memory but not distributed systems)
- Constraint: wants to jump into the relevant section without full sequential path

---

## 3. Curriculum Structure

The platform must model this exact hierarchy:

```
Course
└── Section (5 sections)
    └── Module (18 total)
        ├── Before You Begin (prerequisites)
        ├── Learning Objectives (explicit, checkable)
        ├── Concept Content (prose + diagrams)
        ├── Code Examples (runnable in platform)
        ├── Exercises (graded implementations)
        └── Capstone (1 per section + 1 final)
```

**Sections:**

| # | Title | Modules |
|---|-------|---------|
| I | The Machine | 1–4 |
| II | The Operating System | 5–9 |
| III | Performance and I/O | 10–11 |
| IV | Networking | 12–14 |
| V | Distributed Systems | 15–18 |
| — | Final Capstone | ZigKV |

**Module dependency graph is linear and enforced.** A student cannot unlock Module 5 without completing Module 4. Section capstones unlock after all section modules complete. Final capstone unlocks after all sections complete.

---

## 4. Functional Requirements

### 4.1 Content Rendering

**FR-001** — Render markdown source files as structured HTML with syntax highlighting for Zig, x86-64 assembly, shell commands, and C.

**FR-002** — Render all code blocks with: copy button, language label, and line numbers.

**FR-003** — Support inline callout blocks with visual distinction:
- `> 🔄 0.13→0.16 Change:` — version migration warning
- `> NOTE:` — informational aside
- `> WARNING:` — critical caution

**FR-004** — Render module-level learning objectives as an interactive checklist. Each objective has a checkbox that the student marks when they feel confident. State persists.

**FR-005** — Support embedded diagrams (memory layout, call stack frames, pipeline stages, network stack layers). Initial format: Mermaid or SVG embedded in markdown. Platform renders them inline.

**FR-006** — Provide a persistent "Before You Begin" summary at the top of each module, collapsible after first read, showing prerequisite modules with links.

**FR-007** — Table of contents (TOC) sidebar anchored to current module's sections. Scrollspy updates active section in real time.

**FR-008** — Dark and light mode. Default to system preference.

---

### 4.2 In-Browser Code Execution (Zig Sandbox)

This is the core differentiator of the platform. Students run Zig code without installing anything.

**FR-010** — Embedded code editor in every code example block, pre-populated with the example code. Editor uses Monaco (VS Code engine) with Zig syntax highlighting.

**FR-011** — "Run" button executes code against a backend Zig compilation service. Returns stdout, stderr, and exit code within 10 seconds (p95).

**FR-012** — Compilation and execution run in isolated sandboxes (one per request). No network access, no filesystem writes outside `/tmp`, CPU and memory limits enforced.

**FR-013** — Execution environment must support:
- `zig build run` (Debug and ReleaseFast modes selectable)
- `zig test` (for test-based exercises)
- `objdump`, `readelf`, `strace` output capture for modules that require tool use (Modules 2–3)
- Multi-file projects (for modules that build multi-file systems)

**FR-014** — Students can edit code in the browser. Edits persist per-user per-code-block. A "Reset to original" button restores the curriculum version.

**FR-015** — Execution results show: compilation errors with source locations hyperlinked to editor lines, runtime output, runtime errors with stack traces, and — for `zig test` — pass/fail per test with failure messages.

**FR-016** — For performance-sensitive modules (10, 11, 12), execution output includes wall clock time and a "run N times and average" option to get stable timings.

**FR-017** — The sandbox supports `std.heap.DebugAllocator` leak detection output. Memory leak reports surface clearly in the output UI, not buried in stderr.

**FR-018** — Timeout behavior: execution killed at 30 seconds. Student sees "Execution timed out" with a suggestion to check for infinite loops.

**FR-019** — Execution is stateless by default. For multi-step exercises that require persistent state (e.g., writing a file then reading it), the platform provides a "session workspace" — a temporary filesystem scoped to the exercise, surviving between runs until the student resets or completes.

---

### 4.3 Exercises

Each module contains 3-8 exercises, ranging from concept verification to full implementation.

**FR-020** — Three exercise types:

| Type | Description | Grading |
|------|-------------|---------|
| **Implementation** | Student writes a Zig function/program to spec | Automated test suite runs against submission |
| **Observation** | Student runs provided code, records output, answers questions | Free-text + numeric answer validation |
| **Analysis** | Student inspects assembly/binary output and answers questions | Multiple choice + short answer |

**FR-021** — Implementation exercises use a hidden test harness. Student sees: the function signature they must implement, a description of required behavior, 2–3 sample test cases (input/output), and a "Submit" button. On submit, the full hidden test suite runs (10–50 cases including edge cases).

**FR-022** — Exercise result shows: pass/fail per test case (sample tests fully visible; hidden tests show input/output on failure but not on pass), total score, and time taken.

**FR-023** — Students get unlimited attempts on exercises. Each attempt is logged. Best score counts for progress.

**FR-024** — Hints system: each exercise has 1–3 tiered hints. Requesting a hint is logged. First hint: approach direction. Second hint: key API or pattern. Third hint: near-complete skeleton. Hints do not affect scoring but do affect a "hint-free" achievement.

**FR-025** — Solution reveal: after 3 failed attempts OR after passing, student can reveal the reference solution with inline explanation comments.

**FR-026** — Required exercises (marked in curriculum) must pass before the module is marked complete. Optional exercises contribute to a "mastery" score but are not gating.

---

### 4.4 Progress Tracking

**FR-030** — Module states: `locked`, `available`, `in_progress`, `complete`. Transition rules:
- `locked → available`: all prerequisite modules `complete`
- `available → in_progress`: student opens the module
- `in_progress → complete`: all required exercises pass + student marks objectives checked

**FR-031** — Section progress bar on the course overview page showing modules completed / total.

**FR-032** — Per-module progress: percentage of learning objectives checked, required exercises passed, optional exercises attempted.

**FR-033** — "Resume" button on dashboard navigates directly to the last active position (module + section anchor + editor state).

**FR-034** — Time-on-module tracking. Passive: page active time. Displayed to student only (not public). Useful for self-assessment ("how long does this module actually take me?").

**FR-035** — Streak tracking: consecutive days with ≥1 exercise submission. Shown on dashboard. No gamification beyond streak and module completion — no points, no leaderboard.

**FR-036** — Completion certificate: generated on final capstone pass. PDF, downloadable, includes student name, completion date, and list of all 18 modules plus capstone with pass status.

---

### 4.5 Capstone Projects

Capstones are longer implementations (2–6 hours each) requiring multi-file Zig projects.

**FR-040** — Each section capstone has a specification document embedded in the platform (sourced from the curriculum markdown). Spec includes: system description, interface contract, required behaviors, performance requirements, test protocol.

**FR-041** — Capstone workspace: a persistent multi-file editor within the platform. Files persist across sessions. Student can add, rename, delete files. A `build.zig` scaffold is provided; students extend it.

**FR-042** — Capstone submission runs the full automated test suite AND a set of integration tests that validate behavior at the system boundary (e.g., for ZigKV: connect with `redis-cli` and issue commands). Test infrastructure is provided by the platform.

**FR-043** — Capstone feedback report includes: test pass rates by category, performance benchmark results vs. baseline requirements, and flagged issues (memory leaks from DebugAllocator, timeout failures).

**FR-044** — Final capstone (ZigKV) requires:
- Acceptance of Redis protocol commands via TCP
- Raft replication across a 3-node simulated cluster (provided by platform test harness)
- Persistence: data survives simulated node crash-and-restart
- Throughput: ≥50,000 ops/sec on platform hardware (documented spec)

**FR-045** — Capstones have no attempt limit. Students iterate until passing.

---

### 4.6 User Accounts and Authentication

**FR-050** — Sign up with email + password or OAuth (GitHub, Google).

**FR-051** — Email verification required before accessing exercises.

**FR-052** — Password reset via email.

**FR-053** — Session persistence: stay logged in for 30 days (configurable by user). Remember last position.

**FR-054** — Account deletion: GDPR-compliant. Deletes all progress data within 30 days.

**FR-055** — No social features in v1: no profiles visible to other users, no sharing of solutions.

---

### 4.7 Zig Language Reference Integration

The curriculum includes `zig_systems_refresher.md` — a complete Zig language reference covering 0.13.0 and migration notes to 0.16.0.

**FR-060** — The refresher is accessible at all times as a side panel (keyboard shortcut to open/close) without navigating away from the current module.

**FR-061** — Code examples in the refresher are runnable (same sandbox as module code).

**FR-062** — Cross-links: module content that introduces a Zig feature (e.g., `ArenaAllocator` in Module 4) links to the relevant refresher section. Refresher sections link back to the modules that use each feature.

**FR-063** — Version callout blocks (`🔄 0.13→0.16 Change:`) render distinctly — yellow border, clear version badge — so students on different Zig versions can immediately identify the relevant variant.

---

### 4.8 Search

**FR-070** — Full-text search across all module content, exercises, and the Zig refresher.

**FR-071** — Search results show: module/section, matching excerpt with term highlighted, relevance rank.

**FR-072** — Search is keyboard-accessible (Cmd/Ctrl+K opens search modal).

**FR-073** — Recent searches saved locally (no server round-trip).

---

### 4.9 Admin and Content Management

**FR-080** — Curriculum content is version-controlled in a git repository. Deployment pipeline rebuilds affected pages on merge to main.

**FR-081** — Admin interface for: viewing per-module completion rates, exercise pass rates, average attempts-to-pass, common failure modes (which test cases fail most).

**FR-082** — Exercise test harnesses are maintained in the same repository as curriculum content. A change to a test harness triggers re-evaluation of all existing submissions that used that harness, with notifications to affected students if scores change.

**FR-083** — Zig version upgrade path: when platform upgrades from 0.16.x to a new version, content team reviews all code blocks for compatibility. Version migration callouts can be added without rewriting module prose.

---

## 5. Non-Functional Requirements

### 5.1 Performance

**NFR-001** — Page load (first contentful paint): <1.5s on 10 Mbps connection.

**NFR-002** — Code execution latency (submit to first output byte): <3s p50, <10s p95. Measured from client click.

**NFR-003** — Search results: <200ms from keypress to rendered results.

**NFR-004** — Editor keystroke latency: <16ms (60fps). No jank during typing.

**NFR-005** — Platform must sustain 500 concurrent code execution requests without degradation.

---

### 5.2 Reliability

**NFR-010** — Uptime: 99.5% monthly. Scheduled maintenance windows communicated 48h in advance.

**NFR-011** — Code execution service failure (sandbox backend down) must degrade gracefully: content and exercises remain readable and editable; "execution unavailable" message shown; no data loss of student edits.

**NFR-012** — Student editor state (unsaved code) is persisted to browser local storage on every keystroke and synced to server on submit or page unload. No work lost on browser crash.

**NFR-013** — Execution sandbox crashes (OOM, segfault in student code) must not affect other concurrent requests.

---

### 5.3 Security

**NFR-020** — Sandbox isolation: each execution runs in a separate container/VM with:
- No network access
- Filesystem writes confined to `/tmp` with a 100 MB quota
- CPU limit: 2 cores, 30s wall time
- Memory limit: 512 MB
- No `ptrace`, no capability escalation, no host filesystem access

**NFR-021** — All user-submitted code is treated as untrusted input. Shell injection via filename, compiler flags, or environment variables is prevented by allowlisting all inputs.

**NFR-022** — User authentication tokens stored as httpOnly cookies. CSRF protection on all mutating endpoints.

**NFR-023** — Exercise hidden test suite code is never transmitted to the client. Tests run server-side only.

**NFR-024** — Rate limiting on code execution endpoint: 30 requests/minute per user, 5 concurrent executions per user.

**NFR-025** — All traffic over HTTPS. HSTS enforced.

---

### 5.4 Accessibility

**NFR-030** — WCAG 2.1 AA compliance.

**NFR-031** — Keyboard navigation for all core flows: module navigation, editor, exercise submission, hint/solution reveal.

**NFR-032** — Screen reader compatibility for content and exercise feedback (not the code editor itself — Monaco has known SR limitations).

**NFR-033** — All diagrams have text alt descriptions.

---

### 5.5 Compatibility

**NFR-040** — Browsers: Chrome 110+, Firefox 110+, Safari 16+, Edge 110+.

**NFR-041** — Minimum viewport: 1024px wide (not designed for mobile — systems programming exercises require a usable editor).

**NFR-042** — No native app. Web only.

---

## 6. Technical Architecture Requirements

### 6.1 Frontend

**TAR-001** — SPA with server-side rendering for initial page loads (SEO + performance).

**TAR-002** — Monaco Editor for all code editing surfaces. Zig language extension configured with syntax highlighting and basic LSP features (errors from compiler, not a full LSP server).

**TAR-003** — Markdown → HTML pipeline must support: code fence syntax highlighting (Shiki or Prism with Zig grammar), Mermaid diagram rendering, custom directive syntax for callouts, and anchor generation for TOC.

**TAR-004** — Offline reading: module content (no execution) available offline via service worker cache after first load.

### 6.2 Backend

**TAR-010** — REST API for: auth, progress persistence, exercise submission, code execution dispatch.

**TAR-011** — Code execution service is a separate, horizontally scalable service. Primary backend dispatches to it. It is stateless; no user data touches it.

**TAR-012** — Execution queue with back-pressure: if all sandbox slots are occupied, queue request with a position indicator shown to user. No silent failures.

**TAR-013** — Progress data stored per-user in a relational database. Schema must support: module state, per-exercise attempt history, per-learning-objective state, editor snapshots, capstone workspace file trees.

**TAR-014** — Capstone workspace files stored in object storage (S3-compatible). Version history retained for 90 days.

### 6.3 Execution Sandbox

**TAR-020** — Each sandbox is a container (Docker + gVisor or Firecracker microVM) with:
- Zig 0.16.0 toolchain
- GNU binutils (`objdump`, `readelf`, `nm`)
- `strace`
- No network interface (loopback only, and only when module requires TCP server tests)

**TAR-021** — Container pool pre-warms N instances (configurable). Cold-start must not be on the critical path for p95 latency.

**TAR-022** — Multi-file project support: files uploaded as a tar archive, extracted to a temp directory in the container, build runs from that directory.

**TAR-023** — For capstone integration tests (ZigKV Raft cluster): the test harness starts 3 sandbox instances with a virtual network between them. This is a distinct execution mode from single-file exercises.

---

## 7. Content Requirements

### 7.1 Exercise Coverage (Minimum per Module)

Each module must have at minimum:

| Module | Min Required Exercises | Key Implementation |
|--------|----------------------|-------------------|
| 1 | 4 | Two's complement arithmetic, float comparison, UTF-8 ops |
| 2 | 4 | Cache simulator, branch prediction benchmark |
| 3 | 3 | ELF inspector, strace analysis, minimal syscall program |
| 4 | 5 | Dynamic array from scratch, arena vs. GPA benchmark |
| 5 | 4 | Minimal shell (fork/exec), signal handler |
| 6 | 3 | Cache-friendly vs. cache-hostile matrix traversal |
| 7 | 3 | Scheduler simulation |
| 8 | 5 | Thread-safe queue, mutex usage, semaphore, deadlock demo |
| 9 | 4 | Write-ahead log, journaling file operations |
| 10 | 4 | Profiling, perf counter analysis, benchmark harness |
| 11 | 4 | epoll event loop, async I/O patterns |
| 12 | 4 | TCP echo server, concurrent connection handler |
| 13 | 3 | Raw socket, ARP/IP/TCP header parsing |
| 14 | 4 | Binary protocol parser, message framing, versioning |
| 15 | 3 | Network partition simulator, failure scenario analysis |
| 16 | 5 | Raft leader election, log replication |
| 17 | 4 | MVCC read/write, transaction isolation |
| 18 | 3 | Load shedding, circuit breaker, rate limiter |

### 7.2 Section Capstones

| Section | Capstone | Validation Method |
|---------|---------|-----------------|
| I | Cache simulator with configurable policy | Correctness test suite |
| II | Minimal shell with pipes and redirection | Behavioral test suite |
| III | Async HTTP server (single-threaded, epoll) | Load test: 10k req/s |
| IV | Binary protocol client/server with versioning | Protocol conformance suite |
| V + Final | ZigKV (Redis-compatible distributed KV) | Full integration suite + Raft fault injection |

### 7.3 Zig Refresher Structure

The platform must render `zig_systems_refresher.md` as a navigable reference with:
- Persistent side-panel (not a separate page)
- 14 chapters (Variables/Types, Errors, Slices, Structs, Comptime, Allocators, Concurrency, etc.)
- Chapter-level deep links (so module content can link directly to e.g. `#allocators-arena`)
- Search within the refresher

---

## 8. Out of Scope (v1)

- Mobile/tablet layout
- Video content
- Live instructor sessions or code review by humans
- Community forums or student collaboration
- Custom Zig LSP server (static syntax highlighting only)
- Course authoring tools for third-party content creators
- Multi-language support (Zig only; no C/Rust track)
- Billing/payment (assume free access or handled externally)

---

## 9. Open Questions

1. **Zig version upgrade policy** — When Zig releases 0.17+, does the platform run both versions in parallel, or migrate all content? The refresher already documents 0.13→0.16 diffs; the same pattern should be established.

2. **Execution backend cost model** — Zig compilation is CPU-heavy. Estimate: ~2s per compile, 2 CPU-seconds per compile. At 500 concurrent users each compiling once per minute = 1000 CPU-seconds/minute = ~17 CPUs sustained. Plan the sandbox fleet size accordingly.

3. **Capstone ZigKV cluster test** — Running 3 sandboxed Zig nodes with a virtual network and injecting faults (kill node 2 mid-write, partition node 3) requires either a dedicated test orchestrator or integration with a container orchestration layer. This is the highest-complexity infrastructure requirement; needs a separate design spike.

4. **Progress portability** — Can students export their progress/code? JSON export of all submissions + editor states is low-cost goodwill; implement in v1.

5. **Prerequisites gate strength** — The curriculum is explicit: do not skip modules. But should the platform hard-lock (cannot open) or soft-warn (can open with a warning)? Recommendation: hard-lock for required exercises, soft-warn for module reading access. Decide before implementation.

---

*Document version: 1.0 — 2026-05-06*
*Source curriculum: "The Craft of Systems Programming" — 18 modules, ZigKV capstone*
