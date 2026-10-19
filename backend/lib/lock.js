// Per-key async mutex: serialises confirmation/fulfillment transitions for one order within this process.
const chains = new Map();

async function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => current);
  chains.set(key, next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(key) === next) chains.delete(key);
  }
}

module.exports = { withLock };
