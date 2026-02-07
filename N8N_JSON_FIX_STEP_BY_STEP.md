# Step-by-Step: Fix JSON Body Error

## The Problem
"JSON parameter needs to be valid JSON" - This happens when n8n can't parse your JSON body.

## Solution: Use "Using Fields Below" Mode

This is the **most reliable** method and avoids JSON syntax issues.

### Step 1: Open HTTP Request Node
- Click on your "Store Message" HTTP Request node

### Step 2: Find "Specify Body" Dropdown
- Scroll to the "Send Body" section
- Find the dropdown that says "Using JSON"
- Change it to **"Using Fields Below"**

### Step 3: Add Fields
Click "Add Field" button **twice** to create two fields:

**Field 1:**
- **Name**: `role`
- **Value**: `assistant`

**Field 2:**
- **Name**: `content`
- **Value**: `{{ $json.content }}` (use `{{ }}` syntax with double curly braces)

### Step 4: Save and Test
- Click "Save" or "Done"
- Execute the workflow
- The JSON will be automatically created as:
  ```json
  {
    "role": "assistant",
    "content": "actual message content here"
  }
  ```

## Why This Works

"Using Fields Below" mode:
- ✅ Automatically creates valid JSON
- ✅ Handles expressions correctly (`{{ }}` syntax)
- ✅ No JSON syntax errors
- ✅ More reliable than Expression mode

## Alternative: If You Must Use Expression Mode

If "Using Fields Below" doesn't work for some reason:

1. Make sure "Expression" button is clicked (not "Fixed")
2. The field should show code editor styling
3. Enter this EXACT code (no quotes around `$json.content`):
   ```javascript
   {
     "role": "assistant",
     "content": $json.content
   }
   ```

But **"Using Fields Below" is recommended** - it's simpler and more reliable!
