/** Order writes to each saved row so a slow request cannot overwrite a newer edit. */
export function createWriteQueue() {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, write: () => Promise<T>): Promise<T> {
      const previous = pending.get(key) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(write);
      pending.set(key, next);
      const clear = () => {
        if (pending.get(key) === next) pending.delete(key);
      };
      void next.then(clear, clear);
      return next;
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending.values()]);
    },
  };
}
