# FolioVista Sites deployment

FolioVista is packaged for OpenAI Sites by the production build. The build
emits the Cloudflare Worker bundle, static assets, and `.openai/hosting.json`
under `dist/`. The current application does not request D1 or R2 bindings, so a
deployment does not introduce portfolio persistence.

## Approval-gated releases

Production updates are intentionally manual and approval-gated:

1. Make the requested changes on a branch without deploying them.
2. Review the diff and run the repository's mandatory `npm test` gate.
3. Commit the exact reviewed revision and record the commit SHA.
4. Ask the owner for explicit production approval, naming that commit SHA.
5. Only after approval, deploy that exact commit to the existing Sites project.
6. Verify the public URL and the read-only `/api/nav` and `/api/nav-history`
   routes, then report the deployed commit and URL.

Approval applies only to the named commit. Further edits require a new test run,
commit, and approval. A preview, test run, pull request, or merge is not itself
permission to update production.

Suggested approval wording:

> I approve deploying commit `<full-commit-sha>` to the existing FolioVista
> production Site.

## Release safeguards

- Run `npm test` after the final code change and before requesting approval.
- Do not deploy a dirty worktree or a revision other than the approved SHA.
- Do not add D1, R2, analytics, logging, or other portfolio persistence as part
  of a release.
- Do not send CAS PDFs, passwords, extracted statement text, folio information,
  or portfolio values through deployment or verification requests.
- Rollbacks are releases too: identify the rollback commit, test it, and obtain
  explicit approval before deploying it.

