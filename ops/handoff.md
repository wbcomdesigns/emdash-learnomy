# Handoff: Learnomy (2026-11-15)

Live: **0.2.1** on the EmDash registry as `@vapvarun.bsky.social/learnomy`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/learnomy

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## In progress: 0.3.0

Branch `0.3.0`, milestone `0.3.0`, one pull request "Learnomy 0.3.0". Issue #37: course certificates with a shareable link (SCOPE section "0.3.0").

- The certificate lives on the enrollment row (`certToken`, indexed). Finishing a course issues it; courses finished before 0.3.0 are issued on first view of Your courses or the Certificates admin page.
- Public route `certificate`, member routes `myCertificates` and `setCertificate`, admin page Certificates, MCP tools `listCertificates` and `turnOffCertificate`.
- Kit: new `pages/certificates/[token].astro` (never cached, noindex, print stylesheet in `learnomy.css`), Your courses certificate row, new strings. The kit is copied again from `v0.3.0`.
- QA cases C1 to C8 in `docs/qa/QA_CHECKLIST.md`.

Next: coordinator walk of C1 to C8 (member, guest, owner, print, 390 dark), the independent review, `gate.sh`, and publish only with the owner's go-ahead. Still open from 0.2.x: the Cloudflare update check, which needs the owner to run the update in the admin.
