const fs = require('fs');
const planData = fs.readFileSync('plan', 'utf-8');
const planObj = (0, eval)(`(${planData})`);

// Create a new file with the evaluated plan object
fs.writeFileSync(
  'plan.js',
  '// Generated plan data\nmodule.exports = ' + 
  require('util').inspect(planObj, { depth: null, maxArrayLength: null }) + ';\n',
  'utf-8'
);

console.log('Successfully converted plan to plan.js');
