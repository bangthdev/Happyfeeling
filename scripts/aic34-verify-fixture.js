// TEMP fixture for AIC-34 Epic 4 redeliver verification — deliberately buggy, removed before closing.

// Bug 1: off-by-one, skips index 0
function findFirstNegative(numbers) {
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] < 0) return numbers[i];
  }
  return null;
}

// Bug 2: loose equality lets '0' (string) match 0 (number)
function isZero(value) {
  return value == 0;
}

// Bug 3: mutates the array while iterating over it, skips elements after a splice
function removeExpired(items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].expired) {
      items.splice(i, 1);
    }
  }
  return items;
}

// Bug 4: missing await, returns a pending Promise instead of the resolved value
async function getConfigValue(store, key) {
  const value = store.get(key);
  return value;
}

module.exports = { findFirstNegative, isZero, removeExpired, getConfigValue };
