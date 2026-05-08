# Module 1: How Computers Represent Everything

## The Craft of Systems Programming — Teaching Material

---

> *"There is no such thing as plain text. There is no such thing as a number. There is no such thing as a color. There are only bits — and interpretation."*

---

## Before You Begin

This module is the first in the curriculum, and it is foundational in the most literal sense: everything that follows depends on it. You cannot reason about memory without understanding how data is laid out in bytes. You cannot understand why programs crash without understanding integer overflow. You cannot read assembly without understanding how numbers are encoded at the machine level.

This is not abstract theory. Everything in this module is directly observable in Zig code that you will write and run. When this module tells you that `0.1 + 0.2` does not equal `0.3`, you will verify it. When it tells you that adding 1 to the maximum value of a `u8` wraps around to 0, you will observe it. The understanding you build here is grounded in running programs on real hardware — not in memorizing definitions.

Work through every example. Run every code sample. Complete every exercise before reading the answer. The goal is not to finish the module — it is to understand it.

---

## Learning Objectives

By the end of this module, you will be able to:

- Convert integers between binary, hexadecimal, and decimal representations fluently
- Explain two's complement representation and implement arithmetic that is aware of its properties
- Describe the structure of an IEEE 754 floating point number and explain why floating point arithmetic produces unexpected results
- Use Zig's type system to reason about integer width, signedness, and overflow behavior
- Inspect the memory layout of Zig data structures using `@sizeOf`, `@alignOf`, and `@offsetOf`
- Explain what alignment and padding are and why they exist
- Implement correct floating point comparison that accounts for representation error
- Implement basic UTF-8 string operations that handle multi-byte characters correctly

---

## Setting Up Your Environment

Before writing any code, make sure you have Zig 0.16.0 installed. Verify your installation:

```bash
zig version
```

The output should be `0.16.0`. All code in this module is written for 0.16.0 and may not compile on earlier versions.

Create a directory for this module's work:

```bash
mkdir module1
cd module1
zig init
```

This creates a `build.zig` and `src/main.zig`. You will modify `src/main.zig` for most exercises. For larger projects, you will create additional source files under `src/`.

The build commands you will use throughout:

```bash
zig build run          # Build and run in Debug mode (safety checks enabled)
zig build run -Doptimize=ReleaseFast  # Build and run in ReleaseFast mode
zig test src/main.zig  # Run tests in a file
```

Always develop in Debug mode first. Debug mode enables Zig's safety checks — integer overflow detection, bounds checking, null pointer detection — that are essential for catching mistakes early.

---

## Part 1: Bits, Bytes, and the Language of the Machine

### 1.1 What the Machine Actually Knows

A computer processor is, at its core, a machine that manipulates electrical signals. Each signal is either on or off: high voltage or low voltage, magnetized or not, charged or not. This binary nature of the hardware is where everything begins.

A single binary digit — 0 or 1 — is called a **bit**. A bit is the smallest unit of information a computer can represent. It can answer exactly one yes/no question.

Eight bits grouped together form a **byte**. A byte can represent 2⁸ = 256 distinct values. This is why a byte is the unit of addressable memory: every byte in the computer's memory has a unique address, and the processor fetches and stores data in units of bytes (or multiples of bytes).

On modern 64-bit processors, the natural unit of computation is the **word** — 8 bytes, or 64 bits. The processor's registers are 64 bits wide. The maximum addressable memory on a 64-bit system is 2⁶⁴ bytes (though current hardware only implements 48 or 57 bits of address space in practice).

These are not arbitrary choices. They reflect the physical design of the processor: the width of the data buses, the size of the registers, the number of address lines. When you write `u64` in Zig, you are describing a type that maps directly to a single machine register. There is no boxing, no overhead, no abstraction. The type and the hardware are the same thing.

### 1.2 Binary and Hexadecimal

Decimal — the number system humans use — has ten digits (0-9) and uses place values that are powers of 10. Binary has two digits (0 and 1) and uses place values that are powers of 2. Hexadecimal has sixteen digits (0-9 and A-F) and uses place values that are powers of 16.

**Why binary?** Because the hardware is binary. Each bit position in a binary number corresponds to one physical signal in the circuit.

**Why hexadecimal?** Because binary numbers for even small values become unwieldy. The 8-bit value 11001010 is not easy to read or remember. The hexadecimal value `0xCA` is — and it represents exactly the same bit pattern: each hexadecimal digit represents exactly four bits (a nibble).

The correspondence between hexadecimal digits and four-bit patterns:

| Hex | Decimal | Binary |
|-----|---------|--------|
| 0   | 0       | 0000   |
| 1   | 1       | 0001   |
| 2   | 2       | 0010   |
| 3   | 3       | 0011   |
| 4   | 4       | 0100   |
| 5   | 5       | 0101   |
| 6   | 6       | 0110   |
| 7   | 7       | 0111   |
| 8   | 8       | 1000   |
| 9   | 9       | 1001   |
| A   | 10      | 1010   |
| B   | 11      | 1011   |
| C   | 12      | 1100   |
| D   | 13      | 1101   |
| E   | 14      | 1110   |
| F   | 15      | 1111   |

To convert a binary number to hexadecimal: group the bits into groups of four from the right, and replace each group with its hexadecimal equivalent.

**Example:** Convert `11001010` to hexadecimal.

Group from right: `1100` `1010`

`1100` = 12 = C  
`1010` = 10 = A

Result: `0xCA`

To convert hexadecimal to binary: replace each hex digit with its four-bit pattern.

**Example:** Convert `0x3F` to binary.

`3` = `0011`  
`F` = `1111`

Result: `00111111`

### 1.3 Binary to Decimal Conversion

Each bit position has a value equal to a power of 2. The rightmost bit (bit 0) has value 2⁰ = 1. The next bit (bit 1) has value 2¹ = 2. And so on.

To convert binary to decimal: multiply each bit by its place value and sum.

**Example:** Convert `10110101` to decimal.

| Bit position | 7  | 6  | 5  | 4  | 3  | 2  | 1  | 0  |
|--------------|----|----|----|----|----|----|----|----|
| Bit value    | 1  | 0  | 1  | 1  | 0  | 1  | 0  | 1  |
| Place value  | 128| 64 | 32 | 16 | 8  | 4  | 2  | 1  |
| Contribution | 128| 0  | 32 | 16 | 0  | 4  | 0  | 1  |

Sum: 128 + 32 + 16 + 4 + 1 = **181**

Verify in Zig: binary literals use the `0b` prefix.

```zig
const std = @import("std");

pub fn main() void {
    const x: u8 = 0b10110101;
    std.debug.print("0b10110101 = {d}\n", .{x});
    std.debug.print("0b10110101 = 0x{X}\n", .{x});
}
```

Output:
```
0b10110101 = 181
0b10110101 = 0xB5
```

Zig supports all three numeric literals:
- Decimal: `181`
- Binary: `0b10110101`
- Hexadecimal: `0xB5`

They all produce the same bit pattern in memory. Which you use is a matter of clarity: hex is convenient when thinking about bit patterns; decimal is convenient for counts and sizes.

---

> **Exercise 1.1**
>
> Without using a calculator or computer, convert the following:
>
> a) `0b01101100` to decimal and hexadecimal
> b) `0xFF` to decimal and binary
> c) `219` to binary and hexadecimal
> d) `0b1010 1010 1010 1010` to hexadecimal (this is a 16-bit value)
>
> Then write a Zig program that prints all four values in all three representations to verify your answers.

---

