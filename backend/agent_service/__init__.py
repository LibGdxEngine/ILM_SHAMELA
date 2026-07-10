"""CopilotKit deep-agent sidecar for the ILM Shamela library.

A small FastAPI service that exposes a LangChain ``deepagents`` agent over the
AG-UI protocol so the Next.js CopilotKit runtime can drive it. It runs
``django.setup()`` on startup and calls the existing Django/Elasticsearch search
layer directly (no HTTP hop). Entrypoint: ``agent_service.main:app``.
"""
