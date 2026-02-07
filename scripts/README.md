# Shopify Product Update Script

This script updates Shopify products by removing dark color variants, keeping only light colors.

## Prerequisites

1. **Get a Shopify Admin API Access Token:**
   - Go to your Shopify admin: https://ux2qur-rh.myshopify.com/admin
   - Navigate to Settings → Apps and sales channels → Develop apps
   - Create a new app or use an existing one
   - Configure Admin API access scopes (you need `write_products` permission)
   - Install the app and copy the Admin API access token (starts with `shpat_`)

2. **Update your `.env` file:**
   ```bash
   SHOPIFY_DOMAIN=https://ux2qur-rh.myshopify.com
   SHOPIFY_ADMIN_API_KEY=shpat_your_actual_token_here
   ```

## Usage

### Dry Run (Preview Changes)
```bash
npx tsx scripts/update-shopify-products.ts --dry-run
```

This will show you what changes would be made without actually updating your products.

### Apply Changes
```bash
npx tsx scripts/update-shopify-products.ts
```

## What the Script Does

1. **Fetches all products** from your Shopify store
2. **Identifies products** with:
   - A "Color" or "Colour" option
   - A "Size" or "Bucket" option
3. **Identifies dark colors** to remove (black, navy, dark grey, dark green, olive, dark brown, etc.)
4. **Keeps light colors** (white, cream, beige, light grey, pale yellow, etc.)
5. **Deletes variants** with dark colors
6. **Updates the color option** to remove dark color values

## Color Classification

### Light Colors (Kept)
- White
- Cream / Off-white
- Beige / Light tan
- Light grey
- Pale yellow
- Pale greenish-grey

### Dark Colors (Removed)
- Black
- Navy / Dark blue
- Charcoal / Dark grey
- Dark green / Forest green / Olive
- Dark brown / Maroon
- Dark taupe / Slate grey
- Mid-tone colors
- Brown-grey variations

## Notes

- The script processes products one at a time with a 500ms delay to avoid rate limiting
- Variants with dark colors will be permanently deleted
- Make sure to test with `--dry-run` first!
- Keep a backup of your product data before running