> **Answer 1.1**
>
> a) `0b01101100`:
> Groups: `0110` `1100` → `6` `C` → `0x6C`
> Decimal: 64 + 32 + 8 + 4 = 108
>
> b) `0xFF`:
> Binary: `1111 1111`
> Decimal: 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255
>
> c) `219`:
> 219 = 128 + 91 = 128 + 64 + 27 = 128 + 64 + 16 + 11 = 128 + 64 + 16 + 8 + 3 = 128 + 64 + 16 + 8 + 2 + 1
> Binary: `1101 1011` → `0xDB`
>
> d) `0b1010 1010 1010 1010`:
> Groups: `1010` `1010` `1010` `1010` → `A` `A` `A` `A` → `0xAAAA`

---

### 1.4 Bit Operations

The processor can apply logical operations to individual bits. These are the most fundamental operations in digital hardware, and they appear constantly in systems programming: masking fields out of packed values, setting and clearing flags, implementing efficient algorithms.

**AND (`&`):** Output is 1 only if both inputs are 1.

```
  1010 1100
& 1111 0000
-----------
  1010 0000
```

Used to **mask** bits — isolate specific bits by ANDing with a mask where the desired bits are 1 and the rest are 0.

**OR (`|`):** Output is 1 if either input is 1.

```
  1010 0000
| 0000 1111
-----------
  1010 1111
```

Used to **set** bits — force specific bits to 1 by ORing with a mask where those bits are 1.

**XOR (`^`):** Output is 1 if exactly one input is 1.

```
  1010 1100
^ 1111 0000
-----------
  0101 1100
```

Used to **toggle** bits — flip specific bits by XORing with a mask where those bits are 1. Also used in parity computation and certain encryption algorithms.

**NOT (`~`):** Inverts all bits.

```
~ 1010 1100
-----------
  0101 0011
```

**Left shift (`<<`):** Shift bits left by N positions, filling with zeros on the right. Equivalent to multiplying by 2ᴺ.

```
0000 1010 << 2 = 0010 1000
```

**Right shift (`>>`):** Shift bits right by N positions. For unsigned integers, fills with zeros on the left (logical shift). Equivalent to dividing by 2ᴺ (with truncation).

```
0010 1000 >> 2 = 0000 1010
```

In Zig:

```zig
const std = @import("std");

pub fn main() void {
    const a: u8 = 0b10101100;
    const mask: u8 = 0b11110000;

    // Extract the high nibble
    const high_nibble = (a & mask) >> 4;
    // Extract the low nibble
    const low_nibble = a & ~mask;

    std.debug.print("a = 0x{X}\n", .{a});
    std.debug.print("high nibble = {d}\n", .{high_nibble});
    std.debug.print("low nibble  = {d}\n", .{low_nibble});

    // Set a specific bit (bit 1)
    const with_bit1_set = a | (1 << 1);
    std.debug.print("with bit 1 set = 0b{b:0>8}\n", .{with_bit1_set});

    // Clear a specific bit (bit 7)
    const with_bit7_cleared = a & ~(@as(u8, 1) << 7);
    std.debug.print("with bit 7 cleared = 0b{b:0>8}\n", .{with_bit7_cleared});

    // Toggle bit 3
    const with_bit3_toggled = a ^ (1 << 3);
    std.debug.print("with bit 3 toggled = 0b{b:0>8}\n", .{with_bit3_toggled});
}
```

> **Note on Zig format strings:**
> - `{d}` — decimal
> - `{X}` — uppercase hexadecimal
> - `{x}` — lowercase hexadecimal
> - `{b}` — binary
> - `{b:0>8}` — binary, zero-padded to 8 digits, right-aligned

---

> **Exercise 1.2**
>
> A common systems programming pattern is storing multiple small values in a single integer using bit fields. Suppose you are designing a network packet header byte with the following layout:
>
> - Bits 7-6: packet type (2 bits, values 0-3)
> - Bits 5-3: priority level (3 bits, values 0-7)
> - Bits 2-0: flags (3 bits)
>
> Write Zig functions to:
> 1. Pack a packet type, priority, and flags into a single `u8`
> 2. Extract each field from a packed `u8`
> 3. Test them with the values: type=2, priority=5, flags=3
>
> Expected packed value: `0b10 101 011` = `0xAB`

---

> **Answer 1.2**
>
> ```zig
> const std = @import("std");
>
> fn pack_header(packet_type: u8, priority: u8, flags: u8) u8 {
>     return (packet_type & 0b11) << 6 |
>            (priority & 0b111) << 3  |
>            (flags & 0b111);
> }
>
> fn get_type(header: u8) u8 {
>     return (header >> 6) & 0b11;
> }
>
> fn get_priority(header: u8) u8 {
>     return (header >> 3) & 0b111;
> }
>
> fn get_flags(header: u8) u8 {
>     return header & 0b111;
> }
>
> pub fn main() void {
>     const header = pack_header(2, 5, 3);
>     std.debug.print("packed = 0x{X}\n", .{header});
>     std.debug.print("type     = {d}\n", .{get_type(header)});
>     std.debug.print("priority = {d}\n", .{get_priority(header)});
>     std.debug.print("flags    = {d}\n", .{get_flags(header)});
> }
> ```

---

## Part 2: Integer Representation

### 2.1 Unsigned Integers

An unsigned integer uses all its bits to represent a non-negative value. An `n`-bit unsigned integer can represent values from 0 to 2ⁿ - 1.

In Zig, unsigned integer types are named `u` followed by the bit width: `u8`, `u16`, `u32`, `u64`, `u128`. There are also pointer-sized integers: `usize` is the unsigned integer type large enough to hold any memory address on the target platform (64 bits on a 64-bit system).

| Type   | Bits | Min | Max           |
|--------|------|-----|---------------|
| `u8`   | 8    | 0   | 255           |
| `u16`  | 16   | 0   | 65,535        |
| `u32`  | 32   | 0   | 4,294,967,295 |
| `u64`  | 64   | 0   | 18,446,744,073,709,551,615 |
| `usize`| 64*  | 0   | 2⁶⁴ - 1       |

*on 64-bit platforms

These limits are not arbitrary. They are direct consequences of the number of bits. Knowing them matters because exceeding them is a common and dangerous source of bugs.

```zig
const std = @import("std");

pub fn main() void {
    // Zig provides compile-time constants for min and max values
    std.debug.print("u8  max = {d}\n", .{std.math.maxInt(u8)});
    std.debug.print("u16 max = {d}\n", .{std.math.maxInt(u16)});
    std.debug.print("u32 max = {d}\n", .{std.math.maxInt(u32)});
    std.debug.print("u64 max = {d}\n", .{std.math.maxInt(u64)});
}
```

### 2.2 Unsigned Integer Overflow

What happens when you exceed the maximum value of an unsigned integer? In mathematics, 255 + 1 = 256. But a `u8` can only hold values from 0 to 255. There is no 256 in an 8-bit unsigned integer.

The hardware answer is **wraparound**: the value wraps from the maximum back to zero. 255 + 1 = 0 (for `u8`). 65535 + 1 = 0 (for `u16`). This is modular arithmetic — the result is taken modulo 2ⁿ, where n is the bit width.

This behavior is not a bug in the hardware. It is a defined property. But it *is* a bug when a programmer does not expect it.

Zig's Debug mode detects unsigned integer overflow and terminates the program with an error:

```zig
const std = @import("std");

pub fn main() void {
    var x: u8 = 255;
    x += 1; // This will panic in Debug mode
    std.debug.print("x = {d}\n", .{x});
}
```

Run this in Debug mode (`zig build run`) and observe:

```
thread 1 panic: integer overflow
```

This is Zig protecting you. In C, this operation would silently wrap around and your program would continue with `x = 0` — without any indication that something went wrong.

If you *want* wrapping arithmetic — and sometimes you do, in hash functions, checksums, and certain low-level protocols — Zig provides wrapping operators:

