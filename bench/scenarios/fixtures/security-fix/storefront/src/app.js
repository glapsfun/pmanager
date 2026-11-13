const express = require("express");

const products = [
  { id: "p1", name: "Mug", priceCents: 1200 },
  { id: "p2", name: "Notebook", priceCents: 800 },
];

function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.send("ok"));
  app.get("/products", (_req, res) => res.json(products));
  app.get("/products/:id", (req, res) => {
    const p = products.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "not found" });
    return res.json(p);
  });
  return app;
}

module.exports = { createApp, products };
