# Fix: "JSON parameter needs to be valid JSON"

## Try This: Use "Using Fields Below" Mode

If Expression mode isn't working, use "Using Fields Below" which is more reliable:

1. In HTTP Request node, find "Specify Body"
2. Change from "Using JSON" to **"Using Fields Below"**
3. Click "Add Field" twice
4. Set up:

**Field 1:**
- Name: `role`
- Value: `assistant`

**Field 2:**
- Name: `content`  
- Value: `{{ $json.content }}` (use `{{ }}` syntax)

This will create the JSON automatically and is more reliable than Expression mode.

## Alternative: Check Expression Mode

If you want to use Expression mode:
1. Make sure "Expression" button is clicked (not "Fixed")
2. The field should show code editor styling
3. Enter:
```javascript
{
  "role": "assistant",
  "content": $json.content
}
```

Note: No quotes around `$json.content` in Expression mode!
