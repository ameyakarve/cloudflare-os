import gatekeeperConfiguratorConfig from "../../scripts/gatekeeper-configurator-vite-config.js";
import { withVitestTask } from "../../scripts/vitest-task-vite-config.js";

const config = withVitestTask(gatekeeperConfiguratorConfig, [
  "vitest run",
  "vitest run -c vitest.worker.config.ts",
]);

export default {
  ...config,
  run: {
    ...config.run,
    tasks: {
      ...config.run?.tasks,
      build: {
        ...gatekeeperConfiguratorConfig.run.tasks.build,
        command: ["tsc", "tsc -p tsconfig.test.json"],
      },
    },
  },
};
