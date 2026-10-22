/** The wrapper owns both servers; one cleanup failure must not skip the other. */
export function createServerCloser(vite, server) {
  let closing;
  return () => closing ??= Promise.resolve().then(async () => {
    const errors = [];
    try { await vite?.close(); }
    catch (error) { errors.push(error); }
    finally {
      try {
        await new Promise((resolve, reject) => server.close(error => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        }));
      } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'SSR server cleanup failed after attempting every resource.');
  });
}
