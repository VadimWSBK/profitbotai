-- Only allow roof-kit handles: waterproof-sealant, protective-top-coat, sealer, geo-textile, rapid-cure-spray, brush-roller.
-- Set product_handle to NULL for any other value (NULL is treated as waterproof-sealant in the app).
UPDATE product_pricing
SET product_handle = NULL
WHERE product_handle IS NOT NULL
  AND product_handle NOT IN (
    'waterproof-sealant',
    'protective-top-coat',
    'sealer',
    'geo-textile',
    'rapid-cure-spray',
    'brush-roller'
  );
