# CLI-Style Terminal Interface

The `/cli` endpoint provides a terminal-like interface that wraps NDJSON streams, making it perfect for ChatGPT and other LLM interfaces.

## Problem Solved

When you paste a URL into ChatGPT, it doesn't execute it—it describes it. The CLI interface solves this by:

- **Rendering as HTML:** ChatGPT sees a live, interactive page
- **Terminal-like UI:** Looks and feels like a command-line interface
- **Live streaming:** Text updates in real-time as events arrive
- **Human-readable:** Shows formatted output instead of raw JSON

## Usage

### Basic Example

```
https://precogs.croutons.ai/cli?precog=schema&task=Generate+JSON-LD
```

### With Context

```
https://precogs.croutons.ai/cli
  ?precog=schema
  &url=https%3A%2F%2Fexample.com%2Fservice
  &type=Service
  &task=Generate%20%26%20validate%20JSON-LD
  &token=YOUR_API_KEY
```

## How It Works

1. **Page loads** → Shows terminal-style header
2. **Displays command** → Shows the task being executed
3. **Connects to NDJSON stream** → Calls `/v1/run.ndjson`
4. **Renders events** → Formats and displays as terminal output
5. **Shows completion** → Displays "✔ done" when finished

## Output Format

The CLI interface formats events as:

```
Precogs Oracle [schema]
> Generate JSON-LD
──────────────────────────────────────────────────
job_id: uuid-here
grounding → {"count":1,"source":"..."}
[answer text streams here...]
✔ done (done)
```

## Color Coding

- **Prompt (blue):** Job IDs, status messages
- **Command (orange):** The task being executed
- **Result (white):** Answer text and data

## Why This Works for ChatGPT

1. **HTML Content:** ChatGPT can see and describe the page content
2. **Live Updates:** The page streams results, so ChatGPT sees the output
3. **Terminal Aesthetic:** Looks like a real CLI, making it more intuitive
4. **Shareable:** Single URL that auto-runs and displays results

## Comparison

### Raw NDJSON (ChatGPT sees JSON)
```
{"type":"ack","job_id":"..."}
{"type":"answer.delta","data":{"text":"..."}}
```

### CLI Interface (ChatGPT sees terminal output)
```
Precogs Oracle [schema]
> Generate JSON-LD
──────────────────────────────────────────────────
[answer text streams here...]
✔ done (done)
```

## Future Enhancements

The CLI interface can be extended with:

- **Interactive options:** Show numbered choices
- **Keypress handling:** Press [1], [2], [3] to select actions
- **Command history:** Show previous commands
- **Multi-step workflows:** Chain multiple precog operations

### Example Future Interactive Flow

```javascript
print("Select action:");
print("[1] Validate schema.org");
print("[2] Generate JSON-LD");
print("[3] Crawl page for FAQ items");

// Listen for keypress
document.addEventListener('keypress', (e) => {
  if (e.key === '1') {
    // Launch new NDJSON request for option 1
  }
});
```

## Endpoints

- `/cli` - Redirects to CLI viewer (convenience)
- `/runtime/cli.html` - Direct access to CLI viewer
- `/v1/run.ndjson` - Backend NDJSON stream (used by CLI)

## Use Cases

- **ChatGPT integration:** Paste URL, ChatGPT sees live terminal output
- **Documentation:** Embed CLI links that auto-run examples
- **Quick testing:** Fast way to test precog jobs with visual feedback
- **Presentations:** Show live terminal output during demos

## Notes

- Uses the same NDJSON backend as other endpoints
- Respects authentication (token in query param)
- Auto-scrolls as new content arrives
- Handles errors gracefully with "⚠" prefix

