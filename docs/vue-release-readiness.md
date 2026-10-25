# Vue package release readiness

The Vue 3 adapter is still private and excluded from the five-package public release pipeline. No version or publication status is changed by this work. The package records public access and provenance defaults for a future authorized publication.

Run `npm run verify:pack:vue` for local readiness. It builds core and Vue, packs both, installs the actual tarballs into an independent app, checks JS/TypeScript consumers, and renders concurrent request-local SSR trees and escaped rich text. This passed on 2026-10-25 against the current checkout. It is package verification, not a registry publication or registry-consumer verification.

Before the first public release, intentionally select the release version and include Vue in release-candidate source promotion, approved manifests, the publisher allowlist and registry verification together. Only then remove `private`. Leaving the current allowlist and private guard intact prevents an ordinary five-package release from publishing Vue accidentally. Do not treat `publishConfig` or a successful tarball check as permission to publish.
