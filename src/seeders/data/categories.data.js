/**
 * Category seed data — a small two-level tree.
 *
 * `parentSlug` is resolved to a real ObjectId by the seeder after the
 * parent categories are inserted (we cannot know ObjectIds before insert).
 */
export const categoryDefinitions = [
  // Top-level categories (parentSlug: null)
  { name: "Electronics", slug: "electronics", parentSlug: null, description: "Gadgets, devices and accessories" },
  { name: "Fashion", slug: "fashion", parentSlug: null, description: "Clothing and accessories" },
  { name: "Home & Kitchen", slug: "home-kitchen", parentSlug: null, description: "Everything for the home" },
  { name: "Sports & Fitness", slug: "sports-fitness", parentSlug: null, description: "Gear for an active life" },
  { name: "Books", slug: "books", parentSlug: null, description: "Printed and electronic books" },

  // Child categories (their parentSlug points at a category above)
  { name: "Laptops", slug: "laptops", parentSlug: "electronics", description: "Portable computers" },
  { name: "Smartphones", slug: "smartphones", parentSlug: "electronics", description: "Mobile phones" },
  { name: "Headphones", slug: "headphones", parentSlug: "electronics", description: "Wired and wireless audio" },
  { name: "Cookware", slug: "cookware", parentSlug: "home-kitchen", description: "Pots, pans and utensils" },
  { name: "Fitness Equipment", slug: "fitness-equipment", parentSlug: "sports-fitness", description: "Home gym essentials" },
];
