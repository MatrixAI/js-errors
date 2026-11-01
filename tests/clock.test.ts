import { jest } from '@jest/globals';

const originalPerformance = Object.getOwnPropertyDescriptor(
  globalThis,
  'performance',
);

function setPerformance(value: unknown) {
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalPerformance != null) {
    Object.defineProperty(globalThis, 'performance', originalPerformance);
  } else {
    Reflect.deleteProperty(globalThis, 'performance');
  }
});

describe('portable timestamp clock', () => {
  test('uses the epoch origin and preserves the performance receiver', async () => {
    setPerformance({
      timeOrigin: 1700000000000,
      now() {
        expect(this.timeOrigin).toBe(1700000000000);
        return 123.75;
      },
    });
    const wall = jest.spyOn(Date, 'now').mockReturnValue(42);
    const { timestampNow } = await import('#clock.js');
    expect(timestampNow()).toBe(1700000000123);
    expect(wall).not.toHaveBeenCalled();
  });

  test.each([
    undefined,
    null,
    {},
    { now: () => 5 },
    { timeOrigin: 1000 },
    { timeOrigin: '1000', now: () => 5 },
    { timeOrigin: NaN, now: () => 5 },
    { timeOrigin: Infinity, now: () => 5 },
    { timeOrigin: 1000, now: () => NaN },
    { timeOrigin: 1000, now: () => Infinity },
    { timeOrigin: 8.64e15, now: () => 100 },
    {
      timeOrigin: 1000,
      now: () => {
        throw new Error('unavailable');
      },
    },
  ])(
    'falls back for an absent or unusable performance API: %p',
    async (clock) => {
      setPerformance(clock);
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const { timestampNow } = await import('#clock.js');
      expect(timestampNow()).toBe(1700000000000);
    },
  );

  test('handles a restricted global getter', async () => {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      get() {
        throw new Error('access denied');
      },
    });
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { timestampNow } = await import('#clock.js');
    expect(timestampNow()).toBe(1000);
  });

  test('allows equality and clamps backwards wall-clock movement', async () => {
    setPerformance(undefined);
    const wall = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { timestampNow } = await import('#clock.js');
    expect(timestampNow()).toBe(1000);
    expect(timestampNow()).toBe(1000);
    wall.mockReturnValue(900);
    expect(timestampNow()).toBe(1000);
    wall.mockReturnValue(1100);
    expect(timestampNow()).toBe(1100);
  });

  test('clamps across clock capability changes and coarse precision', async () => {
    let relative = 10.9;
    setPerformance({ timeOrigin: 1000, now: () => relative });
    const { timestampNow } = await import('#clock.js');
    expect(timestampNow()).toBe(1010);
    relative = 10.1;
    expect(timestampNow()).toBe(1010);
    setPerformance(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(900);
    expect(timestampNow()).toBe(1010);
    setPerformance({ timeOrigin: 1000, now: () => 20 });
    expect(timestampNow()).toBe(1020);
  });

  test('preserves explicit timestamps and JSON without sampling or poisoning the clock', async () => {
    setPerformance(undefined);
    const wall = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { AbstractError } = await import('#index.js');
    const future = new Date(9000000000000);
    const explicit = new AbstractError('explicit', { timestamp: future });
    expect(explicit.timestamp).toBe(future);
    expect(
      AbstractError.fromJSON(JSON.parse(JSON.stringify(explicit))).timestamp,
    ).toEqual(future);
    expect(wall).not.toHaveBeenCalled();
    expect(new AbstractError().timestamp.getTime()).toBe(1000);
    wall.mockReturnValue(900);
    class DomainError extends AbstractError<void> {}
    expect(new DomainError().timestamp.getTime()).toBe(1000);
  });
});
