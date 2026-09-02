"""KB extraction pipeline (Layer D): whole-book segmentation + two-pass NER/KB
extraction against the heritage schema in ``schema.py``.

Stage 0 (``normalize``)  : Document.content -> NormalizedDoc (offsets absolute
                           into the normalized text; Arabic never touched).
Stage 1 (``split``)      : LLM split detection (DeepSeek via OpenRouter) ->
                           SegmentedDocument -> output/{book_id}/segments.json.
Stage 2 (``extract`` +   : windowed two-pass extraction (Gemini via google-genai)
         ``mapping``)      -> output/{book_id}/extraction.json + drops.jsonl.

Every LLM response is disk-cached before parsing, so any run is resumable and
interrupted work replays at zero cost. Entry points live in ``runner``; the
Celery task in ``extraction.tasks`` and the ``run_kb_pipeline`` management
command both delegate there.
"""
