# Kit-builder analysis: LRIDY Shopify store

This doc summarizes how the kit-builder is structured in **LRIDY_Shopify_NEW** so we can align our ProfitBot AI system with the same concepts: dynamic products, multiple customizable kit builders, and the right settings for the chatbot to call the correct calculator.

---

## 1. High-level structure

- **Multiple calculators** exist as separate sections (and JS modules):
  - **Caravan Calculator** – length/area → roof kit (sealant, thermal, sealer, geo, rapid-cure, brush, bonus kit).
  - **Water Tank Calculator** – dimensions → area only (no product kit; just area math).
  - **Area Calculator** – generic shapes (cylinder, rectangle, box) → area only.
- **Products are dynamic**: the caravan calculator does **not** hardcode product handles. It gets a **list of products from the section’s blocks** (theme editor). Each block is a “product” with handle, name, variants JSON, colors JSON.
- **Formulae are per “product type”** (normalized handle): e.g. `waterproof-sealant` → area × 1.5 L/m², `protective-top-coat` → area × 0.5 L/m². So the **same product handle** both identifies the product and selects the **coverage formula**.

---

## 2. Caravan calculator: section + blocks

**Section** (`sections/caravan-calculator.liquid`):

- **Section settings** (global for this calculator instance):
  - `section_id` – custom ID (e.g. for deep links).
  - `heading`, `subheading`, `heading_size`, `cta_label`.
  - `discount_rate` (e.g. 0.1 = 10%).
  - `kit_image`, feature 1/2/3 (text + icon).
- **Blocks** of type `product`:
  - **product_handle** – Shopify product handle (e.g. `liquid-rubber-diy-waterproof-sealant`).
  - **product_name** – optional display name override.
  - **product_variants** – JSON array: `[{ size, variantId, price, imageUrl, label, color }]`.
  - **product_colors** – JSON array of color names.

The Liquid template builds a **config object** from the section:

- `products`: array of `{ handle, name, variants, colors }` from each product block.
- `discountRate`, `storeDomain` from section settings.

So: **which products are in the kit** and **what data they use** is fully controlled by the theme editor (add/remove/reorder blocks, set handle and variant/color JSON). No code change needed to add a product to the kit.

---

## 3. Coverage and formulae (per product type)

In `caravan-calculator.js`:

- **Coverage rates** are a map from **normalized handle** to a **function(area, fullCover)** that returns litres (or length for geo/seam-tape):
  - `waterproof-sealant`: full cover → area × 1.5, seams only → area × 0.2.
  - `protective-top-coat`: area × 0.5.
  - `sealer`: area × 0.125 (1/8).
  - `etch-primer`: area × (1/6).
  - `rapid-cure-spray`: computed from sealant litres (0.02 L per 1 L sealant), not from area in this map.
  - `geo-textile`: computed separately (length-based, derived from sealant).
  - `seam-tape`, `brush-roller`: special (length-based or threshold-based).

- **Normalize handle**: the JS maps Shopify handles to a **canonical type** (e.g. “liquid-rubber-diy-thermal-coating” → `protective-top-coat`) so the correct formula is used. So:
  - **Product identity** = Shopify handle (and block).
  - **Formula selection** = normalized “type” (waterproof-sealant, protective-top-coat, sealer, etc.).

- **Visibility/toggles**:
  - `showRawMetalToggle` / `showEtchPrimer`: whether to show etch-primer (and use bare-metal vs painted logic).
  - `showFullCoverToggle`: full cover vs seams-only (changes sealant rate).
  - `showConcreteRoofToggle`: use rough-surface coverage if product has `coverageRough`, `areaPercentage`.
  - `isVisible(handle)` decides if a product row is shown (e.g. etch-primer only when toggle on or `showEtchPrimer` true).

So in LRIDY, **one calculator** has:

- A **list of products** (from blocks), each with handle + variants + colors.
- A **mapping from handle → formula** (normalizeHandle + coverageRates).
- **Optional toggles** that change which products are visible and which formula variant is used (e.g. full cover vs seams).

