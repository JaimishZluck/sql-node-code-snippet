/**
 * Tiny helpers shared by every lesson file.
 *
 * Deliberately minimal: the ONLY things hidden here are connecting before
 * the lesson and disconnecting after it, plus some console formatting.
 * All actual MongoDB/Mongoose behavior stays visible inside each lesson.
 */
import util from "util";
import connectDB, { disconnectDB } from "../../db/loader.db.js";

/**
 * Run one lesson: open the shared connection, execute the lesson function,
 * then close the connection so the Node.js process can exit.
 *
 * (Without the disconnect, the open connection pool keeps the event loop
 * alive and the script would hang forever after printing its output.)
 */
export async function runLesson(title, lessonFn) {
  console.log(`\n${"#".repeat(70)}\n# LESSON: ${title}\n${"#".repeat(70)}`);
  try {
    await connectDB();
    await lessonFn();
  } catch (error) {
    console.error(`\n[lesson failed] ${error.message}`);
    if (error.stack) console.error(error.stack.split("\n").slice(1, 4).join("\n"));
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}

/** Print a visible section header, so lesson output reads like chapters. */
export function section(title) {
  console.log(`\n${"=".repeat(70)}\n  ${title}\n${"=".repeat(70)}`);
}

/** Print a label + any value (objects expanded to full depth, in color). */
export function show(label, value) {
  console.log(`\n--- ${label}`);
  console.log(util.inspect(value, { depth: 6, colors: true, maxArrayLength: 20 }));
}

/** Print an explanatory note between operations. */
export function note(text) {
  console.log(`\n  [note] ${text}`);
}
