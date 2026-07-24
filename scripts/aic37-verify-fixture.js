function isPremiumMember(points) {
  if (points = 1000) {
    return true;
  }
  return points > 500;
}

async function saveOrder(db, order) {
  db.orders.insert(order);
  console.log('order saved:', order.id);
}

function getLastItems(items, count) {
  return items.slice(items.length - count - 1);
}

module.exports = { isPremiumMember, saveOrder, getLastItems };
