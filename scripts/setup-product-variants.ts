#!/usr/bin/env tsx
/**
 * Script to set up product variants with correct pricing
 * 
 * This script:
 * 1. Ensures each bucket size (5L, 10L, 15L) has all color options
 * 2. Sets base prices for each bucket size
 * 3. Adds 10% premium for non-standard colors
 * 
 * Usage:
 *   npx tsx scripts/setup-product-variants.ts [--dry-run]
 */

// Load environment variables from .env file
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
	try {
		const envPath = resolve(process.cwd(), '.env');
		const envContent = readFileSync(envPath, 'utf-8');
		const lines = envContent.split('\n');
		
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			
			const match = trimmed.match(/^([^=]+)=(.*)$/);
			if (match) {
				const key = match[1].trim();
				const value = match[2].trim().replace(/^["']|["']$/g, '');
				if (!process.env[key]) {
					process.env[key] = value;
				}
			}
		}
	} catch (error) {
		// .env file might not exist, that's okay
	}
}

loadEnv();

// Get Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file');
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Configuration
const BASE_COLOR = 'Surfmist'; // Standard/base color (no premium)
const ALLOWED_COLORS = [
	'Surfmist',
	'Evening Haze',
	'Classic Cream',
	'Paperbark',
	'Shale Grey',
	'Dune',
	'Cove',
	'Pale Eucalypt',
	'Windspray',
	'Wallaby',
];

const BUCKET_SIZES = ['5L', '10L', '15L'];
const BASE_PRICES: Record<string, string> = {
	'5L': '149.99',
	'10L': '285.99',
	'15L': '389.99',
};

const COLOR_PREMIUM_PERCENT = 10; // 10% extra for non-base colors

// Check for dry-run mode
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-d');

/**
 * Get Shopify config from database
 */
async function getShopifyConfig(): Promise<{ shopDomain: string; accessToken: string; apiVersion: string } | null> {
	const { data, error } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('integration_type', 'shopify')
		.limit(1)
		.single();

	if (error || !data) {
		console.error('Error: No Shopify integration found in database');
		return null;
	}

	const config = data.config as Record<string, unknown> | null;
	if (!config) return null;

	const accessToken = typeof config.accessToken === 'string' ? config.accessToken.trim() : '';
	const shopDomain = typeof config.shopDomain === 'string' 
		? config.shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
		: '';
	const apiVersion = typeof config.apiVersion === 'string' 
		? config.apiVersion.trim() || '2024-04'
		: '2024-04';

	if (!accessToken || !shopDomain) {
		console.error('Error: Invalid Shopify config in database');
		return null;
	}

	return { shopDomain, accessToken, apiVersion };
}

/**
 * Calculate price for a variant
 */
function calculatePrice(bucketSize: string, color: string): string {
	const basePrice = parseFloat(BASE_PRICES[bucketSize]);
	if (isNaN(basePrice)) {
		throw new Error(`Invalid base price for bucket size: ${bucketSize}`);
	}

	// If color is the base color, return base price
	if (color.toLowerCase() === BASE_COLOR.toLowerCase()) {
		return basePrice.toFixed(2);
	}

	// Otherwise, add 10% premium
	const premiumPrice = basePrice * (1 + COLOR_PREMIUM_PERCENT / 100);
	return premiumPrice.toFixed(2);
}

/**
 * Fetch products from Shopify using GraphQL
 */
