const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const sourceDirectories = [
  "web-extension",
  "scripts",
  "test",
  "macos/Video Flow Keys/Video Flow Keys/Resources"
];

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

const files = sourceDirectories.flatMap((directory) => filesIn(path.join(root, directory)));
let checked = 0;
for (const file of files.sort()) {
  const extension = path.extname(file);
  const command = [".js", ".cjs", ".mjs"].includes(extension)
    ? [process.execPath, "--check", file]
    : extension === ".sh" ? ["bash", "-n", file] : null;
  if (!command) continue;
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  checked += 1;
}
console.log(`Syntax checked ${checked} JavaScript and shell files.`);
