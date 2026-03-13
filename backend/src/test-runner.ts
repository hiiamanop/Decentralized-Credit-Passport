import { runDataGatewayTests } from "./data-gateway/test-runner.js";
import { runFeatureAndHashTests } from "./features/test-runner.js";

async function run() {
  await runDataGatewayTests();
  await runFeatureAndHashTests();
  console.log(JSON.stringify({ ok: true }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

