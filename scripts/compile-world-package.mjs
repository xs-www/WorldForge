import { writeWorldPackageFile } from '../simulation/compiler/world-package.mjs';

const [, , manifestPath, outputPath] = process.argv;
if (!manifestPath || !outputPath) {
  console.error('用法：node scripts/compile-world-package.mjs <manifest.json> <output.json>');
  process.exitCode = 1;
} else {
  try {
    const result = await writeWorldPackageFile(manifestPath, outputPath);
    console.log(`已编译 ${result.worldId}@${result.definitionVersion} ${result.packageHash}`);
  } catch (error) {
    console.error(`${error.code ?? 'COMPILE_ERROR'}: ${error.message}`);
    process.exitCode = 1;
  }
}
