const fs = require('fs');

let cb = fs.readFileSync('commerce_brain.js', 'utf8');
cb = cb.replace(
  '  cleanHumanFormatting,\n  buildSystemPrompt,',
  '  cleanHumanFormatting,\n  buildSystemPrompt,\n  normalizeBdPhone,\n  validateBdAddress,'
);
fs.writeFileSync('commerce_brain.js', cb, 'utf8');
console.log('Exported normalizeBdPhone and validateBdAddress in commerce_brain.js');
