# Handoff: Learnomy (2026-11-15)

Live: **0.2.0** on the EmDash registry as `@vapvarun.bsky.social/learnomy`. Public page: https://plugins.emdashcms.com/plugins/@vapvarun.bsky.social/learnomy

Test on a fresh `create-emdash` blog site (registry install, kit from the release tag) and on the Cloudflare test site. On Cloudflare, redeploy after a registry install or update before judging anything (emdash-cms/emdash#4865).

## In progress: 0.2.2

Branch `0.2.2` (from `v0.2.1`, which is merged to `main`), milestone `0.2.2`, one pull request "Learnomy 0.2.2". Fixes from the independent QA pass of 0.2.1:

- #38: before the kit's seed creates `lms_courses` and `lms_lessons`, every admin screen and the dashboard card show "Next: copy the site kit" with a link to the install guide (one catch in `handleAdmin`, matched by `typesMissing`); public routes answer empty (`findPublished`).
- #39: Enrollments, Your courses and the `listEnrollments` tool count progress through one helper, `publishedProgress`, on the outline's published lessons; finished comes from that count, not the stored `completedAt`. Enrollments and Quiz results show 10 rows a page so Enrollments stays at 20 calls (SCOPE updated).
- #41: the quiz settings number fields carry no browser min or max, so every out-of-range or empty value reaches `writeQuiz`, whose refusal names the allowed range; `saveQuiz` takes any number and answers `INVALID_QUIZ` with the same words; `passMark: 0` means none.
- #40 and #42: README, introduction, known limits, admin guide and agents guide describe 0.2 quizzes; Let members join rewritten against EmDash 1.5 (email first, Subscriber not Author, what "Invitation sent" means, the dev console provider and `/_emdash/api/dev/emails` on a local site). EmDash has no official Resend plugin: the guide points at core SMTP or a Registry provider plugin.

The site kit did not change. QA cases O10, O12, O14 and Q16 in `docs/qa/QA_CHECKLIST.md`.

Next: coordinator walk of #38 on a fresh registry install and #39, #41 on the walk lab; the review; `gate.sh`; publish only with the owner's go-ahead.
