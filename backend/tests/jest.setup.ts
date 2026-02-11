/**
 * Jest Global Setup
 *
 * Ensures all async handles are cleaned up after tests complete.
 * Fixes Jest hanging due to:
 * - Prisma's process.on('beforeExit') handler keeping event loop alive
 * - Express/supertest server handles not being closed
 * - Unclosed timers or pending promises
 */

// Increase default timeout for CI environments with slow I/O
jest.setTimeout(30000);

// Remove all 'beforeExit' listeners registered by Prisma's singleton
// (prisma.ts registers process.on('beforeExit', () => prisma.$disconnect()))
// This prevents the event loop from staying open after tests complete.
afterAll(async () => {
    // Clear any Prisma beforeExit handlers
    process.removeAllListeners('beforeExit');

    // Clear any pending timers
    jest.clearAllTimers();

    // Give a small window for any final async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 100));
});