---

## 4. Bonus kit

- **Separate from main product list**: bonus brush/roller is not a product block in the main kit; it’s configured by:
  - `bonusBrushProductHandle`, `bonusBrushRollerProductHandle`
  - `bonusBrushVariantId`, `bonusBrushRollerVariantId`
  - `bonusKitAreaThreshold` (e.g. 5 m²): below = brush only, above = brush + roller.
  - Text/price for display: `bonusBrushText`, `bonusBrushRollerText`, `bonusBrushPrice`, `bonusBrushRollerPrice`.

So “bonus” is a **second layer of config**: which products and variants to add as free gift, and for which area threshold.

---

## 5. What we need in our system (ProfitBot)

To support **multiple, fully customizable kit builders** and let the **AI use the right one**:

### 5.1 Calculator as first-class entity

- **Calculator config** (e.g. `calculator_config` or extended) should represent **one kit builder** with:
  - **key** (e.g. `roof-kit`, `caravan-kit`, `tank-kit`) – used by the AI/chat to choose which calculator to run.
  - **name** (e.g. “Roof Kit DIY”, “Caravan Roof Kit”).
  - **Input type**: area (m²), length (m), dimensions (tank), etc., so we know what the user must provide (e.g. roof size vs length).

### 5.2 Products in a calculator = list of “product roles”

- Each **product** in a kit should be configurable with:
  - **Product handle** (from Shopify, stored in `product_pricing.product_handle` after sync).
  - **Role / formula type**: which coverage formula to use (sealant, thermal, sealer, geo, rapidCure, brushRoller, or custom). This can be a **role key** that maps to a formula in code, or we allow **custom rate** (e.g. L/m² or m/m²) per product in this kit.
- So: **not** “six fixed roles with one handle each”, but **N products**, each with:
  - handle (which product),
  - role or formula (how to compute quantity from input).

### 5.3 Formulae / coverage settings per calculator

- Either:
  - **Fixed formulae per role** (as now in our roof-kit): sealant, thermal, sealer, geo, rapidCure, brushRoller – and we only need “which handle goes to which role”; or
  - **Configurable rates per product** in the calculator (e.g. “product A: 1.5 L/m²”, “product B: 0.5 L/m²”) so a store can add any product and assign a rate without code changes.
- LRIDY supports both: default `coverageRates` by handle, overridable via `config.coverageRates`. We could:
  - Keep **role-based** formulae (sealant, thermal, …) and only map **handle → role** in settings; or
  - Add **optional custom rate** per product in the calculator (e.g. `rate_per_sqm`, `rate_per_sealant_litre`) for full flexibility.

### 5.4 Toggles and optional behaviour

- **Toggles** (e.g. full cover vs seams, raw metal, concrete) can be:
  - Stored as **calculator-level settings** (e.g. `full_cover_default`, `show_etch_primer`) and/or
  - Chosen by the user in chat (e.g. “seams only” vs “full cover”) and passed into the calculator run.
- For the AI, we only need to know **which calculator to run** and **what input to use** (e.g. roof size 60 m²). Toggles can default in config or be inferred from conversation later.

### 5.5 Bonus kit

- Same idea as LRIDY: **optional bonus config** on the calculator:
  - One or two “bonus” product handles + variant IDs (or “first variant”).
  - Area/length threshold (e.g. &gt; 5 m² → brush + roller, else brush only).
  - Stored in the same calculator config (e.g. `bonus_handles`, `bonus_threshold`, `bonus_variant_ids`).

### 5.6 AI choosing the right kit builder

- **By intent**: user says “roof 60 sqm” → use calculator with key `roof-kit` (or “Roof Kit DIY”). User says “caravan 6m” → use `caravan-kit`.
- **By widget/agent**: we can store on the widget or agent a **default_calculator_key** (e.g. `roof-kit`). The chat then uses that unless the user clearly asks for another (e.g. “tank quote”).
- **Multiple configs**: each user can have several rows in `calculator_config` (e.g. `roof-kit`, `caravan-kit`). When creating a DIY checkout we need:
  - **Input**: calculator key (from intent or default) + user input (area/length/etc.).
  - **Load** the right calculator config (products + roles + rates + bonus).
  - **Run** that calculator and build line items.

