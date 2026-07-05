/** 画布编辑副作用抑制（载入/自适应/历史回放期间避免误记 dirty 与历史）。 */
export function createEditorSuppressCanvasDirty() {
  let count = 0;

  function isSuppressed() {
    return count > 0;
  }

  function run(fn) {
    count += 1;
    try {
      return fn();
    } finally {
      count -= 1;
    }
  }

  async function runAsync(fn) {
    count += 1;
    try {
      return await fn();
    } finally {
      count -= 1;
    }
  }

  return { isSuppressed, run, runAsync };
}
