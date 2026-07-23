#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templateRoot = path.resolve(__dirname, "..");

const SKIP_NAMES = new Set([
  ".git",
  ".vscode",
  ".npmignore",
  ".env",
  "bin",
  "logs",
  "node_modules",
  "package-lock.json",
]);

const sanitizePackageName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "anv-backend-service";

const isTargetDirectoryEmpty = async (dir) => {
  const entries = await fs.readdir(dir);
  return entries.length === 0;
};

const ensureTargetDirectory = async (dir) => {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${dir}`);
    }

    if (!(await isTargetDirectoryEmpty(dir))) {
      throw new Error(`Target directory is not empty: ${dir}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(dir, { recursive: true });
      return;
    }

    throw error;
  }
};

const copyTemplate = async (sourceDir, destinationDir) => {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyTemplate(sourcePath, destinationPath);
      continue;
    }

    await fs.copyFile(sourcePath, destinationPath);
  }
};

const customizePackageJson = async (targetDir) => {
  const packageJsonPath = path.join(targetDir, "package.json");
  const packageRaw = await fs.readFile(packageJsonPath, "utf8");
  const packageData = JSON.parse(packageRaw);
  const projectFolderName = path.basename(targetDir);

  packageData.name = sanitizePackageName(projectFolderName);
  delete packageData.bin;
  delete packageData.files;
  if (packageData.scripts) {
    delete packageData.scripts.create;
  }

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageData, null, 2)}\n`);
};

const run = async () => {
  const targetArg = process.argv[2] || "anv-backend-service";
  const targetDir = path.resolve(process.cwd(), targetArg);

  await ensureTargetDirectory(targetDir);
  await copyTemplate(templateRoot, targetDir);
  await customizePackageJson(targetDir);

  console.log(`\nProject created at: ${targetDir}`);
  console.log("Next steps:");
  console.log(`  cd ${targetArg}`);
  console.log("  npm install");
  console.log("  npm run dev:simple\n");
};

run().catch((error) => {
  console.error(`\nFailed to create project: ${error.message}\n`);
  process.exit(1);
});