```zig
const std = @import("std");

pub fn main() void {
    var x: u8 = 255;
    x +%= 1; // Wrapping addition: 255 +% 1 = 0
    std.debug.print("255 +%% 1 = {d}\n", .{x});

    var y: u8 = 0;
    y -%= 1; // Wrapping subtraction: 0 -% 1 = 255
    std.debug.print("0 -%%  1 = {d}\n", .{y});
}
```

The `%` suffix on an arithmetic operator means "wrapping." This forces the programmer to be explicit about the intent, making code that relies on overflow self-documenting.

> **Why does this matter?**
>
> Integer overflow is one of the most common causes of security vulnerabilities in C and C++ programs. A classic attack pattern: a program allocates a buffer whose size is computed as `count * element_size`. If both values are controlled by an attacker and their product overflows a `u32`, the allocation is too small, and subsequent writes overflow the buffer. Zig's default overflow detection catches this class of bug in development.

### 2.3 Signed Integers: Two's Complement

Representing negative numbers requires giving up some representational range and using some bits to encode the sign. The obvious approach is sign-magnitude: use the high bit to represent positive (0) or negative (1) and the remaining bits to represent the magnitude. 

Sign-magnitude works, but it has an annoying problem: it has two representations of zero (+0 and -0), and addition of positive and negative numbers requires special handling.

**Two's complement** solves both problems. It is the representation used by virtually every processor built in the last fifty years. In two's complement:

- Non-negative values are represented exactly as in unsigned
- Negative values are represented such that adding the negative and positive representations of the same magnitude produces zero (with overflow discarded)

For an n-bit two's complement integer:
- The value range is -2^(n-1) to 2^(n-1) - 1
- The high bit is the sign bit: 0 means non-negative, 1 means negative
- A negative value -x is represented as the bit pattern of (2ⁿ - x)

**Computing two's complement:** To negate a value, flip all bits and add 1.

**Example:** Represent -53 as an 8-bit two's complement integer.

53 in binary: `0011 0101`  
Flip all bits: `1100 1010`  
Add 1:        `1100 1011`

Verify: 53 + (-53) should equal 0.

```
  0011 0101  (53)
+ 1100 1011  (-53)
-----------
  0000 0000  (0, with carry out discarded)
```

This is why two's complement is used: addition is the same operation regardless of sign. The hardware does not need separate logic for adding positive and negative numbers.

| Type   | Bits | Min         | Max         |
|--------|------|-------------|-------------|
| `i8`   | 8    | -128        | 127         |
| `i16`  | 16   | -32,768     | 32,767      |
| `i32`  | 32   | -2,147,483,648 | 2,147,483,647 |
| `i64`  | 64   | -9.2 × 10¹⁸ | 9.2 × 10¹⁸ |
| `isize`| 64*  | -2⁶³        | 2⁶³ - 1    |

Notice: the minimum value of a signed integer (-128 for `i8`) has a larger magnitude than the maximum value (127 for `i8`). There is one more negative value than positive values. This asymmetry has a subtle consequence: negating the minimum value overflows, because +128 cannot be represented in `i8`.

```zig
const std = @import("std");

pub fn main() void {
    const min = std.math.minInt(i8); // -128
    std.debug.print("min i8 = {d}\n", .{min});

    // This will panic in Debug mode: negating -128 overflows i8
    // const negated = -min;

    // Safe approach: check before negating
    if (min != std.math.minInt(i8)) {
        const negated = -min;
        std.debug.print("negated = {d}\n", .{negated});
    } else {
        std.debug.print("cannot negate minimum value\n", .{});
    }
}
```

### 2.4 Signed Integer Overflow

Signed integer overflow in Zig's Debug mode also causes a panic. The behavior differs from unsigned overflow: while unsigned overflow is well-defined (wraparound), signed integer overflow is *undefined behavior* in C and C++. In Zig, it is always a detectable error in Debug mode and has defined wrapping behavior with the `+%` operator.

```zig
const std = @import("std");

pub fn main() void {
    var x: i8 = 127;
    // x += 1; // Panics in Debug: signed integer overflow

    // With wrapping arithmetic:
    x +%= 1; // 127 + 1 wraps to -128
    std.debug.print("127 +%% 1 (i8) = {d}\n", .{x});
}
```

### 2.5 Type Coercion and Casting

Zig does not perform implicit type coercions between numeric types. If you try to assign an `i32` to an `i8` without an explicit cast, the compiler rejects it. This is intentional: implicit conversions between numeric types are a common source of subtle bugs in C.

```zig
const value: i32 = 1000;
// const small: i8 = value; // Compile error: cannot implicitly cast i32 to i8
const small: i8 = @truncate(value); // Explicit truncation: 1000 mod 256 = -24
```

The explicit cast operations in Zig:

- `@intCast(x)` — cast to a different integer type; panics in Debug mode if the value does not fit
- `@truncate(x)` — cast to a narrower integer type by discarding high bits; always succeeds
- `@bitCast(x)` — reinterpret the bits as a different type without changing them
- `@as(T, x)` — coerce x to type T (only valid when the coercion is known safe at compile time)

```zig
const std = @import("std");

pub fn main() void {
    const large: i32 = 100;
    const small: i8 = @intCast(large); // Safe: 100 fits in i8
    std.debug.print("cast 100 (i32) to i8: {d}\n", .{small});

    const too_large: i32 = 1000;
    // const bad: i8 = @intCast(too_large); // Panics: 1000 does not fit in i8

    const truncated: i8 = @truncate(too_large); // Discards high bits: -24
    std.debug.print("truncate 1000 (i32) to i8: {d}\n", .{truncated});

    // @bitCast: same bits, different interpretation
    const unsigned_byte: u8 = 200;
    const signed_byte: i8 = @bitCast(unsigned_byte);
    std.debug.print("@bitCast 200 (u8) to i8: {d}\n", .{signed_byte}); // -56
}
```

The last example is important: `200` as an unsigned 8-bit integer has the bit pattern `1100 1000`. The same bit pattern interpreted as a signed 8-bit integer is `-56`. The bits have not changed. Only their interpretation has.

---

> **Exercise 1.3: Safe Integer Operations**
>
> Write a function `safe_add(a: i32, b: i32) !i32` that adds two signed 32-bit integers and returns an error if the result would overflow. The function should return `error.Overflow` in that case.
>
> Test it with:
> - `safe_add(100, 200)` → should return 300
> - `safe_add(std.math.maxInt(i32), 1)` → should return error.Overflow
> - `safe_add(std.math.minInt(i32), -1)` → should return error.Overflow
>
> Hint: overflow occurs when adding two positives produces a negative, or adding two negatives produces a positive.

---

> **Answer 1.3**
>
> ```zig
> const std = @import("std");
>
> const OverflowError = error{Overflow};
>
> fn safe_add(a: i32, b: i32) OverflowError!i32 {
>     // Check for overflow before it happens
>     if (b > 0 and a > std.math.maxInt(i32) - b) return error.Overflow;
>     if (b < 0 and a < std.math.minInt(i32) - b) return error.Overflow;
>     return a + b;
> }
>
> pub fn main() !void {
>     const result1 = try safe_add(100, 200);
>     std.debug.print("100 + 200 = {d}\n", .{result1});
>
>     const result2 = safe_add(std.math.maxInt(i32), 1);
>     if (result2) |_| {
>         std.debug.print("should not reach here\n", .{});
>     } else |err| {
>         std.debug.print("maxInt + 1 = {}\n", .{err});
>     }
>
>     const result3 = safe_add(std.math.minInt(i32), -1);
>     if (result3) |_| {
>         std.debug.print("should not reach here\n", .{});
>     } else |err| {
>         std.debug.print("minInt + (-1) = {}\n", .{err});
>     }
> }
> ```

---

## Part 3: Floating Point — A Necessary Compromise

### 3.1 The Problem with Integers

Integers can represent any whole number within their range exactly. But computers must also work with real numbers — fractions, irrational numbers, very large or very small values. How do you represent 3.14159, 0.001, or 6.022 × 10²³ in a finite number of bits?

