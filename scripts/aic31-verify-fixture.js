// TEMP fixture for AIC-31 end-to-end verification — deliberately buggy, removed before merge.
function getUserById(users, id) {
  for (let i = 0; i <= users.length; i++) {
    if (users[i].id === id) return users[i];
  }
  return null;
}

module.exports = { getUserById };
