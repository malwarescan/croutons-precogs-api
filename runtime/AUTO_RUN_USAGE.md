# Auto-Run Page Usage

The `/runtime/auto.html` page automatically invokes a precog job and streams results when loaded.

## Features

- **Auto-invoke:** Automatically POSTs to `/v1/invoke` on page load
- **Auto-stream:** Immediately opens SSE connection to stream events
- **Two input styles:** Query string params or directive hash
- **Token support:** Works with API authentication via query param

## Usage Examples

### Query String Style (Easiest to Share)

```
https://precogs.croutons.ai/runtime/auto.html
  ?precog=schema
  &url=https%3A%2F%2Fwww.hoosiercladding.com%2Fservices%2Fsiding-installation
  &type=Service
  &task=Generate%20%26%20validate%20JSON-LD
  &token=YOUR_API_KEY
```

**Parameters:**
- `precog` - Required. Precog type (e.g., `schema`)
- `url` - Optional. URL to process
- `type` - Optional. Type context
- `task` - Optional. Task description/prompt
- `token` - Optional. API key for authentication

### Directive Hash Style (Pretty for Prompts)

```
https://precogs.croutons.ai/runtime/auto.html#\
/crtns:precog:@schema: --url https://www.hoosiercladding.com/services/siding-installation \
--type Service --task "Generate & validate JSON-LD"
```

**With token:**
```
https://precogs.croutons.ai/runtime/auto.html?token=YOUR_API_KEY#\
/crtns:precog:@schema: --url https://www.hoosiercladding.com/services/siding-installation \
--type Service --task "Generate & validate JSON-LD"
```

**Directive Format:**
```
/crtns:precog:@<precog>: --url <url> --type <type> --task "<task>"
```

## How It Works

1. **Page loads** → Parses URL params or hash directive
2. **POSTs to `/v1/invoke`** → Creates job (with auth header if token provided)
3. **Opens SSE connection** → Streams events from `/v1/jobs/:id/events` (with `?token=` if needed)
4. **Displays events** → Shows `grounding.chunk`, `answer.delta`, `answer.complete` in real-time

## Event Types Displayed

- `grounding.chunk` → `[grounding] {data}`
- `reasoning.delta` → Text content appended
- `answer.delta` → Text content appended
- `answer.complete` → `[complete]` marker
- `error` → `[error] {message}`

## Authentication

If `API_KEY` is set in Railway:

- **For `/v1/invoke`:** Uses `Authorization: Bearer <token>` header
- **For SSE:** Uses `?token=<token>` query param (EventSource can't set headers)

The page automatically:
- Sends token in header for POST request
- Appends `?token=` to SSE URL if token provided

## Examples

### Minimal (Just Precog)
```
https://precogs.croutons.ai/runtime/auto.html?precog=schema
```

### With Context
```
https://precogs.croutons.ai/runtime/auto.html?precog=schema&url=https://example.com&type=Service
```

### With Task
```
https://precogs.croutons.ai/runtime/auto.html?precog=schema&task=Generate%20JSON-LD
```

### Full Example with Auth
```
https://precogs.croutons.ai/runtime/auto.html?precog=schema&url=https://example.com&type=Service&task=Generate%20JSON-LD&token=abc123
```

### Directive Style
```
https://precogs.croutons.ai/runtime/auto.html#/crtns:precog:@schema: --url https://example.com --type Service --task "Generate JSON-LD"
```

## Use Cases

- **Shareable links:** Send a URL that auto-runs a precog job
- **ChatGPT/Cursor:** Paste URL in chat, it opens and streams results
- **Quick testing:** Fast way to test precog jobs without writing code
- **Documentation:** Embed links in docs that demonstrate precog usage

## Notes

- Page automatically scrolls output as events arrive
- SSE connection closes on `answer.complete` or `error`
- If `precog` is missing, shows error message
- Token is optional if `API_KEY` is not set in Railway