The answer is floating point: a representation based on scientific notation. Just as `123456` can be written as `1.23456 × 10⁵`, a floating point number is represented as a significand multiplied by a power of 2.

### 3.2 IEEE 754

IEEE 754 is the standard for floating point representation, published in 1985 and adopted by virtually every processor and programming language. It defines two primary formats:

**Single precision (32-bit, `f32` in Zig):**
- 1 sign bit
- 8 exponent bits
- 23 significand bits (+ 1 implicit leading bit)

**Double precision (64-bit, `f64` in Zig):**
- 1 sign bit
- 11 exponent bits
- 52 significand bits (+ 1 implicit leading bit)

The layout of a 32-bit float in memory:

```
 31  30      23  22                    0
  S  EEEEEEEE   MMMMMMMMMMMMMMMMMMMMMMM
  |  |           |
  |  exponent    significand (mantissa)
  sign
```

The value is computed as:

`(-1)^S × 1.M × 2^(E - 127)`

Where `E` is the raw exponent value (treating the 8 exponent bits as an unsigned integer) and `127` is the **bias** (for `f32`; `f64` uses a bias of `1023`).

**Example:** What does `0 10000000 10000000000000000000000` represent?

S = 0 (positive)  
E = 10000000 = 128, biased exponent = 128 - 127 = 1  
M = 1.10000000000000000000000 = 1.5  

Value = +1.5 × 2¹ = **3.0**

### 3.3 The Precision Problem

The fundamental issue with IEEE 754 is that most real numbers cannot be represented exactly. The representable values are distributed unevenly across the number line: dense near zero, sparse for large values.

The number 0.1 in decimal has no exact representation in binary floating point. The nearest representable `f64` value is:

`0.1000000000000000055511151231257827021181583404541015625`

This difference is tiny — about 5.5 × 10⁻¹⁸. But when you perform arithmetic with inexact values, errors accumulate.

```zig
const std = @import("std");

pub fn main() void {
    const a: f64 = 0.1;
    const b: f64 = 0.2;
    const sum = a + b;

    std.debug.print("0.1 + 0.2 = {d}\n", .{sum});
    std.debug.print("0.1 + 0.2 == 0.3: {}\n", .{sum == 0.3});

    // Print with high precision to see the error
    std.debug.print("0.1 + 0.2 = {e}\n", .{sum});
    std.debug.print("0.3      = {e}\n", .{@as(f64, 0.3)});
}
```

Output:
```
0.1 + 0.2 = 0.30000000000000004
0.1 + 0.2 == 0.3: false
0.1 + 0.2 = 3.0000000000000004e-01
0.3       = 2.9999999999999999e-01
```

This is not a Zig bug. It is not a hardware bug. It is the correct result of IEEE 754 arithmetic. `0.1` and `0.2` are not exactly representable, so their sum is not exactly `0.3`.

### 3.4 Special Values

IEEE 754 reserves certain bit patterns for special values that arise from exceptional arithmetic:

**Infinity (`+∞` and `-∞`):** Produced by overflow or division of a finite number by zero. `1.0 / 0.0` = `+∞`.

**NaN (Not a Number):** Produced by operations with undefined mathematical results: `0.0 / 0.0`, `sqrt(-1.0)`, or arithmetic involving another NaN.

**Zero:** Both `+0.0` and `-0.0` exist. They compare equal but have different bit patterns.

```zig
const std = @import("std");
const math = std.math;

pub fn main() void {
    const inf = math.inf(f64);
    const nan = math.nan(f64);

    std.debug.print("inf = {d}\n", .{inf});
    std.debug.print("-inf = {d}\n", .{-inf});
    std.debug.print("nan = {d}\n", .{nan});

    // NaN is not equal to itself
    std.debug.print("nan == nan: {}\n", .{nan == nan}); // false!
    std.debug.print("nan != nan: {}\n", .{nan != nan}); // true!

    // Arithmetic with special values
    std.debug.print("inf + 1 = {d}\n", .{inf + 1.0});
    std.debug.print("inf - inf = {d}\n", .{inf - inf}); // NaN
    std.debug.print("1.0 / inf = {d}\n", .{1.0 / inf}); // 0
}
```

The NaN property `nan != nan` is the standard way to test for NaN: `x != x` is true if and only if x is NaN. Zig also provides `std.math.isNan(x)` for clarity.

### 3.5 Correct Floating Point Comparison

Never use `==` to compare floating point numbers for equality in systems code. The correct approach is to compare with a tolerance — to ask whether two values are *close enough* to be considered equal given the precision of the computation.

There are two common tolerance strategies:

**Absolute tolerance:** `|a - b| < epsilon`. Works well for numbers near zero.

**Relative tolerance:** `|a - b| / max(|a|, |b|) < epsilon`. Works well for numbers far from zero.

**Combined approach:** Use absolute tolerance when numbers are near zero, relative tolerance otherwise.

```zig
const std = @import("std");

fn approx_equal_absolute(a: f64, b: f64, epsilon: f64) bool {
    return @abs(a - b) < epsilon;
}

fn approx_equal_relative(a: f64, b: f64, epsilon: f64) bool {
    const diff = @abs(a - b);
    const max_val = @max(@abs(a), @abs(b));
    if (max_val == 0.0) return diff == 0.0;
    return diff / max_val < epsilon;
}

fn approx_equal(a: f64, b: f64) bool {
    const abs_epsilon = 1e-9;
    const rel_epsilon = 1e-9;
    const diff = @abs(a - b);
    if (diff < abs_epsilon) return true;
    const max_val = @max(@abs(a), @abs(b));
    return diff / max_val < rel_epsilon;
}

pub fn main() void {
    // The 0.1 + 0.2 problem
    std.debug.print("0.1 + 0.2 == 0.3: {}\n", .{0.1 + 0.2 == 0.3});
    std.debug.print("approx_equal(0.1+0.2, 0.3): {}\n", .{approx_equal(0.1 + 0.2, 0.3)});

    // Large numbers
    const large_a = 1_000_000.0 + 0.001;
    const large_b = 1_000_000.001;
    std.debug.print("large ==: {}\n", .{large_a == large_b});
    std.debug.print("large approx: {}\n", .{approx_equal(large_a, large_b)});
}
```

### 3.6 Inspecting Floating Point Bit Patterns

Since IEEE 754 is a bit-level representation, we can inspect and manipulate the bits of a floating point number directly using `@bitCast`.

```zig
const std = @import("std");

fn inspect_f32(x: f32) void {
    const bits: u32 = @bitCast(x);
    const sign = (bits >> 31) & 1;
    const exponent = (bits >> 23) & 0xFF;
    const significand = bits & 0x7FFFFF;

    std.debug.print("f32 {d}:\n", .{x});
    std.debug.print("  bits     = 0x{X:0>8}\n", .{bits});
    std.debug.print("  sign     = {d}\n", .{sign});
    std.debug.print("  exponent = {d} (biased), {d} (actual)\n",
        .{ exponent, @as(i32, @intCast(exponent)) - 127 });
    std.debug.print("  mantissa = 0x{X:0>6}\n", .{significand});
}

pub fn main() void {
    inspect_f32(1.0);
    inspect_f32(3.0);
    inspect_f32(-0.5);
    inspect_f32(0.1);
}
```

---

> **Exercise 1.4: Float Inspector**
>
> Extend the `inspect_f32` function to also print the actual value represented by the bit pattern, reconstructing it from the sign, exponent, and significand fields. Use the formula:
>
> `value = (-1)^sign × (1 + significand / 2^23) × 2^(exponent - 127)`
>
> For the number `3.0`:
> - sign = 0
> - exponent = 128 (biased), 1 (actual)
> - significand = 0x400000 = 4194304
> - value = +1 × (1 + 4194304 / 8388608) × 2¹ = 1 × 1.5 × 2 = 3.0

