#!/usr/bin/env node
/**
 * build.js — Inlines all JS and CSS into a single docs/index.html for deployment.
 * Usage: node build.js
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const DOCS = path.join(__dirname, "docs");

if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });

let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

// Inline CSS
const cssPath = path.join(SRC, "css", "style.css");
if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, "utf8");
    html = html.replace(
        /<link\s+rel="stylesheet"\s+href="css\/style\.css"\s*\/?>/,
        "<style>\n" + css + "\n</style>"
    );
}

// Inline JS in order
const jsFiles = ["constants.js", "deviceCache.js", "dataService.js", "charts.js", "main.js"];
jsFiles.forEach(function (filename) {
    const jsPath = path.join(SRC, "js", filename);
    if (fs.existsSync(jsPath)) {
        const js = fs.readFileSync(jsPath, "utf8");
        const regex = new RegExp('<script\\s+src="js/' + filename.replace(".", "\\.") + '"\\s*><\\/script>');
        html = html.replace(regex, "<script>\n" + js + "\n</script>");
    } else {
        console.warn("WARNING: Missing JS file:", filename);
    }
});

// Copy config.json to docs/
fs.copyFileSync(path.join(__dirname, "config.json"), path.join(DOCS, "config.json"));

// Copy icon
const imagesDir = path.join(DOCS, "images");
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
const iconSrc = path.join(SRC, "images", "icon.svg");
if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(imagesDir, "icon.svg"));

fs.writeFileSync(path.join(DOCS, "index.html"), html, "utf8");

const kb = Math.round(fs.statSync(path.join(DOCS, "index.html")).size / 1024);
console.log("✓ Build complete: docs/index.html (" + kb + " KB)");
