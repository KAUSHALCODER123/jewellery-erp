Regional Language PDF Font Setup
================================

To print invoices/receipts with Marathi, Hindi, or Gujarati headers, place
the following Google Noto font files in this directory:

  NotoSansDevanagari-Regular.ttf   -- for Marathi and Hindi
  NotoSansGujarati-Regular.ttf     -- for Gujarati

Download free from: https://fonts.google.com/noto
  1. Search "Noto Sans Devanagari", click Download
  2. Search "Noto Sans Gujarati", click Download
  3. Extract and copy the -Regular.ttf files here

The server detects these files at startup. Restart the backend after placing
the fonts. Without them, Indic characters will not render in PDFs (English
fallback is used automatically).
