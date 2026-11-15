# Handoff: Learnomy (2026-11-15)

Live: **0.1.1** on the EmDash registry as `@vapvarun.bsky.social/learnomy`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/learnomy

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## In progress: 0.2.0

Branch `0.2.0`, milestone `0.2.0`, one pull request "Learnomy 0.2.0". It builds the owner's decisions of 2026-11-15:

- #28 Passing score
- #29 More question types
- #30 Retakes and limits
- #31 Practice mode

The decisions and new fields are in `SCOPE.md` under "0.2.0"; the QA cases are Q1 to Q13 in `docs/qa/QA_CHECKLIST.md`.

Next, per #32: coordinator walk of every changed flow (owner, guest, member, failure side), the independent walk on Node and Cloudflare (redeploy after install), the review, `gate.sh`, and publish only with the owner's go-ahead. Carried from 0.1.1: the Cloudflare update check (update an older version in place, count versions answering, then redeploy) needs the owner to run the update in the admin.
