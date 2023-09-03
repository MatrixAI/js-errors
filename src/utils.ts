/**
 * Checks an error against a predicate recursively.
 * This handles both `AggregateError` and `Error`.
 * This recursively checks against the `cause` property.
 */
function checkError(
  error: unknown,
  p: (error: unknown) => boolean,
  visited: Set<unknown> = new Set<unknown>(),
): boolean {
  if (visited.has(error)) return false;
  visited.add(error);
  const status = p(error);
  if (status) return true;
  if (error instanceof AggregateError) {
    for (const e of error.errors) {
      const status = checkError(e, p, visited);
      if (status) return status;
    }
    return checkError(error.cause, p, visited);
  } else if (error instanceof Error) {
    return checkError(error.cause, p, visited);
  }
  return false;
}

export { checkError };
