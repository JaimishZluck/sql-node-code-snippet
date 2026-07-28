import { randomInt, pick, pickMany, chance, dateWithinDays } from "../lib/random.js";

const FIRST_NAMES = [
  "Aarav", "Isha", "Rohan", "Priya", "Kabir", "Ananya", "Vikram", "Meera",
  "Arjun", "Sneha", "Dev", "Pooja", "Rahul", "Nisha", "Karan", "Tara",
  "Sameer", "Divya", "Yash", "Ritika", "Aditya", "Kavya", "Nikhil", "Simran",
  "Manav", "Zoya", "Harsh", "Lena", "Omar", "Mia",
];

const LAST_NAMES = [
  "Sharma", "Patel", "Singh", "Mehta", "Iyer", "Khan", "Desai", "Kapoor",
  "Joshi", "Nair", "Verma", "Rao", "Gupta", "Shah", "Malhotra",
];

const CITIES = [
  { city: "Mumbai", state: "Maharashtra", zip: "400001" },
  { city: "Ahmedabad", state: "Gujarat", zip: "380001" },
  { city: "Bengaluru", state: "Karnataka", zip: "560001" },
  { city: "Delhi", state: "Delhi", zip: "110001" },
  { city: "Pune", state: "Maharashtra", zip: "411001" },
  { city: "Surat", state: "Gujarat", zip: "395003" },
  { city: "Jaipur", state: "Rajasthan", zip: "302001" },
];

const INTERESTS = [
  "gaming", "reading", "fitness", "cooking", "music", "travel",
  "photography", "yoga", "coding", "cricket",
];

const EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "zluck.dev"];

/**
 * Build `count` user objects (plain data — nothing touches the database
 * here). Variety is intentional so lessons have something to filter on:
 *  - a few users have NO address and NO age        -> $exists queries
 *  - a few are inactive                            -> boolean filters
 *  - a few are soft-deleted (deletedAt set)        -> soft-delete lessons
 *  - roles are mostly "customer" plus a few others -> enum/group queries
 */
export function buildUsers(random, count = 30) {
  const users = [];
  const usedEmails = new Set();

  for (let i = 0; i < count; i += 1) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = pick(random, LAST_NAMES);

    // Guarantee unique emails (the schema has a unique index on email).
    let email = `${firstName}.${lastName}@${pick(random, EMAIL_DOMAINS)}`.toLowerCase();
    if (usedEmails.has(email)) email = `${firstName}.${lastName}${i}@${pick(random, EMAIL_DOMAINS)}`.toLowerCase();
    usedEmails.add(email);

    const location = pick(random, CITIES);

    const user = {
      name: `${firstName} ${lastName}`,
      email,
      role: i < 2 ? "admin" : i < 5 ? "seller" : "customer",
      isActive: !chance(random, 0.12),
      interests: pickMany(random, INTERESTS, randomInt(random, 0, 4)),
      loyaltyPoints: randomInt(random, 0, 5000),
      deletedAt: chance(random, 0.1) ? dateWithinDays(random, 60, 5) : null,
    };

    // ~15% of users have no age and no address — useful for $exists demos.
    if (!chance(random, 0.15)) {
      user.age = randomInt(random, 16, 65);
      user.address = {
        street: `${randomInt(random, 1, 200)} ${pick(random, ["MG Road", "Link Road", "Station Road", "Ring Road", "Hill View"])}`,
        city: location.city,
        state: location.state,
        country: "India",
        zip: location.zip,
      };
    }

    // Most users have logged in at some point during the last 90 days.
    if (chance(random, 0.85)) {
      user.lastLoginAt = dateWithinDays(random, 90);
    }

    users.push(user);
  }

  return users;
}
