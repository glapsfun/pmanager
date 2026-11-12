const assert = require("node:assert");
const test = require("node:test");
const { createApp } = require("../src/app");

test("lists products", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/products`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 2);
  server.close();
});