---

## 6. Recommended data shape (for our DB + API)

### 6.1 `calculator_config` (already started)

- `id`, `created_by`, `calculator_key`, `name`, `role_handles` (role → [handles]), `created_at`, `updated_at`.
- **Extend** with (optional, in same or new columns):
  - **input_type**: `area` | `length` | `dimensions` (for future tank/other).
  - **default_discount_rate** (e.g. 0.1).
  - **coverage_rates** (optional JSON): override per role, e.g. `{ "sealant": { "fullCover": 1.5, "seamsOnly": 0.2 } }`.
  - **bonus**: `{ "brushHandle": "", "rollerHandle": "", "areaThreshold": 5, "brushVariantId": null, "rollerVariantId": null }`.
  - **toggles**: `{ "showEtchPrimer": false, "showFullCoverToggle": false }` (for future UI or AI).

### 6.2 Role → handles (current)

- **role_handles**: `{ "sealant": ["handle1"], "thermal": ["handle2"], "sealer": [], "geo": [], "rapidCure": [], "brushRoller": [] }`.
- Products come from **product_pricing** (synced from Shopify). Handles are **Shopify handles** (dynamic). So we already support “any product” in “any role”.

### 6.3 Optional: per-product overrides in calculator

- If we want **custom rate per product** (like LRIDY’s product-level `coverageRough`, `multiplier`), we could add:
  - **product_settings** (JSON): `[{ "handle": "x", "role": "sealant", "ratePerSqm": 1.5, "rateSeamsOnly": 0.2 }]`.
- For v1, **role → handles + fixed formulae per role** (current roof-kit) is enough; we can add overrides later.

---

## 7. Summary table (LRIDY vs our target)

| Aspect | LRIDY (Shopify theme) | Our system (target) |
|--------|------------------------|----------------------|
| Products in kit | Section blocks (product_handle + variants/colors JSON) | product_pricing (Shopify sync) + calculator_config.role_handles (which handle → which role) |
| Formulae | coverageRates[normalizedHandle](area, fullCover) in JS | Roof-kit: role-based in code (sealant, thermal, …). Optional: configurable rate per role/product later |
| Multiple kits | Different sections (caravan, tank, roof bundles) | Multiple rows in calculator_config (calculator_key: roof-kit, caravan-kit, …) |
| AI “which kit?” | N/A (theme is per page) | By intent + default_calculator_key on widget/agent; load config by calculator_key |
| Bonus kit | Section/JS config (handles, variant IDs, threshold) | Stored in calculator config (bonus_handles, bonus_threshold, etc.) |
| Toggles | Section/JS (showEtchPrimer, fullCover, concreteRoof) | Optional calculator-level toggles; can be added to config and used in formula/visibility |

---

## 8. Next steps (implementation order)

1. **Keep** dynamic handles (Shopify handle in `product_pricing`), **keep** calculator_config with **role_handles** (role → list of handles). No hardcoded handles in our app.
2. **Add** calculator list + UI: list of calculator configs (e.g. Roof Kit, Caravan Kit), allow create/edit/delete by calculator_key.
3. **Add** “Roof Kit” settings UI: assign products (from product_pricing) to roles (sealant, thermal, sealer, geo, rapidCure, brushRoller); optional bonus config; optional discount rate.
4. **Chat/API**: when creating DIY checkout, accept **calculator_key** (from trigger or default); load that calculator’s config and run the right breakdown.
5. **Optional**: input_type (area vs length), coverage overrides per role, toggles, and per-product custom rates for parity with LRIDY’s flexibility.

This keeps our system aligned with LRIDY’s kit-builder model (dynamic products, multiple kits, configurable settings) and lets the AI chatbot use the right kit builder per context.