async function fetchProducts(config: { shopDomain: string; accessToken: string; apiVersion: string }): Promise<any[]> {
	const query = `
		query getProducts($first: Int!) {
			products(first: $first) {
				edges {
					node {
						id
						title
						handle
						options {
							id
							name
							values
						}
						variants(first: 250) {
							edges {
								node {
									id
									title
									price
									inventoryItem {
										id
									}
									selectedOptions {
										name
										value
									}
									inventoryQuantity
								}
							}
						}
					}
				}
			}
		}
	`;

	const response = await fetch(`https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Shopify-Access-Token': config.accessToken,
		},
		body: JSON.stringify({
			query,
			variables: { first: 250 },
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
	}

	const data = await response.json();
	if (data.errors) {
		throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
	}

	return data.data.products.edges.map((edge: any) => edge.node);
}

/**
 * Create or update variants for a product
 */
async function setupProductVariants(
	product: any,
	config: { shopDomain: string; accessToken: string; apiVersion: string }
): Promise<void> {
	// Find the color and size options
	const colorOption = product.options.find((opt: any) => 
		opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
	);
	const sizeOption = product.options.find((opt: any) => 
		opt.name.toLowerCase().includes('size') || 
		opt.name.toLowerCase().includes('bucket')
	);

	if (!colorOption || !sizeOption) {
		console.log(`  ⏭️  Skipping "${product.title}" - missing color or size option`);
		return;
	}

	console.log(`\n📦 Processing "${product.title}"`);
	console.log(`   Color option: ${colorOption.name} (${colorOption.values.length} values)`);
	console.log(`   Size option: ${sizeOption.name} (${sizeOption.values.length} values)`);

	// Get existing variants
	const existingVariants = product.variants.edges.map((edge: any) => edge.node);
	
	// Create a map of existing variants by size and color
	const variantMap = new Map<string, any>();
	for (const variant of existingVariants) {
		const sizeValue = variant.selectedOptions.find(
			(opt: any) => opt.name.toLowerCase().includes('size') || opt.name.toLowerCase().includes('bucket')
		)?.value;
		const colorValue = variant.selectedOptions.find(
			(opt: any) => opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
		)?.value;
		if (sizeValue && colorValue) {
			const key = `${sizeValue}|${colorValue}`;
			variantMap.set(key, variant);
		}
	}

	// Store variant map for inventory updates
	const variantMapForInventory = variantMap;

	// Ensure all combinations exist and have correct prices
	const variantsToCreate: Array<{ size: string; color: string; price: string }> = [];
	const variantsToUpdate: Array<{ id: string; size: string; color: string; price: string }> = [];

	for (const size of BUCKET_SIZES) {
		for (const color of ALLOWED_COLORS) {
			const key = `${size}|${color}`;
			const price = calculatePrice(size, color);
			const existingVariant = variantMap.get(key);

			if (existingVariant) {
				// Check if price or inventory needs updating
				const currentPrice = parseFloat(existingVariant.price || '0');
				const expectedPrice = parseFloat(price);
				const currentInventory = existingVariant.inventoryQuantity || 0;
				const expectedInventory = 100;
				
				if (Math.abs(currentPrice - expectedPrice) > 0.01 || currentInventory !== expectedInventory) {
					variantsToUpdate.push({ id: existingVariant.id, size, color, price });
				}
			} else {
				variantsToCreate.push({ size, color, price });
			}
		}
	}

	console.log(`   📊 Variants to create: ${variantsToCreate.length}`);
	console.log(`   📊 Variants to update: ${variantsToUpdate.length}`);

	if (variantsToCreate.length === 0 && variantsToUpdate.length === 0) {
		console.log(`   ✅ All variants exist with correct prices and inventory`);
		return;
	}

	// Get location ID (we'll use the first location)
	let locationId: string | null = null;
	if (!DRY_RUN && variantsToUpdate.length > 0) {
		const locationsUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}/locations.json`;
		const locationsResponse = await fetch(locationsUrl, {
			headers: {
				'X-Shopify-Access-Token': config.accessToken,
			},
		});
		if (locationsResponse.ok) {
			const locationsData = await locationsResponse.json();
			if (locationsData.locations && locationsData.locations.length > 0) {
				locationId = locationsData.locations[0].id.toString();
			}
		}
	}

	// Update existing variants using REST API
	for (const variant of variantsToUpdate) {
		// Find the existing variant to get inventory item ID
		const existingVariant = variantMapForInventory.get(`${variant.size}|${variant.color}`);
		if (!existingVariant) continue;

		// Extract variant ID number from GraphQL ID
		const variantId = variant.id.replace('gid://shopify/ProductVariant/', '');
		const updateUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}/variants/${variantId}.json`;
		
		if (!DRY_RUN) {
			// Update price
			const response = await fetch(updateUrl, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'X-Shopify-Access-Token': config.accessToken,
				},
				body: JSON.stringify({
					variant: {
						price: variant.price,
					},
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`   ❌ Failed to update variant ${variant.size} / ${variant.color}: ${errorText}`);
				continue;
			}

			const data = await response.json();
			if (data.errors) {
				console.error(`   ❌ Error updating variant ${variant.size} / ${variant.color}: ${JSON.stringify(data.errors)}`);
				continue;
			}

			// Set inventory quantity via inventory levels
			if (locationId && existingVariant.inventoryItem?.id) {
				const inventoryItemId = existingVariant.inventoryItem.id.replace('gid://shopify/InventoryItem/', '');
				const inventoryUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}/inventory_levels/set.json`;
				
				const inventoryResponse = await fetch(inventoryUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Shopify-Access-Token': config.accessToken,
					},
					body: JSON.stringify({
						location_id: locationId,
						inventory_item_id: inventoryItemId,
						available: 100,
					}),
				});

				if (!inventoryResponse.ok) {
					const errorText = await inventoryResponse.text();
					console.error(`   ⚠️  Failed to set inventory for ${variant.size} / ${variant.color}: ${errorText}`);
				}
			}

			console.log(`   ✅ Updated ${variant.size} / ${variant.color}: $${variant.price} (Qty: 100)`);
			
			// Small delay to avoid rate limiting
			await new Promise(resolve => setTimeout(resolve, 200));
		} else {
			console.log(`   🔄 Would update ${variant.size} / ${variant.color}: $${variant.price} (Qty: 100)`);
		}
	}

	// Create new variants
	if (variantsToCreate.length > 0) {
		// Determine option order from existing variants
		let sizeIsOption1 = true;
		if (existingVariants.length > 0) {
			const firstVariant = existingVariants[0];
			const sizeValue = firstVariant.selectedOptions.find(
				(opt: any) => opt.name.toLowerCase().includes('size') || opt.name.toLowerCase().includes('bucket')
			)?.value;
			const colorValue = firstVariant.selectedOptions.find(
				(opt: any) => opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
			)?.value;
			
			// Check which option comes first by looking at option positions
			const sizeOptionIndex = product.options.findIndex((opt: any) => 
				opt.name.toLowerCase().includes('size') || opt.name.toLowerCase().includes('bucket')
			);
			const colorOptionIndex = product.options.findIndex((opt: any) => 
				opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
			);
			sizeIsOption1 = sizeOptionIndex < colorOptionIndex;
		}

		// Extract product ID number from GraphQL ID
		const productId = product.id.replace('gid://shopify/Product/', '');
		const createUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}/products/${productId}/variants.json`;
		
		for (const variant of variantsToCreate) {
			if (!DRY_RUN) {
				const variantData: any = {
					price: variant.price,
					inventory_quantity: 100,
				};
				
				if (sizeIsOption1) {
					variantData.option1 = variant.size;
					variantData.option2 = variant.color;
				} else {
					variantData.option1 = variant.color;
					variantData.option2 = variant.size;
				}

				const response = await fetch(createUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Shopify-Access-Token': config.accessToken,
					},
					body: JSON.stringify({
						variant: variantData,
					}),
				});

				if (!response.ok) {
					const errorText = await response.text();
					console.error(`   ❌ Failed to create variant ${variant.size} / ${variant.color}: ${errorText}`);
					continue;
				}

				const data = await response.json();
				if (data.errors) {
					console.error(`   ❌ Error creating variant ${variant.size} / ${variant.color}: ${JSON.stringify(data.errors)}`);
				} else {
					console.log(`   ✅ Created ${variant.size} / ${variant.color}: $${variant.price} (Qty: 100)`);
				}
				
				// Small delay to avoid rate limiting
				await new Promise(resolve => setTimeout(resolve, 200));
			} else {
				console.log(`   🔄 Would create ${variant.size} / ${variant.color}: $${variant.price} (Qty: 100)`);
			}
		}
	}
}

/**
 * Main function
 */
async function main() {
	console.log('🚀 Starting product variant setup...\n');
	
	if (DRY_RUN) {
		console.log('⚠️  DRY RUN MODE - No changes will be made\n');
	}

	try {
		// Get Shopify config from database
		console.log('📡 Retrieving Shopify configuration from database...');
		const shopifyConfig = await getShopifyConfig();
		if (!shopifyConfig) {
			console.error('\n❌ Failed to get Shopify configuration');
			process.exit(1);
		}
		
		console.log(`✅ Connected to: ${shopifyConfig.shopDomain}\n`);

		// Fetch all products
		console.log('📥 Fetching products from Shopify...');
		const products = await fetchProducts(shopifyConfig);
		console.log(`✅ Found ${products.length} products\n`);

		// Process each product
		let processed = 0;
		for (const product of products) {
			await setupProductVariants(product, shopifyConfig);
			processed++;
			
			// Add a small delay to avoid rate limiting
			if (processed < products.length) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}
		}

		console.log(`\n✅ Completed! Processed ${processed} products`);
		if (DRY_RUN) {
			console.log('\n💡 Run without --dry-run to apply changes');
		}
	} catch (error) {
		console.error('\n❌ Error:', error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

main();
