import fs from 'fs';

const lines = fs.readFileSync('src/components/GSTReportsModule.tsx', 'utf8').split('\n');

// Section A: lines 1 to 58 (0-indexed: 0 to 57)
const sectionA = lines.slice(0, 58).join('\n');

// Section B: lines 59 to 605 (0-indexed: 58 to 604)
const sectionB = lines.slice(58, 605).join('\n');

// Section C: lines 606 to end (0-indexed: 605 onwards)
const sectionC = lines.slice(605).join('\n');

const newContent = `${sectionA}\n\n${sectionC}\n\n${sectionB}\n`;

fs.writeFileSync('src/components/GSTReportsModule.tsx', newContent, 'utf8');
console.log('Reordered GSTReportsModule.tsx successfully');
