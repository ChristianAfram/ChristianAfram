# Modular Prompt System

Ein modulares Baukastensystem zum strukturierten Aufbau von Prompts für große Sprachmodelle (LLMs).

Statt monolithischer Prompt-Strings lassen sich wiederverwendbare Komponenten definieren und programmgesteuert zusammensetzen.

---

## Funktionen

- Prompt-Komponenten als eigenständige Module definieren
- Komplexe Prompts aus einfachen Bausteinen zusammenstellen
- Variablen-Injektion und bedingte Abschnitte möglich
- Funktioniert mit jeder LLM-API (OpenAI, Anthropic usw.)

---

## Tech Stack

- Python 3.11+

---

## Installation

```bash
git clone https://github.com/ChristianAfram/modular-prompt-system.git
cd modular-prompt-system
pip install -r requirements.txt
```

---

## Verwendung

```python
from prompt_builder import PromptBuilder

prompt = (
    PromptBuilder()
    .add_system("Du bist ein hilfreicher Assistent.")
    .add_context("Der Nutzer ist Softwareentwickler.")
    .add_instruction("Antworte knapp und auf Deutsch.")
    .build()
)

print(prompt)
```

---

## Projektstruktur

```
src/
  prompt_builder.py    # Kern-Builder-Klasse
  components/          # Wiederverwendbare Prompt-Bausteine
  examples/            # Anwendungsbeispiele
tests/
requirements.txt
```

---

## Lizenz

MIT
