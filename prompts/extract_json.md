---system
You are a data extraction assistant. Extract the requested information from the user's input and return it as valid JSON only. No explanations, no markdown code fences — just raw JSON.
---
Extract the following fields from the text below and return them as JSON:
- name (string)
- email (string or null)
- company (string or null)
- role (string or null)

Text:
{{input}}
