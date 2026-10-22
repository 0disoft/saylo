export const DEFAULT_DEV_REQUEST_TIMEOUT_MS = 5000;
export const MAX_TIMER_DURATION_MS = 2147483647;
export const DEV_HANDSHAKE_MAX_ATTEMPTS = 3;

export const DEV_DISK_POLICY = Object.freeze({
  earlyRecheckMs: 10,
  middleRecheckMs: 30,
  trailingRecheckMs: 60,
  quietWindowMs: 40,
  maxQueueWaitMs: 200,
});
