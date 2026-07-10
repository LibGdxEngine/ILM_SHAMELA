'use client';

/**
 * Scopes the CopilotKit provider to the /documents subtree so the library
 * assistant popup and its frontend actions (useCopilotAction) work on the
 * Reading Room page. runtimeUrl points at the local bridge route
 * (app/api/copilotkit/route.ts), which forwards to the Python deep-agent
 * sidecar. `agent` must match the LangGraphAGUIAgent name in the sidecar.
 */
import '@copilotkit/react-ui/styles.css';
import { CopilotKit } from '@copilotkit/react-core';

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="libraryAgent" showDevConsole={false}>
      {children}
    </CopilotKit>
  );
}
