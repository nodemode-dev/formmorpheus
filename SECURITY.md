# Security policy

## Supported versions

Security fixes go into the newest release. Please update before reporting, and check whether the problem is still there.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Use GitHub's private reporting instead: on the repository's **Security** tab, choose **Report a vulnerability**. Include what you found, the steps to reproduce it, the version and platform, and what someone could do with it.

You can expect an acknowledgement within a week. We will keep you informed while it is fixed and credit you in the release notes, unless you would rather not be named.

## How FormMorpheus is guarded today

FormMorpheus runs on your own computer. Its window shows a page served by a local engine program, and these are the boundaries that matter:

- **The engine listens on 127.0.0.1 only.** Every way of starting it binds the loopback address; nothing reachable from another machine is opened unless you turn on Pen Link.
- **Host and Origin.** The engine answers only requests addressed to a loopback host and refuses requests that come from a page on another origin.
- **The window key.** Each launch makes a random key. The desktop app hands it to its own window only; started from source, the first page to ask claims it. Every request under `/api/` must carry it, and a socket needs a one-use ticket bought with it. Another program on the same computer, or a second browser tab, cannot read or change your library through the engine.
- **The page policy.** The engine serves the page with a Content Security Policy: scripts only from the app itself and its own inline scripts by hash, no plug-ins, no framing, no form posts elsewhere, no referrer. The desktop window has no web inspector in a release build, and its permissions are given to its own origin only.
- **Outside agents.** The MCP server at `/mcp` is for programs on this computer. Off by default: a change asks you in the window first (Ask), and Blocked refuses every request. Exports and imports always ask. An agent never reads files outside FormMorpheus's own data, and an import takes only a file already in the library folder. The choice is sealed with a key in the system keychain, so a change made outside the window puts it back to asking.
- **The terminal panel** runs a shell and the agent programs you choose, as yourself, like any terminal. FormMorpheus neither installs those programs nor signs in to them.
- **Pen Link** (off by default) turns a tablet on your local network into a drawing tablet. While it is on it listens on your network, pairs one tablet with a six-digit code that lasts two minutes and allows five tries, and serves nothing but its own page. **Its connection is not encrypted:** use it on a network you trust.
- **Downloads.** The only thing FormMorpheus downloads is the family's ffmpeg build, and only when you press Download in Preferences, Video Tools: over HTTPS, checked against recorded SHA-256 sums for the archive and every file before anything is made runnable, and installed in your data folder, never inside the app.
- **Files.** Movies, imports and exports are read and written inside the library, Exports and data folders, or in a folder you chose in a system dialog; names from a file never place anything outside those folders.
- **No data collection.** FormMorpheus sends nothing about you or your movies anywhere. On iPad, a library you put in iCloud Drive is synced by Apple's iCloud as you chose.

## What counts

Anything that gets past one of the boundaries above: making the engine reachable from another machine without Pen Link, using the engine without the window key, running script in the page that the policy should refuse, an outside agent changing, exporting or importing without your Allow, Pen Link pairing without the code or serving more than its page, a download installed without its checksums matching, or a file written outside where it should go.

Bugs that need someone to already control your computer, or to run a modified build of FormMorpheus, are ordinary bugs: please open an issue for those.
