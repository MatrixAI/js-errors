/** Read epoch milliseconds using the portable performance clock or wall clock. */
function readEpochMilliseconds(): number {
  try {
    const performance = globalThis.performance;
    if (
      performance != null &&
      typeof performance.timeOrigin === 'number' &&
      typeof performance.now === 'function'
    ) {
      const elapsed = performance.now();
      if (typeof elapsed === 'number') {
        const candidate = performance.timeOrigin + elapsed;
        if (Number.isFinite(candidate) && Math.abs(candidate) <= 8.64e15) {
          return candidate;
        }
      }
    }
  } catch {
    // Restricted hosts can expose throwing performance capabilities.
  }
  const timestamp = Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) {
    throw new RangeError('Wall clock must return a valid epoch timestamp');
  }
  return timestamp;
}

/** Internal epoch clock with module-local weakly monotonic timestamps. */
let lastTimestamp = -Infinity;

function timestampNow(): number {
  const timestamp = readEpochMilliseconds();
  // Date has millisecond precision. Equality is intentional, not a sequence ID.
  lastTimestamp = Math.max(lastTimestamp, Math.trunc(timestamp));
  return lastTimestamp;
}

export { readEpochMilliseconds, timestampNow };
