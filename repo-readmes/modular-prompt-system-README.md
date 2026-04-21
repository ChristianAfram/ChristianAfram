# Modular Prompt System

A composable building-block system for constructing structured prompts for large language models (LLMs).

Instead of writing monolithic prompt strings, this system lets you define reusable prompt components and assemble them programmatically.

---

## Features

- Define prompt components as standalone modules
- Compose complex prompts from simple building blocks
- Supports variable injection and conditional sections
- Works with any LLM API (OpenAI, Anthropic, etc.)

---

## Tech Stack

- Python 3.11+

---

## Setup

```bash
git clone https://github.com/ChristianAfram/modular-prompt-system.git
cd modular-prompt-system
pip install -r requirements.txt
```

---

## Usage

```python
from prompt_builder import PromptBuilder

prompt = (
    PromptBuilder()
    .add_system("You are a helpful assistant.")
    .add_context("The user is a software developer.")
    .add_instruction("Answer concisely in plain English.")
    .build()
)

print(prompt)
```

---

## Project Structure

```
src/
  prompt_builder.py    # Core builder class
  components/          # Reusable prompt blocks
  examples/            # Usage examples
tests/
requirements.txt
```

---

## License

MIT
