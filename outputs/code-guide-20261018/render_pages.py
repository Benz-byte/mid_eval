from pathlib import Path
import json
from pdf2image import convert_from_path
from pypdf import PdfReader

base = Path(__file__).resolve().parent
qa = base / 'qa'
pdf = qa / 'guide.pdf'
reader = PdfReader(pdf)
audit = []
for number, page in enumerate(reader.pages, 1):
    text = page.extract_text() or ''
    audit.append({'page': number, 'characters': len(text), 'first': text[:125], 'last': text[-125:]})
(qa / 'page_audit.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
print(json.dumps(audit, indent=2))
paths = convert_from_path(str(pdf), dpi=120, output_folder=str(qa), fmt='png', paths_only=True,
    thread_count=2, poppler_path=r'C:\Users\jap\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin')
for number, path in enumerate(paths, 1):
    Path(path).replace(qa / f'page-{number}.png')
print(f'Rendered {len(paths)} page images.')
