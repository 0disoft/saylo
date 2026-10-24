# Saylo Support

This document describes where to send general questions, feature requests, and bug reports for Saylo, and what information helps. For security issues, see [SECURITY.md](SECURITY.md).

## Contact

- Email: <mailto:rodisoft1@gmail.com> — the contact listed on the maintainer's (0disoft's) [public GitHub profile](https://github.com/0disoft).
- Subject format: `Saylo · <package> <version> · <one-line summary>`
- Profile: <https://github.com/0disoft>

An example subject is `Saylo · @0disoft/saylo-vite 0.1.0-alpha.4 · screen does not update after saving copy`. Including `Saylo` plus the package and version in the subject keeps the message from being mixed up with mail from other repositories.

The `bugs` field in the existing published alpha.4 points to GitHub issues that return 404 on external access (confirmed 2026-10-11). In the local source, `bugs.email` for all five packages now points to the address above. This document and the metadata changes have not yet been published to npm.

## What to send

Whatever the type of request, include the following. You can leave out items you do not know.

- Package and version: which of `@0disoft/saylo-core`, `saylo-react`, `saylo-svelte`, `saylo-vite`, or `saylo-typegen`, and the version (for example `0.1.0-alpha.4`).
- Environment: OS, Node version, framework and version (React, Svelte, and so on), Vite version, and whether you use TypeScript.
- Actual behavior and expected behavior.
- Minimal reproduction: the relevant catalog JSON fragment, configuration, and commands you ran.

## Minimal reproduction

- Use a synthetic catalog that keeps only the structure instead of real service copy. Rename keys to generic names such as `demo`.
- For an example, refer to the format in the cause reproduction section of the [support diagnostic report](docs/support-report.md).
- Do not send secrets (tokens, keys, cookies), real user input, or personal data.

## Diagnostic data (optional)

- Diagnostic JSON is not required. Sending the information above first is enough.
- If you have a report made with `createSupportRecorder` from the current checkout or from the `0.1.0-alpha.5` candidate tarball, you may attach it. The current npm release `0.1.0-alpha.4` does not have this API. The candidate has not been published yet, and support does not require installing or using it.
- The format and collection scope are described in the [support diagnostic report](docs/support-report.md). Before attaching anything, check that document to see what is included.

## Install tag

The published version is `0.1.0-alpha.4` and the dist-tag is `alpha`. The `latest` tag points to a registration placeholder rather than an actual package release. Install with `@alpha`. Check the installed version in `package.json` or with `npm ls`.
