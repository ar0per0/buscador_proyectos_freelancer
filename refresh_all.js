#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

function run(script, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      for (const line of chunk.toString().trim().split('\n').filter(Boolean)) {
        process.stderr.write(`${label}: ${line}\n`);
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${label} falló: ${stderr.trim().split('\n').at(-1) || code}`));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error(`${label} devolvió una respuesta inválida`)); }
    });
  });
}

Promise.all([
  run('scrape_workana.js', 'Workana'),
  run('scrape_freelancer.js', 'Freelancer'),
  run('scrape_soyfreelancer.js', 'SoyFreelancer'),
]).then(([workana, freelancer, soyfreelancer]) => {
  process.stdout.write(JSON.stringify({
    unique_records: workana.unique_records + freelancer.unique_records + soyfreelancer.unique_records,
    workana,
    freelancer,
    soyfreelancer,
  }) + '\n');
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
