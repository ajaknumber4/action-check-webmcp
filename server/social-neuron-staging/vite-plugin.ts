import type { Connect, Plugin } from "vite";

import {
  createSocialNeuronCanaryMiddleware,
  type SocialNeuronCanaryMiddleware,
} from "./broker.ts";

export function socialNeuronCanaryBrokerPlugin(): Plugin {
  const canary = createSocialNeuronCanaryMiddleware();
  return {
    name: "action-check-social-neuron-canary-broker",
    configureServer(server) {
      server.middlewares.use(asConnectMiddleware(canary));
    },
    configurePreviewServer(server) {
      server.middlewares.use(asConnectMiddleware(canary));
    },
  };
}

function asConnectMiddleware(
  middleware: SocialNeuronCanaryMiddleware,
): Connect.NextHandleFunction {
  return (request, response, next) => {
    void middleware(request, response, next).catch(next);
  };
}
