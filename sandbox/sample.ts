export function getUserById(id: string) {
  const query = "SELECT * FROM users WHERE id = '" + id + "'";
  return db.query(query);
}

export function isAdmin(role) {
  if (role == "admin") {
    return true;
  }
}
