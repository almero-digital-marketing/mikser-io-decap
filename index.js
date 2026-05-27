import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

export default ({ runtime, onLoaded, onAfterRender, useLogger }) => {
    const config = runtime.config.decap ?? {}

    // Where the admin lives in the HTTP space. Default '/admin' to match
    // every Decap CMS tutorial ever written; users can override if they
    // want it somewhere else.
    const adminBase = config.base ?? '/admin'

    // Where decap-server's POST /api/v1 handler gets mounted. Sits
    // OUTSIDE /api so it doesn't squat on the api plugin's namespace.
    // Default '/decap' → endpoint becomes '/decap/api/v1'.
    const proxyBase = config.proxyBase ?? '/decap'

    // 'fs' (raw filesystem) or 'git' (commits per edit, editorial
    // workflow). Default 'fs' — simplest for solo dev.
    const mode = config.mode ?? 'fs'

    // User-provided Decap config — relative to workingFolder. Defaults
    // to 'decap.yml'. Served at <adminBase>/config.yml.
    const configYml = config.configYml ?? 'decap.yml'

    // Whether to also copy the admin bundle into outputFolder/admin/
    // during builds so static deployments include it. Default true
    // because Decap is designed to be deployed alongside the static
    // site with a git-backed backend.
    const copyToOut = config.copyToOut !== false

    onLoaded(async () => {
        const logger = useLogger()

        if (!runtime.options.app) {
            throw new Error(
                'Decap plugin requires runtime.options.app. ' +
                'Run mikser with --server, or pass app to setup({ app }).'
            )
        }

        // Resolve the decap-cms standalone bundle path via peerDep.
        let decapDistPath
        try {
            const decapPkgPath = require.resolve('decap-cms/package.json')
            decapDistPath = path.join(path.dirname(decapPkgPath), 'dist')
            await fs.access(path.join(decapDistPath, 'decap-cms.js'))
        } catch {
            throw new Error(
                'Decap plugin: cannot find decap-cms peer dependency. ' +
                'Install it with `npm install decap-cms`.'
            )
        }

        // Resolve the decap-server middleware. registerLocalFs /
        // registerLocalGit each attach a POST /api/v1 handler to a
        // given Express app — exactly what we need. The package's
        // built bundle is CJS, so the named exports come through the
        // default import.
        const { default: { registerLocalFs, registerLocalGit } } =
            await import('decap-server/dist/middlewares.js')

        // decap-server reads GIT_REPO_DIRECTORY from the environment
        // (no per-call override). Point it at the working folder before
        // registration. localFs uses the same env var as localGit.
        const workingFolder = path.resolve(runtime.options.workingFolder)
        process.env.GIT_REPO_DIRECTORY = workingFolder

        // Lazy-import express through the host app's prototype so we
        // get the same instance the engine created.
        const expressApp = runtime.options.app
        const express = expressApp.constructor.application ? null
            : (await import('express')).default
        if (!express) {
            throw new Error('Decap plugin: express not available')
        }

        // --- Proxy backend mounted on a sub-app under <proxyBase> ---
        // The sub-app gives us route isolation (cors / json / morgan
        // from registerCommonMiddlewares stay scoped). The endpoint
        // becomes <proxyBase>/api/v1.
        const proxyApp = express()
        if (mode === 'git') await registerLocalGit(proxyApp, { logLevel: 'info' })
        else if (mode === 'fs') await registerLocalFs(proxyApp, { logLevel: 'info' })
        else throw new Error(`Decap plugin: unknown mode '${mode}' (expected 'fs' or 'git')`)
        expressApp.use(proxyBase, proxyApp)

        // --- Admin UI at <adminBase> ---
        // Order matters:
        //   1. Our admin/index.html (the bootstrap loading decap-cms.js)
        //   2. The user's decap.yml served as config.yml
        //   3. The decap-cms standalone bundle (decap-cms.js + assets)
        expressApp.use(adminBase, express.static(path.join(here, 'admin')))

        const configYmlAbs = path.resolve(workingFolder, configYml)
        expressApp.get(`${adminBase}/config.yml`, async (req, res) => {
            try {
                const body = await fs.readFile(configYmlAbs, 'utf8')
                res.type('text/yaml').send(body)
            } catch (err) {
                logger.error('Decap config not found at %s', configYmlAbs)
                res.status(404).send(`# decap config not found at ${configYml}`)
            }
        })

        expressApp.use(adminBase, express.static(decapDistPath))

        logger.info('Decap admin mounted: %s (mode=%s, proxy=%s/api/v1, config=%s)',
            adminBase, mode, proxyBase, configYml)
    })

    onAfterRender(async () => {
        if (!copyToOut) return
        const logger = useLogger()

        const outAdmin = path.join(
            path.resolve(runtime.options.outputFolder),
            adminBase.replace(/^\//, '')
        )
        await fs.mkdir(outAdmin, { recursive: true })

        // Copy our admin bootstrap (index.html etc.)
        await fs.cp(path.join(here, 'admin'), outAdmin, { recursive: true })

        // Copy the user's decap config alongside the bootstrap. Decap
        // looks for ./config.yml relative to the admin HTML.
        const configYmlAbs = path.resolve(runtime.options.workingFolder, configYml)
        try {
            await fs.copyFile(configYmlAbs, path.join(outAdmin, 'config.yml'))
        } catch {
            logger.warn('Decap: no %s to copy into out/%s', configYml, adminBase)
        }

        // Copy decap-cms standalone bundle (decap-cms.js + maps + chunks)
        try {
            const decapPkgPath = require.resolve('decap-cms/package.json')
            const decapDistPath = path.join(path.dirname(decapPkgPath), 'dist')
            await fs.cp(decapDistPath, outAdmin, { recursive: true })
        } catch {
            logger.warn('Decap: peerDep decap-cms not installed, skipping bundle copy to out')
        }

        logger.info('Decap admin written: %s', outAdmin)
    })
}
