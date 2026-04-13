import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { extname, join, relative } from "path";

interface UiAssetRecord {
  contentType: string;
  body: string;
  encoding: "base64";
}

const root = process.cwd();
const distDir = join(root, "ui", "dist");
const outputFile = join(root, "src", "ui", "generated.ts");

function walk(dir: string): string[] {
  const entries = readdirSync(dir).sort();
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

const files = walk(distDir);
if (files.length === 0) {
  throw new Error(`No UI build artifacts found in ${distDir}`);
}

const assets: Record<string, UiAssetRecord> = {};
for (const filePath of files) {
  const pathname = `/${relative(distDir, filePath).replaceAll("\\", "/")}`;
  assets[pathname] = {
    contentType: contentTypeFor(filePath),
    body: readFileSync(filePath).toString("base64"),
    encoding: "base64",
  };
}

const fileBody = `export interface UiAsset {
  contentType: string;
  body: string;
  encoding: "base64";
}

export const UI_ENTRY_PATH = "/index.html";

export const UI_ASSETS: Record<string, UiAsset> = ${JSON.stringify(assets, null, 2)};\n`;

writeFileSync(outputFile, fileBody, "utf-8");
console.log(`Generated ${relative(root, outputFile)} from ${files.length} UI asset(s).`);
