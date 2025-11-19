const fs = require('fs');

// Read current bags.json
const bags = JSON.parse(fs.readFileSync('bags.json', 'utf8'));

// New Mission Workshop bags (IDs 178-189)
const newBags = [
  { id: 178, brand: 'Mission Workshop', name: 'Rhake LS', price: 495, volume: 22, weight: 0, material: 'VX21', type: 'Backpack', description: 'Everyday carry backpack crafted with military-grade construction.', link: 'https://missionworkshop.com/products/rhake-ls-everyday-carry-backpack', image: 'images/mission-workshop-rhake-ls.png' },
  { id: 179, brand: 'Mission Workshop', name: 'MERIDIAN', price: 395, volume: 30, weight: 0, material: 'EPX 200', type: 'Backpack', description: 'Modular pack system for versatile everyday and travel use.', link: 'https://missionworkshop.com/products/meridian-backpack', image: 'images/mission-workshop-meridian.png' },
  { id: 180, brand: 'Mission Workshop', name: 'Control EPX Pack', price: 405, volume: 30, weight: 0, material: 'EPX 200', type: 'Backpack', description: 'Expandable modular system with multiple capacity options.', link: 'https://missionworkshop.com/products/control-modular-backpack', image: 'images/mission-workshop-control-epx.png' },
  { id: 181, brand: 'Mission Workshop', name: 'Sanction: AP', price: 305, volume: 25, weight: 0, material: 'VX21', type: 'Backpack', description: 'Tactical rucksack designed for demanding outdoor missions.', link: 'https://missionworkshop.com/products/sanction-ap-rucksack-backpack', image: 'images/mission-workshop-sanction-ap.png' },
  { id: 182, brand: 'Mission Workshop', name: 'Fitzroy: AP', price: 345, volume: 40, weight: 0, material: 'VX21', type: 'Backpack', description: 'Waterproof 40-liter rucksack engineered for expedition use.', link: 'https://missionworkshop.com/products/fitzroy-advanced-40l-waterproof-rucksack-backpack', image: 'images/mission-workshop-fitzroy-ap-40l.png' },
  { id: 183, brand: 'Mission Workshop', name: 'R6 Arkiv Field Pack 40L', price: 295, volume: 40, weight: 0, material: 'VX21', type: 'Backpack', description: 'High-capacity field pack constructed with rugged USA-made materials.', link: 'https://missionworkshop.com/products/r6-arkiv-field-pack-40l', image: 'images/mission-workshop-r6-arkiv-40l.png' },
  { id: 184, brand: 'Mission Workshop', name: 'TX70 Packing Cube', price: 50, volume: 8, weight: 0, material: 'UX10', type: 'Packing Cube', description: 'Compression storage solution for organized pack management.', link: 'https://missionworkshop.com/products/packing-cubes', image: 'images/mission-workshop-tx70-packing-cube.png' },
  { id: 185, brand: 'Mission Workshop', name: 'Capsule', price: 185, volume: 5, weight: 0, material: 'VX21', type: 'Camera Insert', description: 'Camera and gear protection insert for modular compatibility.', link: 'https://missionworkshop.com/products/capsule-camera-insert', image: 'images/mission-workshop-capsule.png' },
  { id: 186, brand: 'Mission Workshop', name: 'Hauser 14L', price: 270, volume: 14, weight: 0, material: 'VX21', type: 'Hydration Pack', description: 'Lightweight hydration pack optimized for active pursuits.', link: 'https://missionworkshop.com/products/hauser-14l-hydration-pack', image: 'images/mission-workshop-hauser-14l.png' },
  { id: 187, brand: 'Mission Workshop', name: 'Hauser 10L', price: 260, volume: 10, weight: 0, material: 'VX21', type: 'Hydration Pack', description: 'Compact hydration pack designed for minimal-load adventures.', link: 'https://missionworkshop.com/products/hauser-10l-hydration-pack', image: 'images/mission-workshop-hauser-10l.png' },
  { id: 188, brand: 'Mission Workshop', name: 'PRIME MERIDIAN', price: 525, volume: 35, weight: 0, material: 'Ultra', type: 'Backpack', description: 'Premium modular system with exclusive performance features.', link: 'https://missionworkshop.com/products/mars-project-2-backpack-prime-meridian', image: 'images/mission-workshop-prime-meridian.png' },
  { id: 189, brand: 'Mission Workshop', name: 'Mission Workshop X Carryology', price: 545, volume: 30, weight: 0, material: 'Ultra', type: 'Backpack', description: 'Collaborative design emphasizing advanced carry solutions.', link: 'https://missionworkshop.com/products/mission-workshop-x-carryology-control-collection', image: 'images/mission-workshop-carryology.png' }
];

// Add new bags
bags.push(...newBags);

// Write back to bags.json
fs.writeFileSync('bags.json', JSON.stringify(bags, null, 2));
console.log(`✓ Added 12 Mission Workshop bags (IDs 178-189)`);
console.log(`Total bags in database: ${bags.length}`);
