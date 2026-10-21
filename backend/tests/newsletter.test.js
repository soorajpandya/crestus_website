const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers");

test("newsletter subscription flow: validates email, prevents duplicates, saves subscriber", async () => {
  const server = await startTestServer();
  try {
    // 1. Invalid email check
    const invalidRes = await server.request("POST", "/api/newsletter/subscribe", {
      body: { email: "not-an-email" },
    });
    assert.equal(invalidRes.status, 400);
    assert.equal(invalidRes.data.error, "Please enter valid email");

    // 2. Valid email submission
    const validRes = await server.request("POST", "/api/newsletter/subscribe", {
      body: { email: "Subscriber@Domain.Com" },
    });
    assert.equal(validRes.status, 201);
    assert.equal(validRes.data.success, true);
    assert.equal(validRes.data.message, "Welcome to the world!");
    assert.equal(validRes.data.subscriber.email, "subscriber@domain.com");

    // 3. Duplicate check
    const dupRes = await server.request("POST", "/api/newsletter/subscribe", {
      body: { email: "subscriber@domain.com" },
    });
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.data.alreadySubscribed, true);
    assert.equal(dupRes.data.message, "Already part of our private circle!");

    // 4. Verify stored subscriber
    const stored = await server.services.store.findSubscriberByEmail("subscriber@domain.com");
    assert.ok(stored);
    assert.equal(stored.email, "subscriber@domain.com");
    assert.equal(stored.source, "homepage_newsletter");
    assert.equal(stored.status, "active");
    assert.ok(stored.created_at);
  } finally {
    await server.close();
  }
});
