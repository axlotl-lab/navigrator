/**
 * Automated release script for npm packages
 * 
 * This script:
 * 1. Reads the current version from package.json
 * 2. Creates a commit for any package.json changes
 * 3. Creates a version tag
 * 4. Pushes the commit and tag to trigger the release workflow
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Execute command and display output
function runCommand(command) {
  console.log(`Executing: ${command}`);
  try {
    const output = execSync(command, { encoding: 'utf8' });
    console.log(output);
    return output;
  } catch (error) {
    console.error(`Error executing: ${command}`);
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

// Read version from package.json
const packageJsonPath = path.resolve(process.cwd(), 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('Error: package.json file not found');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

if (!version) {
  console.error('Error: Could not find version in package.json');
  process.exit(1);
}

console.log(`\n🚀 Starting release process for version ${version}\n`);

// Check if package.json has changes
const packageJsonStatus = runCommand('git status --porcelain package.json');
const hasPackageChanges = packageJsonStatus.trim() !== '';

// Workflow based on status
if (hasPackageChanges) {
  console.log('Changes detected in package.json - will include in release commit');

  // Stage package.json changes regardless of current status
  // This will handle both modified (M) and unstaged (??) changes
  runCommand('git add package.json');
  console.log('Staged package.json changes for commit');
} else {
  console.log('No changes in package.json - proceeding with current version');
}

// Confirm with user
console.log(`\n⚠️  This will create and publish version v${version}`);
console.log('Press Ctrl+C to cancel or Enter to continue...');
process.stdin.once('data', () => {
  // Create commit if needed
  if (hasPackageChanges) {
    runCommand(`git commit -m "Release v${version}"`);
  }

  // Create tag
  runCommand(`git tag v${version}`);

  // Push to remote repository
  runCommand('git push');

  // Push tag
  runCommand(`git push origin v${version}`);

  console.log(`\n✅ Release v${version} started successfully!`);
  console.log('The GitHub action should run automatically.');
  process.exit(0);
});