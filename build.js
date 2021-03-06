import fs from "fs"
import path from "path"
import util from "util"

import React from "react"
import ReactDOM from "react-dom/server"
import { Helmet } from "react-helmet"
import fastGlob from "fast-glob"
import ora from "ora"
import chalk from "chalk"
import chokidar from "chokidar"
import rimraf from "rimraf"
import postcss from "postcss"
import tailwindcss from "tailwindcss"
import autoprefixer from "autoprefixer"
import cssnano from "cssnano"

const readFile = util.promisify(fs.readFile)
const writeFile = util.promisify(fs.writeFile)
const copyFile = util.promisify(fs.copyFile)
const mkdir = util.promisify(fs.mkdir)
const rmrf = util.promisify(rimraf)
const stat = util.promisify(fs.stat)

const WATCH_MODE = process.argv.includes("--watch")
const SITE_ROOT = path.join(__dirname, "site")
const LIB_ROOT = path.join(__dirname, "lib")
const DIST_ROOT = path.join(__dirname, "dist")
const GLOB = path.join(SITE_ROOT, "**", "*")
const LIB_GLOB = path.join(LIB_ROOT, "**", "*.js")
const EXTENSION_MAP = {
  ".js": ".html",
}

async function spin(text, fn) {
  const spinner = ora(text).start()

  try {
    await fn(spinner)
    spinner.succeed()
  } catch (err) {
    spinner.fail()
    console.error(err)
    throw err
  }
}

function distRelative(path) {
  return path.replace(DIST_ROOT, "").slice(1)
}

function replaceExt(pathname) {
  const prevExt = path.extname(pathname)
  const newExt = EXTENSION_MAP[prevExt] || prevExt
  const dirname = path.dirname(pathname)
  const basename = path.basename(pathname, prevExt) + newExt

  return path.join(dirname, basename)
}

async function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    await spin(`mkdir /${distRelative(dir)}`, async () => {
      await mkdir(dir, { recursive: true })
    })
  }
}

async function updateSpinnerWithFileSize(file, spinner) {
  const stats = await stat(file)
  const size =
    stats.size < 1024
      ? `${stats.size}b`
      : `${~~((stats.size / 1024) * 100) / 100}kb`
  spinner.text += chalk.cyan(` ${size}`)
}

function expandScripts(markup) {
  return markup.replace(/SCRIPT\[([^\]]+)\]/g, (_, b64) =>
    Buffer.from(b64, "base64").toString()
  )
}

function removeFromCache(moduleId) {
  const cached = require.cache[moduleId]

  if (!cached) {
    return
  }

  const ownModule = (mod) =>
    mod.path.startsWith(LIB_ROOT) || mod.path.startsWith(SITE_ROOT)

  cached.children.filter(ownModule).forEach((mod) => removeFromCache(mod.id))
  delete require.cache[moduleId]
}

async function renderPage(source, destination) {
  removeFromCache(require.resolve(source))
  const Page = require(source).default
  const markup = expandScripts(ReactDOM.renderToStaticMarkup(<Page />))
  const helmet = Helmet.renderStatic()
  const html = pageTemplate(helmet, markup)
  await writeFile(destination, html)
}

function pageTemplate(helmet, markup) {
  return `<!doctype html>
<html ${helmet.htmlAttributes.toString()}>
  <head>
    ${helmet.title.toString()}
    ${helmet.meta.toString()}
    ${helmet.link.toString()}
  </head>
  <body ${helmet.bodyAttributes.toString()}>
    ${markup}
    ${helmet.script.toString()}
  </body>
</html>`.replace(/ data-react-helmet="true"/g, "")
}

async function renderCSS(source, destination) {
  const css = await readFile(source)
  const processed = await postcss(
    [
      tailwindcss,
      autoprefixer,
      !WATCH_MODE && cssnano({ preset: "default" }),
    ].filter(Boolean)
  ).process(css, {
    from: source,
    to: destination,
  })
  await writeFile(destination, processed.css)
  if (processed.map) {
    await writeFile(`${destination}.map`, processed.map)
  }
}

const HANDLERS = {
  ".js": renderPage,
  ".css": renderCSS,
}

async function build(source, rebuildDeps = false) {
  if (path.basename(path.dirname(source)) === "_partials") {
    if (rebuildDeps) {
      await fullBuild({ onlyPages: true })
    }
    return
  }
  const destination = replaceExt(source.replace(SITE_ROOT, DIST_ROOT))
  await ensureDirectory(path.dirname(destination))
  await spin(distRelative(destination), async (spinner) => {
    const handler = HANDLERS[path.extname(source)] || copyFile
    await handler(source, destination)
    await updateSpinnerWithFileSize(destination, spinner)
  })
}

async function fullBuild(options = {}) {
  const sources = await fastGlob([GLOB])
  for (const source of sources) {
    if (options.onlyPages && !source.endsWith(".js")) {
      continue
    }
    await build(source)
  }
}

void (async () => {
  try {
    await rmrf(path.join(DIST_ROOT, "*"))
    await ensureDirectory(DIST_ROOT)
    await fullBuild()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }

  if (WATCH_MODE) {
    const watcher = chokidar.watch(GLOB, { ignoreInitial: true })
    const libWatcher = chokidar.watch(LIB_GLOB, { ignoreInitial: true })

    watcher.on("add", async (source) => await build(source))
    watcher.on("change", async (source) => await build(source, true))
    watcher.on("unlink", async (source) => {
      const destination = replaceExt(source.replace(SITE_ROOT, DIST_ROOT))
      await spin(
        `${chalk.red("rm")} ${distRelative(destination)}`,
        async () => await rmrf(destination)
      )
    })

    libWatcher.on("add", async () => await fullBuild())
    libWatcher.on("change", async () => await fullBuild())
  }
})()
