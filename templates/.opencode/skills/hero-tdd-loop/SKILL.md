---
name: hero-tdd-loop
description: Drive the red-green-refactor TDD loop for a chosen GitHub issue. Loaded when the user runs /tdd <issue-ref>.
---

# TDD Loop

You are implementing one GitHub issue with strict test-first discipline. Skipping the red phase is the most common failure mode here — guard against it.

## Process

1. **Load the issue.** Run `!gh issue view <number>` to read the title, body, and acceptance criteria. Restate them in your own words and confirm with the user before writing any code.
2. **Identify the smallest meaningful test.** Pick one acceptance criterion. Translate it into one failing test against the externally observable behaviour (not implementation details). Show the user the test before running it.
3. **Red.** Run the test. Confirm it fails for the right reason (missing implementation, not syntax error). Quote the failure to the user.
4. **Green.** Implement the simplest code that makes the test pass. Avoid premature abstraction — three lines of duplication is fine. Run the test; confirm pass.
5. **Refactor.** Only if there is a real cleanup to do. Don't invent abstractions. Re-run all tests after each refactor.
6. **Repeat** for the next acceptance criterion until the issue is fully covered.
7. **Verify the full suite.** Run `/verify` (or the project's verify command) at least once before declaring done. Surface the result.
8. **Mark done.** Run the `mark-issue-done` tool with the issue number and a one-line completion comment.

## What "externally observable behaviour" means

Test what the caller can see — return values, side effects, error states. Do not test private functions, internal state machines, or implementation choices. If the test would change because you refactored without changing behaviour, the test is testing the wrong thing.

## What you must NOT do

- Write implementation before the test.
- Write more code than the current test requires.
- Skip the red phase ("the test will obviously fail").
- Add features the issue doesn't ask for.
- Mark the issue done if any test in the suite is failing — even one not related to your change.

## When stuck

If you cannot articulate a failing test for the next acceptance criterion, stop and ask the user. The criterion may be unclear, or you may need to re-scope the slice. Don't muddle through — that's how dead code lands.

## Coordination

If the issue has `Blocked by: #N`, check the blocker's state via `gh issue view N`. If it's still open, refuse to proceed and tell the user.