---

> **Answer 1.4**
>
> ```zig
> fn inspect_f32_full(x: f32) void {
>     const bits: u32 = @bitCast(x);
>     const sign_bit = (bits >> 31) & 1;
>     const exponent_raw = (bits >> 23) & 0xFF;
>     const significand_bits = bits & 0x7FFFFF;
>
>     const sign: f64 = if (sign_bit == 0) 1.0 else -1.0;
>     const exponent: f64 = @as(f64, @floatFromInt(exponent_raw)) - 127.0;
>     const mantissa: f64 = 1.0 + @as(f64, @floatFromInt(significand_bits)) /
>                           @as(f64, 1 << 23);
>
>     const reconstructed = sign * mantissa * std.math.pow(f64, 2.0, exponent);
>
>     std.debug.print("reconstructed = {d}\n", .{reconstructed});
> }
> ```

---

## Part 4: Characters, Strings, and Encoding

### 4.1 Characters Are Integers

The processor has no concept of a character. It does not know what 'A' means. It only knows that 'A' is the integer 65 — a convention defined by the ASCII standard in 1963 and extended by Unicode in 1991.

ASCII assigns integers 0-127 to a set of characters: 32-126 are printable characters (letters, digits, punctuation), 0-31 and 127 are control characters (newline, tab, carriage return, etc.).

| Decimal | Hex  | Character | Decimal | Hex  | Character |
|---------|------|-----------|---------|------|-----------|
| 48      | 0x30 | '0'       | 65      | 0x41 | 'A'       |
| 49      | 0x31 | '1'       | 66      | 0x42 | 'B'       |
| ...     | ...  | ...       | ...     | ...  | ...       |
| 57      | 0x39 | '9'       | 90      | 0x5A | 'Z'       |
| 10      | 0x0A | newline   | 97      | 0x61 | 'a'       |
| 32      | 0x20 | space     | 122     | 0x7A | 'z'       |

Notice that digit characters '0'-'9' have consecutive codes starting at 48 (`0x30`). This means you can convert a digit character to its numeric value by subtracting `'0'` (48). This is a common pattern in parser code.

```zig
const std = @import("std");

pub fn main() void {
    const c: u8 = 'A';
    std.debug.print("'A' as integer = {d}\n", .{c});
    std.debug.print("'A' as hex = 0x{X}\n", .{c});
    std.debug.print("'A' + 1 = '{c}'\n", .{c + 1}); // 'B'

    // Convert digit character to number
    const digit: u8 = '7';
    const value: u8 = digit - '0';
    std.debug.print("'7' - '0' = {d}\n", .{value}); // 7

    // Test if a character is a lowercase letter
    const letter: u8 = 'g';
    const is_lower = letter >= 'a' and letter <= 'z';
    std.debug.print("'g' is lowercase: {}\n", .{is_lower});

    // Convert to uppercase: clear bit 5
    const upper = letter & ~@as(u8, 0x20);
    std.debug.print("'g' to uppercase: '{c}'\n", .{upper});
}
```

The last trick — clearing bit 5 to convert lowercase to uppercase — works because in ASCII, lowercase letters differ from their uppercase counterparts only in bit 5 (the value 32 = 0x20). `'a'` = 97 = `0x61`, `'A'` = 65 = `0x41`. The difference is exactly 32.

### 4.2 Unicode and the Need for Multi-Byte Encoding

ASCII covers 128 characters — enough for English but nothing else. The world has thousands of languages, each with its own script. Unicode is the standard that assigns a unique integer (called a **code point**) to every character in every script ever used by humans: from Latin to Arabic to Chinese to ancient Cuneiform.

Unicode defines over 1.1 million code points (though only about 150,000 are currently assigned). Code points are written as U+XXXX where XXXX is a hexadecimal number. For example: U+0041 is 'A', U+4E2D is '中', U+1F600 is '😀'.

The question then becomes: how do you encode code points (which can be up to 21 bits) in memory?

**UTF-32** is the simplest: every code point uses exactly 4 bytes. Easy to implement but wastes space for text that is mostly ASCII.

**UTF-8** is the dominant encoding: variable-length encoding that uses 1 byte for ASCII (code points 0-127), 2 bytes for code points 128-2047, 3 bytes for 2048-65535, and 4 bytes for 65536-1114111. ASCII text encoded in UTF-8 is identical to ASCII — a single byte per character. UTF-8 is the encoding used in Zig string literals and the encoding you will use throughout this curriculum.

The byte structure of UTF-8:

| Code points     | Byte 1     | Byte 2     | Byte 3     | Byte 4     |
|-----------------|------------|------------|------------|------------|
| U+0000–U+007F   | 0xxxxxxx   |            |            |            |
| U+0080–U+07FF   | 110xxxxx   | 10xxxxxx   |            |            |
| U+0800–U+FFFF   | 1110xxxx   | 10xxxxxx   | 10xxxxxx   |            |
| U+10000–U+10FFFF| 11110xxx   | 10xxxxxx   | 10xxxxxx   | 10xxxxxx   |

The leading bits of the first byte tell you how many bytes the character uses: `0` for single-byte, `110` for two-byte, `1110` for three-byte, `11110` for four-byte. Continuation bytes always start with `10`.

### 4.3 Strings in Zig

In Zig, a string literal has type `*const [N:0]u8` — a pointer to a null-terminated byte array. For most purposes, you work with the slice type `[]const u8` — a pointer and a length.

Zig makes no assumption that a string is valid UTF-8. A `[]u8` is just a sequence of bytes. If you know it is UTF-8, you treat it as such; Zig does not enforce this automatically.

```zig
const std = @import("std");

pub fn main() void {
    // ASCII string: each character is one byte
    const ascii = "Hello";
    std.debug.print("'Hello' length (bytes): {d}\n", .{ascii.len});

    // UTF-8 string with multi-byte characters
    const unicode = "中文";
    std.debug.print("'中文' length (bytes): {d}\n", .{unicode.len}); // 6, not 2!

    // Iterate over bytes
    for (unicode, 0..) |byte, i| {
        std.debug.print("byte[{d}] = 0x{X}\n", .{ i, byte });
    }

    // Iterate over Unicode code points using Zig's UTF-8 iterator
    var it = std.unicode.Utf8Iterator{ .bytes = unicode, .i = 0 };
    var code_point_count: usize = 0;
    while (it.nextCodepoint()) |cp| {
        std.debug.print("U+{X:0>4}\n", .{cp});
        code_point_count += 1;
    }
    std.debug.print("code points: {d}\n", .{code_point_count}); // 2
}
```

The key lesson: **bytes ≠ characters**. `"中文".len` returns 6 because each Chinese character requires 3 bytes in UTF-8. A function that counts string length by counting bytes is wrong for non-ASCII text. Always use `std.unicode.utf8CountCodepoints` when you need character count, not byte count.

### 4.4 Implementing UTF-8 Decoding

Understanding UTF-8 deeply means being able to implement a decoder from scratch. This is not an exercise you will need to do in production code — Zig's standard library handles it — but the implementation reveals how the encoding works.

