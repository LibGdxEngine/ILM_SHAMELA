import { HttpAgent } from '@ag-ui/client';
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from '@copilotkit/runtime';
import { NextRequest } from 'next/server';

// This route is the CopilotKit runtime bridge. The browser's <CopilotKit>
// provider posts here (runtimeUrl="/api/copilotkit"); we forward to the Python
// deep-agent sidecar over the AG-UI protocol. AGENT_SERVICE_URL is a server-only
// env var (defaults to the Docker service name). NOTE: next.config.js excludes
// /api/copilotkit from the Django proxy rewrite so this handler is reached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL ?? 'http://localhost:8123';

const copilotRuntime = new CopilotRuntime({
  agents: {
    // Keys must match the `agent` prop on <CopilotKit> and the LangGraphAGUIAgent
    // names in the sidecar (agent_service/main.py). The reader agent is a second
    // AG-UI endpoint mounted at /reader on the same sidecar, scoped to one book.
    libraryAgent: new HttpAgent({
      url: AGENT_SERVICE_URL,
    }),
    readerAgent: new HttpAgent({
      url: `${AGENT_SERVICE_URL}/reader`,
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    // The Python side owns all LLM calls, so the Node runtime needs no adapter.
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: '/api/copilotkit',
  });
  return handleRequest(req);
};
