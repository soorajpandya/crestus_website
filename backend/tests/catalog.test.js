const test = require("node:test");
const assert = require("node:assert/strict");
const products = require("../products.json");
const frontendProducts = require("../../frontend/src/data/products.json");
const { startTestServer, USER_A } = require("./helpers");

test("catalogs agree on the 50% offer, minimum price and budget clothing prices", () => {
  assert.deepEqual(frontendProducts, products);
  for (const product of products) {
    assert.ok(Number.isFinite(product.price) && product.price >= 100, product.id);
    assert.equal(product.mrp, product.price * 2, product.id);
  }
  for (const [id, price] of [
    ["m-everyday-cotton-tee", 200],
    ["w-everyday-cotton-tee", 200],
    ["m-everyday-casual-shirt", 400],
    ["w-everyday-straight-kurti", 400],
  ]) {
    assert.equal(products.find((product) => product.id === id)?.price, price, id);
  }
});

test("every product checks out at its catalog sale price without a second discount", async () => {
  const server = await startTestServer();
  try {
    for (const product of products) {
      const result = await server.request("POST", "/api/checkout/quote", {
        user: USER_A,
        body: {
          pincode: "400001",
          items: [{ product_id: product.id, size: product.sizes[0], qty: 1, price: 1 }],
        },
      });
      assert.equal(result.status, 200, `${product.id}: ${JSON.stringify(result.data)}`);
      assert.equal(result.data.totals.subtotal, product.price, product.id);
      assert.equal(result.data.totals.mrp_total, product.mrp, product.id);
      assert.equal(result.data.totals.discount, product.price, product.id);
      assert.equal(result.data.totals.total, product.price + result.data.totals.shipping, product.id);
    }
  } finally {
    await server.close();
  }
});