```zig
const std = @import("std");

const Utf8DecodeError = error{
    InvalidByte,
    UnexpectedContinuation,
    MissingContinuation,
    Overlong,
};

/// Decode the first code point from a UTF-8 byte slice.
/// Returns the code point and the number of bytes consumed.
fn decode_utf8(bytes: []const u8) Utf8DecodeError!struct { codepoint: u21, len: u3 } {
    if (bytes.len == 0) return error.InvalidByte;

    const first = bytes[0];

    // Single byte (ASCII): 0xxxxxxx
    if (first & 0x80 == 0) {
        return .{ .codepoint = first, .len = 1 };
    }

    // Two-byte sequence: 110xxxxx 10xxxxxx
    if (first & 0xE0 == 0xC0) {
        if (bytes.len < 2) return error.MissingContinuation;
        const b2 = bytes[1];
        if (b2 & 0xC0 != 0x80) return error.MissingContinuation;
        const cp: u21 = (@as(u21, first & 0x1F) << 6) | (b2 & 0x3F);
        if (cp < 0x80) return error.Overlong; // must have used 1-byte form
        return .{ .codepoint = cp, .len = 2 };
    }

    // Three-byte sequence: 1110xxxx 10xxxxxx 10xxxxxx
    if (first & 0xF0 == 0xE0) {
        if (bytes.len < 3) return error.MissingContinuation;
        const b2 = bytes[1];
        const b3 = bytes[2];
        if (b2 & 0xC0 != 0x80) return error.MissingContinuation;
        if (b3 & 0xC0 != 0x80) return error.MissingContinuation;
        const cp: u21 = (@as(u21, first & 0x0F) << 12) |
                        (@as(u21, b2 & 0x3F) << 6) |
                        (b3 & 0x3F);
        if (cp < 0x800) return error.Overlong;
        return .{ .codepoint = cp, .len = 3 };
    }

    // Four-byte sequence: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
    if (first & 0xF8 == 0xF0) {
        if (bytes.len < 4) return error.MissingContinuation;
        const b2 = bytes[1];
        const b3 = bytes[2];
        const b4 = bytes[3];
        if (b2 & 0xC0 != 0x80) return error.MissingContinuation;
        if (b3 & 0xC0 != 0x80) return error.MissingContinuation;
        if (b4 & 0xC0 != 0x80) return error.MissingContinuation;
        const cp: u21 = (@as(u21, first & 0x07) << 18) |
                        (@as(u21, b2 & 0x3F) << 12) |
                        (@as(u21, b3 & 0x3F) << 6) |
                        (b4 & 0x3F);
        if (cp < 0x10000) return error.Overlong;
        return .{ .codepoint = cp, .len = 4 };
    }

    // Continuation byte without leading byte, or invalid byte
    return error.InvalidByte;
}

pub fn main() !void {
    const test_strings = [_][]const u8{
        "A",      // U+0041: 1 byte
        "é",      // U+00E9: 2 bytes
        "中",     // U+4E2D: 3 bytes
        "😀",    // U+1F600: 4 bytes
    };

    for (test_strings) |s| {
        const result = try decode_utf8(s);
        std.debug.print("U+{X:0>4} ({d} bytes)\n", .{ result.codepoint, result.len });
    }
}
```

---

> **Exercise 1.5: UTF-8 Character Count**
>
> Write a function `count_codepoints(bytes: []const u8) !usize` that counts the number of Unicode code points in a UTF-8 encoded byte slice. Use your `decode_utf8` function from above.
>
> Test with:
> - `"Hello"` → 5
> - `"中文"` → 2
> - `"Hello 中文"` → 8
> - `"😀😁😂"` → 3

---

## Part 5: Data Layout in Memory

### 5.1 Memory as a Flat Array

The computer's memory is a flat sequence of bytes. Each byte has an address — a non-negative integer starting at 0 and increasing by 1 for each successive byte. On a 64-bit system, addresses are 64-bit values, which allows for up to 2⁶⁴ bytes of addressable memory (though no current system has anywhere near that much physical memory).

When you write a Zig program and declare a variable, the compiler assigns it a location in memory. The variable's value is stored at that address, occupying as many bytes as its type requires. A `u8` occupies 1 byte. A `u32` occupies 4 bytes. A `u64` occupies 8 bytes.

You can observe this in Zig by printing the address of a variable:

```zig
const std = @import("std");

pub fn main() void {
    var a: u8 = 10;
    var b: u32 = 20;
    var c: u64 = 30;

    std.debug.print("a: address = 0x{X}, size = {d}\n",
        .{ @intFromPtr(&a), @sizeOf(u8) });
    std.debug.print("b: address = 0x{X}, size = {d}\n",
        .{ @intFromPtr(&b), @sizeOf(u32) });
    std.debug.print("c: address = 0x{X}, size = {d}\n",
        .{ @intFromPtr(&c), @sizeOf(u64) });
}
```

Run this and observe the addresses. They will be different every time you run the program (the OS randomizes stack addresses for security), but the *relationships* between addresses will be consistent.

### 5.2 Alignment

Memory alignment is the requirement that data be stored at an address that is a multiple of its size. A `u32` (4 bytes) should be stored at an address divisible by 4. A `u64` (8 bytes) should be stored at an address divisible by 8.

Why does alignment matter? Because the processor fetches data from memory in aligned chunks. On most architectures, loading an unaligned `u32` (a `u32` at an address not divisible by 4) either generates a hardware exception (fault) or requires two memory operations instead of one (and may be several times slower). Modern processors handle unaligned access transparently in hardware, but with a performance penalty.

Zig's `@alignOf(T)` returns the required alignment for type `T`:

```zig
const std = @import("std");

pub fn main() void {
    std.debug.print("@alignOf(u8)   = {d}\n", .{@alignOf(u8)});   // 1
    std.debug.print("@alignOf(u16)  = {d}\n", .{@alignOf(u16)});  // 2
    std.debug.print("@alignOf(u32)  = {d}\n", .{@alignOf(u32)});  // 4
    std.debug.print("@alignOf(u64)  = {d}\n", .{@alignOf(u64)});  // 8
    std.debug.print("@alignOf(f32)  = {d}\n", .{@alignOf(f32)});  // 4
    std.debug.print("@alignOf(f64)  = {d}\n", .{@alignOf(f64)});  // 8
    std.debug.print("@alignOf(bool) = {d}\n", .{@alignOf(bool)}); // 1
}
```

### 5.3 Struct Layout and Padding

A struct in Zig is a collection of fields laid out consecutively in memory — but with padding inserted between fields to satisfy alignment requirements.

Consider this struct:

```zig
const Example = struct {
    a: u8,   // 1 byte, alignment 1
    b: u32,  // 4 bytes, alignment 4
    c: u8,   // 1 byte, alignment 1
};
```

Without padding, `a` would be at offset 0, `b` at offset 1, and `c` at offset 5. But `b` at offset 1 is not aligned to a 4-byte boundary (1 is not divisible by 4). The compiler therefore inserts 3 bytes of padding after `a`:

```
Offset 0: a (1 byte)
Offset 1: [padding] (3 bytes)
Offset 4: b (4 bytes)
Offset 8: c (1 byte)
Offset 9: [padding] (3 bytes)  ← struct size must be multiple of max alignment
Total: 12 bytes
```

The padding at the end ensures that if you create an array of `Example`, each element is properly aligned.

```zig
const std = @import("std");

const Example = struct {
    a: u8,
    b: u32,
    c: u8,
};

pub fn main() void {
    std.debug.print("@sizeOf(Example)          = {d}\n", .{@sizeOf(Example)});
    std.debug.print("@offsetOf(Example, 'a')   = {d}\n", .{@offsetOf(Example, "a")});
    std.debug.print("@offsetOf(Example, 'b')   = {d}\n", .{@offsetOf(Example, "b")});
    std.debug.print("@offsetOf(Example, 'c')   = {d}\n", .{@offsetOf(Example, "c")});
}
```

Output:
```
@sizeOf(Example)          = 12
@offsetOf(Example, 'a')   = 0
@offsetOf(Example, 'b')   = 4
@offsetOf(Example, 'c')   = 8
```

### 5.4 Optimizing Struct Layout

You can reduce padding — and therefore struct size — by ordering fields from largest alignment to smallest:

