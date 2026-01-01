// ==========================================================================
// Avatar and Name Generation Utilities
// ==========================================================================

// Fun adjectives for random names
const ADJECTIVES = [
  'Happy', 'Clever', 'Swift', 'Brave', 'Calm', 'Bright', 'Cool', 'Wild',
  'Gentle', 'Bold', 'Quick', 'Wise', 'Lucky', 'Jolly', 'Merry', 'Quiet',
  'Eager', 'Fancy', 'Noble', 'Proud', 'Sharp', 'Smart', 'Sunny', 'Witty'
];

// Fun nouns for random names
const NOUNS = [
  'Panda', 'Tiger', 'Eagle', 'Dolphin', 'Fox', 'Wolf', 'Bear', 'Lion',
  'Owl', 'Hawk', 'Koala', 'Otter', 'Raven', 'Falcon', 'Lynx', 'Penguin',
  'Phoenix', 'Dragon', 'Unicorn', 'Griffin', 'Turtle', 'Rabbit', 'Deer', 'Cat'
];

// Avatar IDs - must match frontend SVG_AVATARS keys in app.js
const AVATAR_IDS = [
  'avatar1', 'avatar2', 'avatar3', 'avatar4', 'avatar5', 'avatar6',
  'avatar7', 'avatar8', 'avatar9', 'avatar10', 'avatar11', 'avatar12'
];

// Room avatar IDs - must match frontend ROOM_AVATARS keys
const ROOM_AVATAR_IDS = ['room1', 'room2', 'room3', 'room4'];

/**
 * Generate a random display name
 */
export function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

/**
 * Generate a random avatar ID
 */
export function generateRandomAvatar() {
  return AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)];
}

/**
 * Generate a random room avatar ID
 */
export function generateRandomRoomAvatar() {
  return ROOM_AVATAR_IDS[Math.floor(Math.random() * ROOM_AVATAR_IDS.length)];
}

/**
 * Generate multiple avatar options for user to choose
 */
export function generateAvatarOptions(count = 6) {
  const shuffled = [...AVATAR_IDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, AVATAR_IDS.length));
}

/**
 * Generate multiple name suggestions
 */
export function generateNameOptions(count = 4) {
  const names = new Set();
  const maxAttempts = count * 3;
  let attempts = 0;
  
  while (names.size < count && attempts < maxAttempts) {
    names.add(generateRandomName());
    attempts++;
  }
  return Array.from(names);
}
