import { execSync } from 'node:child_process';

console.log('>>> Verify: make openapi -> npm run gen-api -> npm run build');

execSync('make openapi', {
  cwd: '../registry',
  stdio: 'inherit',
});

execSync('npm run gen-api', {
  cwd: '.',
  stdio: 'inherit',
});

execSync('npm run build', {
  cwd: '.',
  stdio: 'inherit',
});

console.log('>>> Verify finished successfully');