```zig
const Optimized = struct {
    b: u32,  // 4 bytes at offset 0 (aligned to 4)
    a: u8,   // 1 byte at offset 4
    c: u8,   // 1 byte at offset 5
    // 2 bytes padding to reach next multiple of 4
};
// Total: 8 bytes (vs 12 for Example)
```

```zig
const std = @import("std");

const Unoptimized = struct {
    a: u8,
    b: u32,
    c: u8,
};

const Optimized = struct {
    b: u32,
    a: u8,
    c: u8,
};

pub fn main() void {
    std.debug.print("Unoptimized size = {d}\n", .{@sizeOf(Unoptimized)}); // 12
    std.debug.print("Optimized size   = {d}\n", .{@sizeOf(Optimized)});   // 8
}
```

This matters. If you have a data structure holding a million records and each record has poor field ordering that wastes 4 bytes, that is 4 megabytes of wasted memory. More importantly, it means fewer records fit in a cache line, which reduces cache efficiency.

### 5.5 Packed Structs

When you need complete control over memory layout — for hardware register access, binary protocol implementation, or interoperability with C structures — Zig provides `packed struct`. A packed struct has no padding: fields are placed at consecutive bit positions.

```zig
const std = @import("std");

// An IP header flag field: 3 bits
const IpFlags = packed struct(u3) {
    reserved: u1,
    dont_fragment: u1,
    more_fragments: u1,
};

// An Ethernet frame header fragment
const PacketHeader = packed struct(u16) {
    version: u4,
    ihl: u4,
    dscp: u6,
    ecn: u2,
};

pub fn main() void {
    std.debug.print("@sizeOf(IpFlags)     = {d} bytes\n", .{@sizeOf(IpFlags)});
    std.debug.print("@bitSizeOf(IpFlags)  = {d} bits\n", .{@bitSizeOf(IpFlags)});

    var flags = IpFlags{
        .reserved = 0,
        .dont_fragment = 1,
        .more_fragments = 0,
    };
    std.debug.print("flags as u3 = {d}\n", .{@as(u3, @bitCast(flags))});
    _ = flags;
}
```

Packed structs are powerful for protocol work but come with restrictions: you cannot take a pointer to a field smaller than 8 bits, and certain operations that are safe on regular structs may not be safe on packed structs.

### 5.6 Arrays and Slices in Memory

An array in Zig is a contiguous sequence of elements of the same type. `[4]u32` is four `u32` values laid out consecutively in memory, occupying 16 bytes total.

```zig
const std = @import("std");

pub fn main() void {
    const arr = [4]u32{ 10, 20, 30, 40 };

    std.debug.print("Array size: {d} bytes\n", .{@sizeOf([4]u32)});

    for (arr, 0..) |elem, i| {
        std.debug.print("arr[{d}] at offset {d}: {d}\n",
            .{ i, i * @sizeOf(u32), elem });
    }

    // Pointer arithmetic: &arr[i] = &arr[0] + i * @sizeOf(u32)
    const base_addr = @intFromPtr(&arr[0]);
    for (0..4) |i| {
        const expected_addr = base_addr + i * @sizeOf(u32);
        const actual_addr = @intFromPtr(&arr[i]);
        std.debug.print("arr[{d}]: expected 0x{X}, actual 0x{X}, match: {}\n",
            .{ i, expected_addr, actual_addr, expected_addr == actual_addr });
    }
}
```

A **slice** is a fat pointer: a pointer plus a length.

```zig
const arr = [4]u32{ 10, 20, 30, 40 };
const slice: []const u32 = arr[1..3]; // elements at index 1 and 2
// slice.ptr points to arr[1]
// slice.len = 2
```

Slices are how Zig passes arrays to functions. You rarely pass a fixed-size array directly; you pass a slice, which allows the function to work with arrays of any length.

---

> **Exercise 1.6: Struct Layout Investigation**
>
> For each of the following structs, predict the size and field offsets, then verify using `@sizeOf` and `@offsetOf`:
>
> ```zig
> const A = struct {
>     x: u64,
>     y: u32,
>     z: u8,
> };
>
> const B = struct {
>     z: u8,
>     y: u32,
>     x: u64,
> };
>
> const C = struct {
>     a: u8,
>     b: u8,
>     c: u16,
>     d: u32,
>     e: u64,
> };
>
> const D = struct {
>     a: bool,
>     b: u64,
>     c: bool,
>     d: u64,
> };
> ```
>
> For each struct: what is the minimum possible size (sum of field sizes)? What is the actual size? Where is the padding?

---

> **Answer 1.6**
>
> ```
> A: fields u64(8), u32(4), u8(1) = 13 bytes minimum
>    layout: x@0(8), y@8(4), z@12(1), padding@13(3)
>    actual size: 16 (padded to multiple of 8, the max alignment)
>
> B: fields u8(1), u32(4), u64(8) = 13 bytes minimum
>    layout: z@0(1), padding@1(3), y@4(4), x@8(8)
>    actual size: 16
>
> C: fields u8+u8+u16+u32+u64 = 1+1+2+4+8 = 16 bytes minimum
>    layout: a@0(1), b@1(1), c@2(2), d@4(4), e@8(8)
>    actual size: 16 — no padding needed! Fields are ordered by ascending size
>
> D: fields bool+u64+bool+u64 = 1+8+1+8 = 18 bytes minimum
>    layout: a@0(1), padding@1(7), b@8(8), c@16(1), padding@17(7), d@24(8)
>    actual size: 32 — the bool fields cause significant padding waste
>    Optimized: move the bools together: b@0(8), d@8(8), a@16(1), c@17(1), padding@18(6) = 24 bytes
> ```

---

## Part 6: The Module Project — A Binary Data Inspector

The module project applies everything from this module to a real problem: inspecting the binary contents of arbitrary data. You will build a program called `binspect` that accepts binary input and displays it in multiple representations simultaneously.

### Project Specification

`binspect` reads bytes from standard input and displays them in three columns:
1. Hexadecimal — the raw bytes
2. Decimal — the decimal value of each byte
3. ASCII — the printable character (or `.` for non-printable)

Additionally, `binspect` supports an analysis mode (`--analyze`) that reads a binary stream and interprets it as a sequence of typed values: it tries to interpret the data as various integer and floating-point types and displays all interpretations.

The output format for hex dump mode (16 bytes per line):

```
00000000  48 65 6C 6C 6F 2C 20 57 6F 72 6C 64 21 0A 00 00  Hello, World!...
00000010  2A 00 00 00 00 00 00 00 FF 7F 00 00 00 00 00 00  *...............
```

The analyze mode output for a 4-byte input `0xDE 0xAD 0xBE 0xEF`:

```
Bytes:   DE AD BE EF
u8[0]:   222
u8[1]:   173
u8[2]:   190
u8[3]:   239
u16[0]:  44510 (0xADDE) [little-endian]
u16[1]:  61374 (0xEFBE) [little-endian]
u32:     4022250974 (0xEFBEADDE) [little-endian]
i32:     -272716322
f32:     -6.2598534e+18
```

### Implementation Guide

**Step 1: Reading input**

```zig
const std = @import("std");

pub fn main() !void {
    const stdin = std.io.getStdIn();
    const stdout = std.io.getStdOut().writer();

    var buf: [4096]u8 = undefined;
    var total_bytes: usize = 0;

    // Read all input into a buffer
    // For large files, you would process in chunks
    const bytes_read = try stdin.read(&buf);
    total_bytes = bytes_read;

    _ = total_bytes;
    _ = stdout;
    // TODO: display the bytes
}
```

**Step 2: Hex dump display**

The hex dump format has three parts per line:
- An 8-digit hex offset showing the position of the first byte in the line
- Sixteen hex byte values, space-separated (with a gap between the 8th and 9th)
- An ASCII representation where printable characters show as themselves and non-printable as `.`

