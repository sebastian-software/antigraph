import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'

/**
 * @typedef {{ filename: string }} PackedFile
 * @typedef {{ bin?: { antigraph?: string }, exports?: { ".": { import?: string } } }} PackedPackageJson
 */

const repoRoot = path.resolve(import.meta.dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigraph-pack-'))
const npmEnv = {
  ...process.env,
  npm_config_audit: 'false',
  npm_config_cache: path.join(tempRoot, '.npm-cache'),
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false'
}
delete npmEnv.npm_config__jsr_registry
delete npmEnv.npm_config_enable_pre_post_scripts
delete npmEnv.npm_config_minimum_release_age
delete npmEnv.npm_config_store_dir
delete npmEnv.npm_config_verify_deps_before_run

try {
  execFileSync('pnpm', ['build'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })

  const packInfo = /** @type {PackedFile[]} */ (
    JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', tempRoot],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: npmEnv
        }
      )
    )
  )
  const tarballName = packInfo[0]?.filename
  if (tarballName === undefined || tarballName === '') {
    throw new Error('npm pack did not return a tarball filename')
  }

  const tarballPath = path.join(tempRoot, tarballName)
  await tar.x({ cwd: tempRoot, file: tarballPath })

  const packageRoot = path.join(tempRoot, 'package')
  const packageJson = /** @type {PackedPackageJson} */ (
    JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  )
  if (packageJson.bin?.antigraph !== './dist/cli.js') {
    throw new Error('packed package has unexpected bin.antigraph')
  }
  if (packageJson.exports?.['.']?.import !== './dist/public-api.js') {
    throw new Error('packed package has unexpected exports["."].import')
  }

  const cliPath = path.join(packageRoot, 'dist', 'cli.js')
  const cliMode = fs.statSync(cliPath).mode
  if ((cliMode & 0o111) === 0) {
    throw new Error('packed dist/cli.js is not executable')
  }

  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    path.join(packageRoot, 'node_modules'),
    'dir'
  )
  fs.mkdirSync(path.join(tempRoot, 'node_modules'))
  fs.symlinkSync(
    packageRoot,
    path.join(tempRoot, 'node_modules', 'antigraph'),
    'dir'
  )

  execFileSync(process.execPath, [cliPath, '--help'])

  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "const api = await import('antigraph')",
        "if (typeof api.runExtract !== 'function') throw new Error('missing runExtract export')",
        "if (typeof api.runTranscribe !== 'function') throw new Error('missing runTranscribe export')"
      ].join('\n')
    ],
    {
      cwd: tempRoot,
      stdio: 'inherit'
    }
  )

  console.log(`Packed and smoke-tested ${tarballName}`)
} finally {
  if (process.env.KEEP_ANTIGRAPH_PACK_SMOKE !== '1') {
    fs.rmSync(tempRoot, { force: true, recursive: true })
  }
}
