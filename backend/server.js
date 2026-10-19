const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const { createApp } = require("./app");

const { app, services } = createApp();
const { config, fulfillment } = services;

if (config.worker.enabled) fulfillment.start();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Crestus Backend listening on 0.0.0.0:${config.port} (store=${services.store.driver}, cashfree=${config.cashfree.sandbox ? "sandbox" : "production"})`);
});

const shutdown = () => {
  fulfillment.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
