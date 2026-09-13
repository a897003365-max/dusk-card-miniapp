"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.env.PACKAGE_AUDIT_ROOT || path.join(__dirname, ".."));
const LIMIT_BYTES = 2 * 1024 * 1024;
const RECOMMENDED_BYTES = Math.floor(1.7 * 1024 * 1024);
const WARNING_BYTES = Math.floor(1.75 * 1024 * 1024);
const FAIL_BYTES = Math.floor(1.9 * 1024 * 1024);
const IMAGE_RE = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const CODE_RE = /\.(?:js|wxml|wxss)$/i;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function portable(value) {
  return String(value || "").split(path.sep).join("/").replace(/^\.\//, "").replace(/\/$/, "");
}

function makeIgnore(project) {
  const configured = (project.packOptions && project.packOptions.ignore) || [];
  return (relativePath) => {
    const relative = portable(relativePath);
    const name = path.posix.basename(relative);
    if (relative === ".git" || relative.startsWith(".git/") || relative === "node_modules" || relative.startsWith("node_modules/")) return true;
    if (name === ".DS_Store" || relative === "project.private.config.json") return true;
    return configured.some((entry) => {
      const value = portable(entry.value);
      if (entry.type === "folder") return relative === value || relative.startsWith(`${value}/`);
      if (entry.type === "file") return relative === value;
      if (entry.type === "suffix") return relative.endsWith(value);
      if (entry.type === "prefix") return relative.startsWith(value);
      return false;
    });
  };
}

function collectFiles(rootPath, rootName, subpackageRoots, ignored) {
  const files = [];
  function walk(absoluteDir, relativeDir) {
    fs.readdirSync(absoluteDir, { withFileTypes: true }).forEach((entry) => {
      const relativePath = portable(path.join(relativeDir, entry.name));
      if (ignored(relativePath)) return;
      if (!rootName && subpackageRoots.some((subpackage) => relativePath === subpackage || relativePath.startsWith(`${subpackage}/`))) return;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else files.push({ path: relativePath, bytes: fs.statSync(absolutePath).size });
    });
  }
  walk(rootPath, rootName);
  return files;
}

function packageStatus(bytes) {
  if (bytes >= LIMIT_BYTES) return "ABSOLUTE_FAIL";
  if (bytes >= FAIL_BYTES) return "FAIL";
  if (bytes >= WARNING_BYTES) return "WARNING";
  if (bytes > RECOMMENDED_BYTES) return "NOTICE";
  return "PASS";
}

function scanPackages() {
  const app = readJson("app.json");
  const project = readJson("project.config.json");
  const subpackageRoots = (app.subPackages || []).map((item) => portable(item.root));
  const ignored = makeIgnore(project);
  const definitions = [{ name: "main", root: "" }].concat(subpackageRoots.map((root) => ({ name: root, root })));
  return definitions.map((definition) => {
    const absoluteRoot = definition.root ? path.join(ROOT, definition.root) : ROOT;
    const files = collectFiles(absoluteRoot, definition.root, subpackageRoots, ignored);
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    return {
      ...definition,
      bytes,
      mib: bytes / 1024 / 1024,
      remainingBytes: LIMIT_BYTES - bytes,
      imageBytes: files.filter((file) => IMAGE_RE.test(file.path)).reduce((sum, file) => sum + file.bytes, 0),
      codeBytes: files.filter((file) => CODE_RE.test(file.path)).reduce((sum, file) => sum + file.bytes, 0),
      status: packageStatus(bytes),
      files: files.sort((left, right) => right.bytes - left.bytes),
    };
  });
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString("en-US")} bytes`;
}

function printReport(packages) {
  packages.forEach((item) => {
    console.log(`\n${item.name}  ${formatBytes(item.bytes)}  ${item.mib.toFixed(3)} MiB  ${item.status}`);
    console.log(`  距 2 MiB：${formatBytes(item.remainingBytes)}  图片：${formatBytes(item.imageBytes)}  JS/WXML/WXSS：${formatBytes(item.codeBytes)}`);
    console.log("  最大文件：");
    item.files.slice(0, 20).forEach((file) => console.log(`    ${String(file.bytes).padStart(8)}  ${file.path}`));
  });
}

if (require.main === module) {
  const packages = scanPackages();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(packages.map(({ files, ...item }) => ({ ...item, largestFiles: files.slice(0, 20) })), null, 2));
  } else {
    printReport(packages);
  }
  if (packages.some((item) => ["FAIL", "ABSOLUTE_FAIL"].includes(item.status))) process.exitCode = 1;
}

module.exports = {
  ROOT,
  LIMIT_BYTES,
  RECOMMENDED_BYTES,
  WARNING_BYTES,
  FAIL_BYTES,
  scanPackages,
  formatBytes,
  packageStatus,
};
