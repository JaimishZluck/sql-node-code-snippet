/**
 * Lesson launcher.
 *
 *   npm run lesson                  -> list every available lesson
 *   npm run lesson 04-crud          -> list the files in one module
 *   npm run lesson 04-crud/01      -> run the first matching lesson file
 *   npm run lesson 01               -> run/list by module number prefix
 *
 * It simply finds the matching .js file under src/bootcamp/lessons and
 * imports it — each lesson file runs itself on import (top-level
 * runLesson(...) call), connecting and disconnecting on its own.
 */
import { readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(__dirname, "lessons");

/** Collect every lesson file as "module-folder/file.js" relative paths. */
const collectLessons = () => {
  const lessons = [];
  for (const moduleDir of readdirSync(LESSONS_DIR).sort()) {
    const modulePath = path.join(LESSONS_DIR, moduleDir);
    if (!statSync(modulePath).isDirectory()) continue;
    for (const file of readdirSync(modulePath).sort()) {
      if (file.endsWith(".js")) lessons.push(`${moduleDir}/${file}`);
    }
  }
  return lessons;
};

const printList = (lessons, heading) => {
  console.log(`\n${heading}\n`);
  let currentModule = "";
  for (const lesson of lessons) {
    const [moduleDir, file] = lesson.split("/");
    if (moduleDir !== currentModule) {
      currentModule = moduleDir;
      console.log(`  ${moduleDir}/  (README.md explains the topic)`);
    }
    console.log(`      npm run lesson ${moduleDir}/${file.replace(/\.js$/, "")}`);
  }
  console.log("");
};

const run = async () => {
  const lessons = collectLessons();
  const query = (process.argv[2] || "").replace(/\\/g, "/").replace(/\.js$/, "");

  if (!query) {
    printList(lessons, "Available lessons (pick one):");
    return;
  }

  // Match by prefix on "module/file" (so "04", "04-crud", and
  // "04-crud/01" all work).
  const matches = lessons.filter((lesson) => lesson.startsWith(query));

  if (matches.length === 0) {
    printList(lessons, `No lesson matches "${query}". Available lessons:`);
    process.exitCode = 1;
    return;
  }

  // A whole module matched — if it contains several files, list them
  // instead of running all of them at once.
  if (matches.length > 1) {
    printList(matches, `"${query}" matches ${matches.length} lessons — pick one:`);
    return;
  }

  const file = path.join(LESSONS_DIR, matches[0]);
  console.log(`Running lesson: ${matches[0]}`);
  await import(pathToFileURL(file).href);
};

await run();
