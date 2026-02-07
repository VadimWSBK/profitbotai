#!/usr/bin/env tsx
/**
 * Script to update Shopify products by removing color variants
 * 
 * This script:
 * 1. Lists all products from Shopify
 * 2. Identifies products with bucket sizes and color options
 * 3. Removes all color variants except the allowed colors:
 *    - Surfmist, Evening Haze, Classic Cream, Paperbark, Shale Grey,
 *      Dune, Cove, Pale Eucalypt, Windspray, Wallaby
 * 
 * Usage:
 *   npx tsx scripts/update-shopify-products.ts [--dry-run]
 * 
 * The script uses your Shopify OAuth connection stored in the database.
 * Make sure you have connected Shopify via OAuth in the integrations page.
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

/**
 * Get Shopify config from database
 */
async function getShopifyConfig(): Promise<{ shopDomain: string; accessToken: string; apiVersion: string } | null> {
	// Get the first user with Shopify integration
	const { data, error } = await supabase
		.from('user_integrations')
		.select('config')
		.eq('integration_type', 'shopify')
		.limit(1)
		.single();

	if (error || !data) {
		console.error('Error: No Shopify integration found in database');
		console.error('Make sure you have connected Shopify via OAuth in the integrations page');
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

// Define the exact colors to keep (case-insensitive matching)
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

/**
 * Check if a color should be kept (matches the allowed list)
 */
function isAllowedColor(colorName: string): boolean {
	const normalized = colorName.trim();
	// Case-insensitive match against allowed colors
	return ALLOWED_COLORS.some(allowed => 
		allowed.toLowerCase() === normalized.toLowerCase()
	);
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
 * Dry-run version - just shows what would be changed
 */
async function updateProductDryRun(product: any): Promise<void> {
	// Find the color option
	const colorOption = product.options.find((opt: any) => 
		opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
	);

	if (!colorOption) {
		console.log(`  ⏭️  Skipping "${product.title}" - no color option found`);
		return;
	}

	// Check if product has bucket size option
	const sizeOption = product.options.find((opt: any) => 
		opt.name.toLowerCase().includes('size') || 
		opt.name.toLowerCase().includes('bucket')
	);

	if (!sizeOption) {
		console.log(`  ⏭️  Skipping "${product.title}" - no size/bucket option found`);
		return;
	}

	console.log(`\n📦 Would process "${product.title}"`);
	console.log(`   Color option: ${colorOption.name} (${colorOption.values.length} values)`);
	console.log(`   Size option: ${sizeOption.name} (${sizeOption.values.length} values)`);

	// Identify colors to keep vs remove
	const allowedColorValues = colorOption.values.filter((value: string) => isAllowedColor(value));
	const colorsToRemove = colorOption.values.filter((value: string) => !isAllowedColor(value));

	if (colorsToRemove.length === 0) {
		console.log(`   ✅ All colors are in the allowed list, would skip`);
		return;
	}

	console.log(`   ✨ Colors to keep: ${allowedColorValues.join(', ')}`);
	console.log(`   🗑️  Colors to remove: ${colorsToRemove.join(', ')}`);

	// Find variants with colors that should be removed
	const variantsToDelete = product.variants.edges
		.map((edge: any) => edge.node)
		.filter((variant: any) => {
			const colorValue = variant.selectedOptions.find(
				(opt: any) => opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
			)?.value;
			return colorValue && !isAllowedColor(colorValue);
		});

	if (variantsToDelete.length === 0) {
		console.log(`   ✅ No variants to delete, would skip`);
		return;
	}

	console.log(`   🗑️  Would delete ${variantsToDelete.length} variant(s):`);
	variantsToDelete.forEach((variant: any) => {
		console.log(`      - ${variant.title} (Inventory: ${variant.inventoryQuantity})`);
	});
}

/**
 * Update product by removing dark color variants
 */
async function updateProduct(product: any, config: { shopDomain: string; accessToken: string; apiVersion: string }): Promise<void> {
	// Find the color option
	const colorOption = product.options.find((opt: any) => 
		opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
	);

	if (!colorOption) {
		console.log(`  ⏭️  Skipping "${product.title}" - no color option found`);
		return;
	}

	// Check if product has bucket size option
	const sizeOption = product.options.find((opt: any) => 
		opt.name.toLowerCase().includes('size') || 
		opt.name.toLowerCase().includes('bucket')
	);

	if (!sizeOption) {
		console.log(`  ⏭️  Skipping "${product.title}" - no size/bucket option found`);
		return;
	}

	console.log(`\n📦 Processing "${product.title}"`);
	console.log(`   Color option: ${colorOption.name} (${colorOption.values.length} values)`);
	console.log(`   Size option: ${sizeOption.name} (${sizeOption.values.length} values)`);

	// Identify colors to keep vs remove
	const allowedColorValues = colorOption.values.filter((value: string) => isAllowedColor(value));
	const colorsToRemove = colorOption.values.filter((value: string) => !isAllowedColor(value));

	if (colorsToRemove.length === 0) {
		console.log(`   ✅ All colors are in the allowed list, skipping`);
		return;
	}

	console.log(`   ✨ Colors to keep: ${allowedColorValues.join(', ')}`);
	console.log(`   🗑️  Colors to remove: ${colorsToRemove.join(', ')}`);

	// Find variants with colors that should be removed
	const variantsToDelete = product.variants.edges
		.map((edge: any) => edge.node)
		.filter((variant: any) => {
			const colorValue = variant.selectedOptions.find(
				(opt: any) => opt.name.toLowerCase() === 'color' || opt.name.toLowerCase() === 'colour'
			)?.value;
			return colorValue && !isAllowedColor(colorValue);
		});

	if (variantsToDelete.length === 0) {
		console.log(`   ✅ No variants to delete, skipping`);
		return;
	}

	console.log(`   🗑️  Found ${variantsToDelete.length} variant(s) to delete`);

	// Delete variants with colors not in the allowed list using bulk delete
	if (variantsToDelete.length > 0) {
		const variantIds = variantsToDelete.map((v: any) => v.id);
		
		// Extract product ID from GraphQL ID (format: gid://shopify/Product/123456789)
		const productGid = product.id;
		
		const mutation = `
			mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
				productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
					product {
						id
						title
					}
					userErrors {
						field
						message
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
				query: mutation,
				variables: { 
					productId: productGid,
					variantsIds: variantIds 
				},
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`   ❌ Failed to delete variants: ${errorText}`);
		} else {
			const data = await response.json();
			if (data.errors) {
				console.error(`   ❌ GraphQL errors: ${JSON.stringify(data.errors)}`);
			} else if (data.data.productVariantsBulkDelete.userErrors?.length > 0) {
				const errors = data.data.productVariantsBulkDelete.userErrors;
				console.error(`   ❌ User errors: ${JSON.stringify(errors)}`);
			} else {
				console.log(`   ✅ Successfully deleted ${variantsToDelete.length} variant(s)`);
			}
		}
	}

	// Note: Deleting variants should automatically remove unused option values
	// If option values remain, they can be cleaned up manually in Shopify admin
	console.log(`   ℹ️  Note: Option values will be automatically cleaned up when variants are deleted`);
}

// Check for dry-run mode
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-d');

/**
 * Main function
 */
async function main() {
	console.log('🚀 Starting Shopify product update...\n');
	
	if (DRY_RUN) {
		console.log('⚠️  DRY RUN MODE - No changes will be made\n');
	}

	try {
		// Get Shopify config from database
		console.log('📡 Retrieving Shopify configuration from database...');
		const shopifyConfig = await getShopifyConfig();
		if (!shopifyConfig) {
			console.error('\n❌ Failed to get Shopify configuration');
			console.error('💡 Make sure you have connected Shopify via OAuth in the integrations page');
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
			if (DRY_RUN) {
				await updateProductDryRun(product);
			} else {
				await updateProduct(product, shopifyConfig);
			}
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
