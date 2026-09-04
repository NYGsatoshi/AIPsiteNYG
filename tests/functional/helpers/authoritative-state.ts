import { boundedArtifactJson } from './redaction.mjs';

export interface AuthoritativeWaitOptions<T> {
  label: string;
  timeoutMs?: number;
  initialIntervalMs?: number;
  isReady: (value: T) => boolean;
  signal?: AbortSignal;
}

export async function waitForAuthoritativeState<T>(
  probe: () => Promise<T>,
  options: AuthoritativeWaitOptions<T>
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  let intervalMs = options.initialIntervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;

  while (Date.now() <= deadline) {
    if (options.signal?.aborted) {
      throw new Error(`${options.label} was aborted while waiting for authoritative state.`);
    }

    lastValue = await probe();
    if (options.isReady(lastValue)) {
      return lastValue;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    await delay(Math.min(intervalMs, remaining), options.signal);
    intervalMs = Math.min(Math.ceil(intervalMs * 1.5), 1_000);
  }

  throw new Error(
    `${options.label} did not reach authoritative state within ${timeoutMs}ms. ` +
      `Last value=${boundedArtifactJson(lastValue, 2048)}`
  );
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Authoritative-state wait aborted.'));
      },
      { once: true }
    );
  });
}
