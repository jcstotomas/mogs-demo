# MOGS local GitHub App authentication

The coordinator uses the private App [memberofgtmstaff](https://github.com/settings/apps/memberofgtmstaff), owned by `jcstotomas`. The user supplied App ID `5179329` and Client ID `Iv23lingN6UVLfBTBqhH`. These identifiers are public configuration; they do not establish installation, authentication or branch enforcement.

## Human setup

1. In **Permissions & events**, set repository Contents, Pull requests and Commit statuses to **Read and write**. Set Administration to **Read and write** for coordinator branch-protection setup. Runtime token requests reduce Administration to read.
2. Leave webhook **Active** unchecked. No webhook URL, webhook secret, OAuth client secret or callback URL is needed for this local polling coordinator.
3. Choose **Install App**, install on the `jcstotomas` account and select only `mogs-demo`. Approve updated permissions if GitHub prompts for them.
4. Generate a private key from the App's General page. Keep the downloaded PEM outside the repository. The existing Downloads location works. Share only its absolute local file path with the coordinator.
5. Provide the installation settings URL if available. Its final number is the installation ID; the provider also discovers the exact repository installation with the App JWT.

## Local configuration

Set these fields in ignored `.env.local`:

```dotenv
MOGS_GITHUB_REPOSITORY=jcstotomas/mogs-demo
MOGS_STATUS_PRODUCER_APP_ID=5179329
MOGS_STATUS_PRODUCER_APP_SLUG=memberofgtmstaff
MOGS_GITHUB_APP_CLIENT_ID=Iv23lingN6UVLfBTBqhH
MOGS_GITHUB_PRIVATE_KEY_PATH=/absolute/path/to/downloaded-private-key.pem
# Optional pin; exact repository discovery still runs and must match.
MOGS_GITHUB_INSTALLATION_ID=
```

The provider reads the PEM locally, signs an RS256 App JWT, attests the App and repository installation, then mints a token restricted to `mogs-demo` and the requested permissions. Tokens stay in memory and refresh before expiration. Concurrent requests share the refresh. A repository request rejected with 401 refreshes once; a 403 permission denial is returned immediately.

When a private-key path is configured, App authentication takes precedence over `MOGS_GITHUB_TOKEN`. The optional manual installation-token fallback expires without automatic renewal. Explicit test tokens retain their fixture behavior. Public content builds never load these credentials.

`npm run remote:audit` checks configuration presence and provider configuration without authenticating or printing credentials. `npm run github:check` authenticates, mints the scoped token in memory, records safe installation metadata and inspects branch protection. It makes no commits, branch changes or PRs. Its authentication exit status does not establish passing branch settings or enforcement probes; those outcomes are recorded separately.

Configured credentials alone do not pass Remote 0B. The coordinator must observe the actual App/status producer, configure both required contexts bound to App ID `5179329`, and record eligibility with pending/failing/wrong-head statuses and success on the current head. A human GitHub merge remains a separate publication decision.

## Recorded setup and enforcement — 2026-10-03

The App authenticated as `memberofgtmstaff` (App ID `5179329`) on installation `167640959`, repository `1403606624`, `jcstotomas/mogs-demo`. Runtime scoped tokens use Contents, Pull requests and Commit statuses write, Administration read and Metadata read. The setup producer uses Administration write when configuring protection.

The [private-repository protection HTTP 403](../data/evidence/remote0/github-app-auth-private-history.json) at authentication commit `48d1d6c` is historical failed setup evidence. The user subsequently made the repository public. The saved [authentication inspection](../data/evidence/remote0/github-app-auth.json), at `2026-10-03T21:19:31.711Z`, passed authentication but returned protection HTTP 404 before branch rules were configured. Its failed enforcement fields describe that timestamp, not the later setup result.

[Current rules](../data/evidence/remote0/github-enforcement-current.json), read at `2026-10-03T21:29:46.025Z`, require `mogs/candidate` and `mogs/preview` from App ID `5179329`, strict current-base checks and administrator enforcement, with no bypass actors, merge queue, automatic merge, force pushes or deletions. [Passing enforcement proof](../data/evidence/remote0/enforcement-pass.json) and the [probe journal](../data/evidence/remote0/enforcement-probes.json) record these actual eligibility observations:

- [Audit PR #1](https://github.com/jcstotomas/mogs-demo/pull/1), head `f5bd4a0cedf4b42a20cbf5fe46ecd2e7167ac6e6`: pending, failing and success-on-a-different-commit cases were `blocked`; passing statuses on the current head made it `clean`.
- [Audit PR #2](https://github.com/jcstotomas/mogs-demo/pull/2), head `175dc93c650a8a6d099054dc958376ad474a3352`: passing statuses on a branch behind the base were `behind` under strict checks.

Both audit PRs were closed without merging. No merge request was attempted, and they provide no correction or preview/public-verification credit. Base `main` remains `e573c2608ce3fa54f51cab67594355448aa1059b`. Remote 0B passes in the coordinator checkpoint with the [integrated checks](../data/evidence/remote1/integration-checks.json). Follow [Remote 0 evidence](REMOTE_0.md) and the [miniature handoff](REMOTE_1.md) for the remaining human review, real PR, preview, merge and public-verification gate.

References: [App JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app), [installation token API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app), [branch protection API](https://docs.github.com/en/rest/branches/branch-protection).
