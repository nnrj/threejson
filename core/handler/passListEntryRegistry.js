/**
 * passList entry extension registry: domains may register expanders (e.g. highlightChannel → full pass record); core does not import domains.
 */

/** @typedef {(record: object) => object|null|undefined} PassListEntryExpander */

/** @type {PassListEntryExpander[]} */
const expanders = [];

/**
 * @param {PassListEntryExpander} expander
 */
export function registerPassListEntryExpander(expander) {
  if (typeof expander !== "function") {
    throw new Error("[passListEntry] expander must be a function");
  }
  expanders.push(expander);
}

/**
 * @param {object} record
 * @returns {object}
 */
export function expandPassListEntry(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  let next = { ...record };
  for (let i = 0; i < expanders.length; i++) {
    const expanded = expanders[i](next);
    if (expanded && typeof expanded === "object") {
      next = expanded;
    }
  }
  return next;
}

/** For unit tests only */
export function _clearPassListEntryExpandersForTests() {
  expanders.length = 0;
}