```zig
fn hex_dump(bytes: []const u8, writer: anytype) !void {
    const bytes_per_line = 16;
    var offset: usize = 0;

    while (offset < bytes.len) {
        const line_bytes = bytes[offset..@min(offset + bytes_per_line, bytes.len)];

        // Print offset
        try writer.print("{X:0>8}  ", .{offset});

        // Print hex values
        for (line_bytes, 0..) |byte, i| {
            if (i == 8) try writer.print(" ", .{});
            try writer.print("{X:0>2} ", .{byte});
        }

        // Padding if line is shorter than 16 bytes
        const missing = bytes_per_line - line_bytes.len;
        for (0..missing) |i| {
            if (line_bytes.len + i == 8) try writer.print(" ", .{});
            try writer.print("   ", .{});
        }

        // Print ASCII representation
        try writer.print(" ", .{});
        for (line_bytes) |byte| {
            if (byte >= 32 and byte < 127) {
                try writer.print("{c}", .{byte});
            } else {
                try writer.print(".", .{});
            }
        }

        try writer.print("\n", .{});
        offset += bytes_per_line;
    }
}
```

**Step 3: Multi-type analysis**

Using `@bitCast` to interpret the same bytes as different types:

```zig
fn analyze(bytes: []const u8, writer: anytype) !void {
    try writer.print("Bytes: ", .{});
    for (bytes) |b| try writer.print("{X:0>2} ", .{b});
    try writer.print("\n\n", .{});

    // Individual bytes as u8
    for (bytes, 0..) |b, i| {
        try writer.print("u8[{d}]:  {d} (0x{X:0>2})\n", .{ i, b, b });
    }
    try writer.print("\n", .{});

    // Pairs as u16 (little-endian)
    var i: usize = 0;
    while (i + 1 < bytes.len) : (i += 2) {
        const val = std.mem.readInt(u16, bytes[i..][0..2], .little);
        try writer.print("u16[{d}]: {d} (0x{X:0>4}) [LE]\n", .{ i / 2, val, val });
    }
    try writer.print("\n", .{});

    // Full buffer as u32 if 4+ bytes
    if (bytes.len >= 4) {
        const u32_val = std.mem.readInt(u32, bytes[0..4], .little);
        const i32_val: i32 = @bitCast(u32_val);
        const f32_val: f32 = @bitCast(u32_val);

        try writer.print("u32:     {d} (0x{X:0>8}) [LE]\n", .{ u32_val, u32_val });
        try writer.print("i32:     {d}\n", .{i32_val});
        try writer.print("f32:     {e}\n", .{f32_val});
    }
}
```

**Step 4: Assembling the program**

Complete `binspect` by combining the above, adding command-line argument parsing to switch between modes.

### Extension Challenges

After completing the base implementation, extend `binspect` with:

1. **Endianness display:** Show both little-endian and big-endian interpretations for multi-byte values
2. **Struct overlay:** Accept a struct definition on the command line (e.g., `"u32,u8,u8,u16"`) and interpret the bytes as that struct, showing field values and offsets
3. **Statistical analysis:** For longer inputs, compute the frequency of each byte value and display a histogram

---

## Summary

This module has built the foundation for everything that follows. The key concepts:

**Bits and bytes** are the language of the machine. Every value — integer, float, character, struct — is a pattern of bits interpreted according to a type. Understanding this interpretation at the bit level is the first step to understanding how programs actually work.

**Integer arithmetic** on the machine is modular arithmetic. Overflow is a real concern; Zig's Debug mode detects it, but production code must be designed so it cannot occur, or must use wrapping arithmetic explicitly.

**Two's complement** is the universal representation for signed integers on modern hardware. Its elegance — making addition the same operation for signed and unsigned values — is why it has dominated for fifty years.

**Floating point** is an approximation of real arithmetic. Never test floating point values for equality with `==`; always use tolerance-based comparison. Understand the precision limits of `f32` and `f64` before choosing between them.

**Characters are integers.** Strings are byte sequences. Text encoding is explicit, not automatic. UTF-8 is the dominant encoding; byte length and character count are different things.

**Memory layout** is determined by size and alignment. Structs have padding inserted by the compiler to satisfy alignment requirements. Field ordering affects total struct size. `@sizeOf`, `@alignOf`, and `@offsetOf` make these concrete and observable.

---

## What's Next

Module 2 builds on this foundation to understand how the processor executes instructions: registers, the instruction set, the call stack, pipelining, and the memory hierarchy. The data representation knowledge from this module is prerequisite — in Module 2, you will read machine code that operates on the integers and floats you have learned to represent.

---

## Reference: Zig Numeric Types

| Type    | Size   | Range                              | Notes               |
|---------|--------|------------------------------------|---------------------|
| `u8`    | 1 byte | 0 to 255                           |                     |
| `u16`   | 2 bytes| 0 to 65,535                        |                     |
| `u32`   | 4 bytes| 0 to 4,294,967,295                 |                     |
| `u64`   | 8 bytes| 0 to 18.4 × 10¹⁸                  |                     |
| `usize` | 8 bytes| 0 to 2⁶⁴-1 (on 64-bit)            | Pointer-sized       |
| `i8`    | 1 byte | -128 to 127                        |                     |
| `i16`   | 2 bytes| -32,768 to 32,767                  |                     |
| `i32`   | 4 bytes| -2.1×10⁹ to 2.1×10⁹               |                     |
| `i64`   | 8 bytes| -9.2×10¹⁸ to 9.2×10¹⁸             |                     |
| `isize` | 8 bytes| -2⁶³ to 2⁶³-1 (on 64-bit)         | Pointer-sized signed|
| `f32`   | 4 bytes| ±3.4×10³⁸ (7 significant digits)  | IEEE 754 single     |
| `f64`   | 8 bytes| ±1.8×10³⁰⁸ (15 significant digits)| IEEE 754 double     |

## Reference: Zig Operators for Systems Programming

| Operator | Meaning                        | Panics on overflow? |
|----------|--------------------------------|---------------------|
| `+`      | Addition                       | Yes (Debug mode)    |
| `-`      | Subtraction                    | Yes (Debug mode)    |
| `*`      | Multiplication                 | Yes (Debug mode)    |
| `+%`     | Wrapping addition              | No                  |
| `-%`     | Wrapping subtraction           | No                  |
| `*%`     | Wrapping multiplication        | No                  |
| `+|`     | Saturating addition            | No (clamps to max)  |
| `-|`     | Saturating subtraction         | No (clamps to min)  |
| `&`      | Bitwise AND                    | N/A                 |
| `\|`     | Bitwise OR                     | N/A                 |
| `^`      | Bitwise XOR                    | N/A                 |
| `~`      | Bitwise NOT                    | N/A                 |
| `<<`     | Left shift                     | Yes (Debug mode)    |
| `>>`     | Right shift                    | N/A                 |

## Reference: Zig Intrinsics Used in This Module

| Intrinsic            | Purpose                                           |
|----------------------|---------------------------------------------------|
| `@sizeOf(T)`         | Size of type T in bytes                           |
| `@alignOf(T)`        | Alignment requirement of type T in bytes          |
| `@offsetOf(T, "f")`  | Byte offset of field f within struct T            |
| `@bitSizeOf(T)`      | Size of type T in bits                            |
| `@intCast(x)`        | Cast integer; panics if value does not fit        |
| `@truncate(x)`       | Cast to narrower type by discarding bits          |
| `@bitCast(x)`        | Reinterpret bit pattern as different type         |
| `@as(T, x)`          | Coerce x to type T                                |
| `@intFromPtr(p)`     | Convert pointer to integer address                |
| `@ptrFromInt(n)`     | Convert integer address to pointer                |
| `@abs(x)`            | Absolute value                                    |
| `@min(a, b)`         | Minimum of two values                             |
| `@max(a, b)`         | Maximum of two values                             |

---

*End of Module 1*
