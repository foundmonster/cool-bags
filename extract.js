const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

// Find the start and end of the array
const start = html.indexOf('const backpacksData = [');
const end = html.indexOf('];', start) + 2;
const jsCode = html.substring(start, end);

// Execute the JavaScript to get the array
eval(jsCode);

// Write as JSON
fs.writeFileSync('bags.json', JSON.stringify(backpacksData, null, 2));
console.log(`Created bags.json with ${backpacksData.length} bags`);
