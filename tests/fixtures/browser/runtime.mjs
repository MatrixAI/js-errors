import { AbstractError, utils } from '@matrixai/errors';

class BrowserError extends AbstractError {
  static description = 'portable';
}

const first = new BrowserError('browser', {
  data: { runtime: 'web' },
  cause: new Error('cause'),
});
const second = new BrowserError();
const decoded = BrowserError.fromJSON(JSON.parse(JSON.stringify(first)));
const result = {
  name: first.name,
  description: decoded.description,
  timestamp: first.timestamp.getTime(),
  monotonic: second.timestamp.getTime() >= first.timestamp.getTime(),
  decoded:
    decoded.message === first.message &&
    decoded.timestamp.getTime() === first.timestamp.getTime(),
  graph: utils.checkError(
    new AggregateError([first]),
    (value) => value === first.cause,
  ),
};

if (typeof globalThis.document === 'object') {
  globalThis.errorsResult = result;
} else {
  globalThis.postMessage(result);
}
