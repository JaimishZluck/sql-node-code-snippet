import { randomInt, pick, pickMany, chance } from "../lib/random.js";

/**
 * Product blueprints per (leaf) category slug. The seeder combines these
 * with brands/adjectives to generate ~60 varied products with realistic
 * price ranges per category.
 */
const BLUEPRINTS = {
  laptops: {
    nouns: ["Ultrabook 14", "Gaming Laptop 15", "Notebook Air", "Creator Book 16", "Chromebook 11"],
    brands: ["Volt", "Nexa", "Orbit", "Zenith"],
    price: [32000, 185000],
    weight: [1100, 2600],
  },
  smartphones: {
    nouns: ["Phone X", "Phone Lite", "Phone Pro", "Phone Max", "Phone Mini"],
    brands: ["Nexa", "Pixelon", "Orbit", "Aura"],
    price: [8000, 140000],
    weight: [160, 240],
  },
  headphones: {
    nouns: ["Wireless Earbuds", "Over-Ear Headphones", "Neckband", "Studio Monitors", "Sport Earphones"],
    brands: ["EchoBeat", "Volt", "Aura", "BassLine"],
    price: [800, 35000],
    weight: [40, 380],
  },
  cookware: {
    nouns: ["Non-Stick Pan", "Pressure Cooker", "Cast Iron Skillet", "Knife Set", "Stock Pot"],
    brands: ["HomeChef", "Prima", "SteelCraft"],
    price: [500, 9000],
    weight: [400, 4500],
  },
  "fitness-equipment": {
    nouns: ["Yoga Mat", "Adjustable Dumbbells", "Resistance Bands", "Kettlebell", "Exercise Bike"],
    brands: ["FlexFit", "IronCore", "Prima"],
    price: [300, 45000],
    weight: [250, 22000],
  },
  fashion: {
    nouns: ["Cotton T-Shirt", "Denim Jacket", "Running Shoes", "Leather Belt", "Hoodie"],
    brands: ["UrbanWeave", "StrideOn", "Prima"],
    price: [400, 8000],
    weight: [150, 900],
  },
  books: {
    nouns: ["Mystery Novel", "Cookbook", "Sci-Fi Anthology", "Self-Help Guide", "History Atlas"],
    brands: ["InkHouse", "PagePress"],
    price: [150, 1500],
    weight: [200, 1200],
  },
};

const ADJECTIVES = ["Classic", "Pro", "Eco", "Prime", "Sport", "Compact", "Deluxe", "Essential"];
const COLORS = ["black", "white", "blue", "red", "silver", "green"];
const TAGS = [
  "bestseller", "new-arrival", "premium", "budget", "eco-friendly",
  "wireless", "gift-idea", "limited-edition", "sale",
];

/**
 * Build product objects. Needs the inserted categories (for their real
 * ObjectIds). Products only go into categories that have a blueprint.
 */
export function buildProducts(random, categories, countPerCategory = 9) {
  const products = [];
  let skuCounter = 1000;

  for (const category of categories) {
    const blueprint = BLUEPRINTS[category.slug];
    if (!blueprint) continue; // parent categories like "Electronics" hold no products directly

    for (let i = 0; i < countPerCategory; i += 1) {
      const noun = pick(random, blueprint.nouns);
      const brand = pick(random, blueprint.brands);
      const adjective = pick(random, ADJECTIVES);
      const [minPrice, maxPrice] = blueprint.price;

      skuCounter += randomInt(random, 1, 9);

      products.push({
        name: `${brand} ${adjective} ${noun}`,
        sku: `${category.slug.slice(0, 3).toUpperCase()}-${skuCounter}`,
        description:
          `The ${brand} ${adjective} ${noun} combines dependable build quality with everyday value. ` +
          `A popular pick in our ${category.name} range.`,
        price: randomInt(random, minPrice, maxPrice),
        discountPercent: chance(random, 0.4) ? pick(random, [5, 10, 15, 20, 30, 40]) : 0,
        stock: chance(random, 0.1) ? 0 : randomInt(random, 3, 500), // ~10% out of stock
        category: category._id,
        tags: pickMany(random, TAGS, randomInt(random, 1, 4)),
        specs: {
          brand,
          color: pick(random, COLORS),
          weightGrams: randomInt(random, blueprint.weight[0], blueprint.weight[1]),
          warrantyMonths: pick(random, [0, 6, 12, 24]),
        },
        isActive: !chance(random, 0.08), // a few discontinued products
      });
    }
  }

  return products;
}
