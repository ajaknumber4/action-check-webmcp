import type { Connect, Plugin } from "vite";

import {
  createExternalTargetCanaryMiddleware,
  type ExternalTargetCanaryMiddleware,
} from "./broker.ts";

export function externalTargetCanaryBrokerPlugin(): Plugin {
  const canary = createExternalTargetCanaryMiddleware();
  return {
    name: "action-check-external-target-canary-broker",
    configureServer(server) {
      server.middlewares.use(asConnectMiddleware(canary));
    },
    configurePreviewServer(server) {
      server.middlewares.use(asConnectMiddleware(canary));
    },
  };
}

function asConnectMiddleware(
  middleware: ExternalTargetCanaryMiddleware,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    void middleware(request, response, next).catch(next);
  };
}
