# Handoff: Learnomy (2026-11-15)

Live: **0.2.0** on the EmDash registry as `@vapvarun.bsky.social/learnomy`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/learnomy

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## In progress: 0.2.1

Branch `0.2.1`, milestone `0.2.1`, one pull request "Learnomy 0.2.1". It fixes #35 (two low findings from the 0.2.0 review):

- A member's own erase keeps attempts used and the last attempt time for every quiz they took that still exists, whatever its retake policy now, so a quiz limited later still counts attempts made before the erase.
- The same erase deletes the kept records of deleted quizzes and drops them from the member's index. A quiz delete keeps its results in Quiz results, and kept records have no per-quiz index, so the cleanup runs on the erase, not on the delete.

The admin erase is unchanged: it removes everything. QA case Q15 in `docs/qa/QA_CHECKLIST.md`. The kit wording file changed (`eraseHelp`), so the kit is copied again from `v0.2.1`.

Next: coordinator walk of Q14 and Q15 (member, owner, failure side), the review, `gate.sh`, and publish only with the owner's go-ahead. The other 0.2.0 review lows were fixed in 0.2.0. Still open: the Cloudflare update check, which needs the owner to run the update in the admin.
