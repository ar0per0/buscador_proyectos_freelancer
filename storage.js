const fs = require('node:fs');

function writeJsonAtomicSync(filePath, value) {
  const temporaryFile = `${filePath}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryFile, filePath);
}

module.exports = { writeJsonAtomicSync };
