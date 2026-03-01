import re


def split_document_content_into_pages(content: str):
    """
    Split a document's raw text content into pages/chunks.
    Tries form-feed characters first, then triple-newlines, then fixed-size chunks.
    """
    page_breaks = re.split(r'[\f\x0c]', content)

    if len(page_breaks) == 1:
        page_breaks = re.split(r'\n{3,}', content)

    if len(page_breaks) == 1 and len(content) > 2000:
        chunk_size = 2000
        page_breaks = [content[i:i + chunk_size] for i in range(0, len(content), chunk_size)]

    pages = [
        {'page_number': i + 1, 'content': page.strip()}
        for i, page in enumerate(page_breaks)
        if page.strip()
    ]

    return pages or [{'page_number': 1, 'content': content}]
