# Security Policy

Report Saylo security issues by private email, not through public issues. For general questions, feature requests, and ordinary bug reports, see [SUPPORT.md](SUPPORT.md).

## Contact

- Email: <mailto:rodisoft1@gmail.com>
- Subject format: `Saylo security · <package> <version> · <one-line summary>`
- Profile: <https://github.com/0disoft>

The repository is public. Use the private email address above for security reports so sensitive details do not appear in public issues. This policy and the email contact metadata are included in alpha.5.

## What to include

- Affected package and version: which of `@0disoft/saylo-core`, `saylo-react`, `saylo-svelte`, `saylo-vite`, or `saylo-typegen`.
- Environment: OS, Node version, Vite version, framework and browser versions.
- Reachability and impact: which input, configuration, or call leads to which result.
- Minimal reproduction: a procedure reduced with synthetic catalogs and configuration.

Do not send credentials, API keys, session cookies, real users' translation strings, or personal input. If reproducing the issue seems to require such values, replace them with synthetic values that keep the same shape.

## Scope

Saylo is a JavaScript and TypeScript i18n library made of five packages.

| Package | Role |
| --- | --- |
| `@0disoft/saylo-core` | Catalog parsing and validation, translation and formatting, immutable store |
| `@0disoft/saylo-vite` | Vite development plugin, production build transforms, SSR boot, development connection |
| `@0disoft/saylo-react` | React context and snapshot-bound hook |
| `@0disoft/saylo-svelte` | Svelte 5 adapter |
| `@0disoft/saylo-typegen` | CLI and worker that generate type declarations from the base schema |

## Inputs and exposure boundaries

- Catalogs and messages are read from the locale and namespace paths the app specifies. The locale and namespace allowlist and path validation form the boundary that keeps files outside that scope from being read. If a path can bypass this boundary, report it with a reproduction.
- Message values are strings, and Saylo does not inject arbitrary HTML or code automatically. Escaping is left to the framework you use.
- Development paths (file watching, custom events, websocket) are for the development server only; production builds do not open a persistent channel.
- SSR boot data placed in HTML can be read in the browser. Do not put secrets in it. For issues at the serialization or HTML insertion boundary, report the adapter and insertion method you use.
- Saylo packages have no accounts, remote upload, or server of their own. The app decides where catalogs are read from and what is exposed.

## How risk is assessed

Assessment is based on reachability and impact. The same code can expose different things depending on how it is attached to an app, so include both the reproduction steps and the impact scope. Reports about catalog or message input, SSR boot, or the Vite development plugin are faster to confirm if you point to that path.
