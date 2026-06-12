"""Build a print-ready PDF from USER_GUIDE.md.

Markdown -> styled HTML -> Chrome/Edge headless --print-to-pdf.
No network or extra services required (uses local Chrome/Edge).
"""
import subprocess
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "USER_GUIDE.md"
HTML = ROOT / "USER_GUIDE.html"
PDF = ROOT / "USER_GUIDE.pdf"

CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5;
       color: #1a1a1a; max-width: 100%; }
h1 { font-size: 22pt; color: #6b4e16; border-bottom: 3px solid #c9a227; padding-bottom: 6px;
     page-break-after: avoid; }
h2 { font-size: 15pt; color: #6b4e16; margin-top: 22px; border-bottom: 1px solid #e3d29a;
     padding-bottom: 3px; page-break-after: avoid; }
h3 { font-size: 12.5pt; color: #333; margin-top: 16px; page-break-after: avoid; }
p, li { page-break-inside: avoid; }
code { background: #f4f1e6; padding: 1px 5px; border-radius: 3px; font-size: 10pt;
       font-family: Consolas, monospace; color: #8a5a00; }
pre { background: #f4f1e6; padding: 10px; border-radius: 5px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
th, td { border: 1px solid #d8cfa8; padding: 6px 10px; text-align: left; font-size: 10.5pt; }
th { background: #f3ead0; color: #5a4310; }
blockquote { border-left: 4px solid #c9a227; margin: 10px 0; padding: 4px 14px;
             background: #fbf8ef; color: #555; }
hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
a { color: #8a5a00; text-decoration: none; }
ul, ol { margin: 8px 0; padding-left: 24px; }
"""


def find_browser():
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def main():
    md_text = SRC.read_text(encoding="utf-8")
    body = markdown.markdown(
        md_text, extensions=["tables", "fenced_code", "toc", "sane_lists"]
    )
    html = (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{CSS}</style></head><body>{body}</body></html>"
    )
    HTML.write_text(html, encoding="utf-8")
    print(f"Wrote {HTML.name}")

    browser = find_browser()
    if not browser:
        print("No Chrome/Edge found; HTML written but PDF skipped.")
        sys.exit(1)

    cmd = [
        browser,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={PDF}",
        HTML.as_uri(),
    ]
    subprocess.run(cmd, check=True, timeout=120)
    if PDF.exists():
        kb = PDF.stat().st_size / 1024
        print(f"Wrote {PDF.name} ({kb:.0f} KB)")
    else:
        print("PDF was not produced.")
        sys.exit(1)


if __name__ == "__main__":
    main()
