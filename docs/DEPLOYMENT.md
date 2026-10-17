# Static hosting and GitHub publication

## Build for your address

```sh
npm ci
npm run build
```

Serve `dist/` on HTTPS. For a GitHub Pages project URL such as `https://OWNER.github.io/tour-de-home/`, build with:

```sh
npm run build -- --base=/tour-de-home/
```

Use your actual repository name as the base path, including both slashes. Test with `npm run preview`; import, sample routes, scenic assets, and notices use the same base path. For the standard `/tour-de-home/` test path, `npm run test:release-browser` validates actual requests and export downloads. Root-domain deployments use the default build.

There is no automatic deployment workflow. Configure your host to publish `dist/` after its required checks. Web Bluetooth pairing requires a secure context and a user click. Hosting does not transfer IndexedDB history from localhost or another origin; finish and export rides at their original address first.

## Publish the prepared source

Publish only reviewed source snapshots. The preparation command excludes Git history, local settings, personal activity data, logs, and development archives. It refuses to overwrite an existing output. Review the manifest before sharing.

This public repository has a fresh project-authored history. For future updates, keep source changes scoped, run the checks in the README, and preserve upstream license notices. Private vulnerability reporting is enabled on GitHub.
