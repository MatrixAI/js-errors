import type * as Errors from '#index.js';
import { expect, test } from './fixture.js';
import { browserRealms } from './utils.js';

for (const realm of browserRealms) {
  test(`errors and their timestamps work in a ${realm}`, async ({
    browserScenario,
  }) => {
    const result = await browserScenario<
      typeof Errors,
      {
        name: string;
        description: string;
        timestamp: number;
        monotonic: boolean;
        decoded: boolean;
        graph: boolean;
      }
    >(realm, async (library) => {
      class BrowserError extends library.AbstractError<Error> {
        public static description = 'portable';
      }
      const first = new BrowserError('browser', {
        data: { runtime: 'web' },
        cause: new Error('cause'),
      });
      const second = new BrowserError();
      const decoded = BrowserError.fromJSON(JSON.parse(JSON.stringify(first)));
      return {
        name: first.name,
        description: decoded.description,
        timestamp: first.timestamp.getTime(),
        monotonic: second.timestamp.getTime() >= first.timestamp.getTime(),
        decoded:
          decoded.message === first.message &&
          decoded.timestamp.getTime() === first.timestamp.getTime(),
        graph: library.utils.checkError(
          new AggregateError([first]),
          (value) => value === first.cause,
        ),
      };
    });
    expect(result.name).toBe('BrowserError');
    expect(result.description).toBe('portable');
    expect(result.monotonic).toBe(true);
    expect(result.decoded).toBe(true);
    expect(result.graph).toBe(true);
    expect(Math.abs(Date.now() - result.timestamp)).toBeLessThan(60_000);
  });
}
