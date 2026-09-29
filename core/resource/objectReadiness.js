// Builders register asynchronous preparation on the actual runtime object.
// Consumers do not need to import optional builders or guess library type flags.
const readiness = new WeakMap();

export function registerObjectReadiness(object, ready) {
  const completion = Promise.resolve(ready).then(() => object);
  completion.catch(() => {}); // ordinary interactive scenes may not await it
  readiness.set(object, completion);
  return object;
}

export function whenObjectReady(object) {
  return readiness.get(object) || Promise.resolve(object);
}
