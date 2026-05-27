# mikser-io-decap

Mount [Decap CMS](https://decapcms.org/) inside the [mikser-io](https://github.com/almero-digital-marketing/mikser-io) Express server. One process, one port, one command — the admin runs alongside mikser's watcher so edits are picked up and rebuilt on save.

This plugin is a thin host. You write your own `decap.yml`; the plugin serves the admin UI, mounts Decap's local-fs/git proxy backend, and (optionally) copies the admin bundle into the build output for static deployment.

## Install

```bash
npm install mikser-io-decap decap-cms
```

`decap-cms` is a peer dependency — the standalone JS bundle that ships the admin UI.

## Configure

```js
// mikser.config.js
export default {
  plugins: ['documents', 'layouts', 'render-hbs', 'decap'],

  decap: {
    base: '/admin',           // admin URL path; default '/admin'
    proxyBase: '/decap',      // backend mount; default '/decap' → POST /decap/api/v1
    mode: 'fs',               // 'fs' (raw filesystem) or 'git' (commits per edit)
    configYml: 'decap.yml',   // user's Decap config, relative to working folder
    copyToOut: true,          // copy admin into out/<base>/ on build; default true
  },
}
```

Then write your `decap.yml` in the working folder:

```yaml
# decap.yml — points Decap at mikser's folders
backend:
  name: proxy
  proxy_url: http://localhost:3001/decap/api/v1
  branch: main

media_folder: files
public_folder: /files

collections:
  - name: documents
    label: Documents
    folder: documents/en
    create: true
    fields:
      - { name: title, label: Title, widget: string }
      - { name: layout, label: Layout, widget: string }
      - { name: date, label: Date, widget: datetime, required: false }
      - { name: body, label: Body, widget: markdown }
```

## Run

```bash
npx mikser-io --server --watch
```

Open `http://localhost:3001/admin/`. Decap loads, talks to `/decap/api/v1` for reads/writes, and edits land directly in your `documents/` folder. The watcher catches them and rebuilds.

## Modes

**`fs`** (default) — Decap writes/reads files directly. No git. Best for solo dev and quick iteration.

**`git`** — Decap performs a `git add` + `git commit` for each save, with branches per draft when [editorial workflow](https://decapcms.org/docs/configuration-options/#publish-mode) is enabled. Requires the working folder to be a git repo.

Both modes are implemented by `decap-server` — this plugin just mounts the appropriate middleware on a sub-app under `proxyBase`.

## Production deployment

When you run `mikser` (no `--server`), the admin gets baked into `out/<base>/`:

```
out/
  admin/
    index.html
    decap-cms.js
    config.yml
    ...
```

For the deployed admin to work, switch the backend in `decap.yml` away from `proxy` (which only exists locally) to `git-gateway` or `github`:

```yaml
backend:
  name: git-gateway     # via Netlify Identity
  # or:
  # name: github
  # repo: org/repo
  # branch: main
```

Set `copyToOut: false` if you don't want the admin in your public deploy (e.g., you host it on a separate, password-protected URL).

## Notes

- This plugin requires `runtime.options.app`. Run mikser with `--server` for local use, or pass `app` to `setup({ app })` programmatically.
- The proxy backend (`mode: 'fs'` / `mode: 'git'`) only works locally — production must use a remote backend (git-gateway, github, gitlab).
- `decap-server` reads its working directory from `GIT_REPO_DIRECTORY`. The plugin sets this to mikser's `workingFolder` before registering.
- `decap-server` adds cors, morgan logging, and a 50 MB JSON body limit (for base64-encoded media uploads) scoped to the proxy sub-app — none of that leaks into mikser's main Express app.

## License

MIT
