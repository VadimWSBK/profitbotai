# Chat Widget Native - Modular Structure

This directory contains the modular source code for the native chat widget embed script. The code is split into logical modules for better maintainability and readability.

## Structure

The widget code is organized into the following modules:

- **`bootstrap.ts`** - Script tag detection and initialization (handles `defer`/`async` loading)
- **`utils.ts`** - Utility functions (DOM helpers, SVG creation, throttling, etc.)
- **`session.ts`** - Session ID management (localStorage, URL params)
- **`message-formatting.ts`** - Message formatting (markdown parsing, table rendering, links)
- **`css-generator.ts`** - CSS generation with scoped selectors and `!important` flags
- **`components.ts`** - Component builders (bubble, tooltip, chat window, messages)
- **`controller.ts`** - Main widget controller (state management, network requests, streaming)
- **`init.ts`** - DOM ready check and widget initialization
- **`index.ts`** - Combines all modules into a single embeddable script

## How It Works

1. Each module exports a `String.raw` template containing its JavaScript code
2. The `index.ts` file imports all modules and combines them into a single script
3. The `+server.ts` file imports `EMBED_SCRIPT` from `index.ts` and serves it as a JavaScript file

## Benefits

- **Better maintainability**: Each module has a single responsibility
- **Easier debugging**: Issues can be traced to specific modules
- **Improved readability**: Smaller files are easier to understand
- **Team collaboration**: Multiple developers can work on different modules simultaneously
- **Single-file output**: Still produces one embeddable script (no build step needed)

## Adding New Features

When adding new features:

1. Identify which module the feature belongs to (or create a new one if needed)
2. Add the code to the appropriate module file
3. If creating a new module, import it in `index.ts` and add it to the `EMBED_SCRIPT` template
4. The changes will automatically be included in the served script

## File Sizes

- `bootstrap.ts`: ~1.8 KB
- `utils.ts`: ~2.9 KB
- `session.ts`: ~0.5 KB
- `message-formatting.ts`: ~9.9 KB
- `css-generator.ts`: ~25.7 KB
- `components.ts`: ~13.9 KB
- `controller.ts`: ~38.7 KB
- `init.ts`: ~0.2 KB

**Total**: ~92 KB of source code (before minification)
