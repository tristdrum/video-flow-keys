const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "web-extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(manifest.manifest_version, 3, "Safari wrapper expects Manifest V3");
assert.equal(manifest.version, packageInfo.version, "Package and extension versions must match");
assert.ok(manifest.name && manifest.description, "Manifest needs a name and description");
assert.ok(Array.isArray(manifest.permissions), "Manifest permissions must be an array");
assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length,
  "Manifest must register content scripts");

const resources = new Set([
  "manifest.json",
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.background?.scripts || []),
  manifest.background?.service_worker
].filter(Boolean));
for (const registration of manifest.content_scripts) {
  assert.ok(Array.isArray(registration.matches) && registration.matches.length,
    "Each content script needs match patterns");
  for (const resource of [...(registration.js || []), ...(registration.css || [])]) {
    resources.add(resource);
  }
}
for (const registration of manifest.web_accessible_resources || []) {
  for (const resource of registration.resources || []) resources.add(resource);
}
for (const resource of resources) {
  assert.equal(typeof resource, "string", "Resource paths must be strings");
  assert.ok(!resource.includes("*") && !resource.includes("?"),
    `List packaged resources explicitly: ${resource}`);
  const resolved = path.resolve(extensionRoot, resource);
  assert.ok(resolved.startsWith(`${extensionRoot}${path.sep}`),
    `Resource must stay inside web-extension: ${resource}`);
  assert.ok(fs.statSync(resolved).isFile(), `Missing packaged resource: ${resource}`);
}

// Xcode keeps explicit resource references. A file can exist in the mirrored
// directory yet be absent from the built extension if its build-phase entry is
// missing. Follow IDs in this project's pbxproj rather than matching comments.
const project = fs.readFileSync(path.join(root,
  "macos/Video Flow Keys/Video Flow Keys.xcodeproj/project.pbxproj"), "utf8");
const objects = new Map([...project.matchAll(
  /^\t\t([A-F0-9]{24})[^\n]* = \{\n([\s\S]*?)^\t\t\};/gm
)].map((match) => [match[1], match[2]]));
const target = [...objects.values()].find((body) =>
  /\bisa = PBXNativeTarget;/.test(body) && /\bname = "Video Flow Keys Extension";/.test(body));
assert.ok(target, "Cannot find the Xcode extension target");
const phases = target.match(/buildPhases = \(([\s\S]*?)\);/)?.[1] || "";
const resourcePhase = [...phases.matchAll(/\b([A-F0-9]{24})\b/g)]
  .map((match) => objects.get(match[1]))
  .find((body) => body && /\bisa = PBXResourcesBuildPhase;/.test(body));
assert.ok(resourcePhase, "Cannot find the extension's Xcode Resources build phase");
const buildReferences = new Map([...project.matchAll(
  /^\s*([A-F0-9]{24})[^\n]* = \{isa = PBXBuildFile; fileRef = ([A-F0-9]{24})\b/gm
)].map((match) => [match[1], match[2]]));
const fileReferences = new Map([...project.matchAll(
  /^\s*([A-F0-9]{24})[^\n]* = \{isa = PBXFileReference;([^\n]+)\};/gm
)].map((match) => [match[1], match[2]]));
const packaged = [...resourcePhase.matchAll(/\b([A-F0-9]{24})\b/g)].flatMap((match) => {
  const reference = fileReferences.get(buildReferences.get(match[1])) || "";
  const resourcePath = reference.match(/\bpath = (?:"([^"]+)"|([^;\s]+));/);
  const name = resourcePath?.[1] || resourcePath?.[2] || "";
  return name.startsWith("Resources/") ? [{
    name: name.slice("Resources/".length),
    folder: /\b(?:lastKnownFileType|explicitFileType) = folder;/.test(reference)
  }] : [];
});
// Top-level popup assets and the bundled license notice also need membership,
// even though the manifest only refers to popup.html directly.
const requiredResources = new Set([...resources, ...fs.readdirSync(extensionRoot)
  .filter((name) => fs.statSync(path.join(extensionRoot, name)).isFile())]);
for (const resource of requiredResources) {
  assert.ok(packaged.some((entry) => entry.name === resource ||
    (entry.folder && resource.startsWith(`${entry.name}/`))),
  `Missing from the extension's Xcode Resources build phase: ${resource}`);
}
console.log(`Manifest ${manifest.version} is valid; ${requiredResources.size} resources exist and are included in Xcode.`);
