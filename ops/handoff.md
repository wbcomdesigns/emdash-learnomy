# Handoff: Learnomy (2026-11-15)

Live: **0.1.0** on the EmDash registry as `@vapvarun.bsky.social/learnomy`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/learnomy

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## Next: 0.1.1

Milestone `0.1.1` on GitHub holds the work, in this order:

- #16 Review L3: Find shows site-wide total and stops at 15 matches
- #17 Review L4: list sort columns lack single-column indexes
- #18 Review L6: Open/Members default differs between screens
- #19 Review L7: catalog Previous always returns to page 1
- #20 Large sites: published checks past the scan ceiling
- #24 Post-publish: Cloudflare routes answer 404 on some requests for 15+ min after a registry install
- #26 Next release: registry install text and shared kit

Then the release gate (`gate.sh`, which also checks that no public file carries machine paths and that the README is the product landing page), an independent walk on Node and Cloudflare, and publish only with the owner's go-ahead.
