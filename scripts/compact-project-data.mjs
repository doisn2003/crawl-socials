import { compactSavedProject } from '../dist/infrastructure/projects/compact-project.js';
import { registerRetainedSourceRoot } from '../dist/application/retained-source-roots.js';

const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw Error('PASS_PROJECT_DATA_DIRECTORY');
const result = await compactSavedProject(directory);
let recoveryRegistered = false;
if (result.previous) {
  try {
    await registerRetainedSourceRoot({ directory, selectedPath: result.previous });
    recoveryRegistered = true;
  } catch { /* The original directory is still available through the folder picker. */ }
}
console.log(JSON.stringify({ ...result, recoveryRegistered }));
