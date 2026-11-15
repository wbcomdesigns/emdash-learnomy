# Let members join

**Included in Free.**

To enroll, mark lessons complete or take a quiz, a visitor needs an account on your site. For now, members join by your invite. Inviting is part of EmDash itself, not Learnomy, so the screens below are EmDash's own. Checked on EmDash 1.5.0.

Do the steps in this order. Inviting before step 1 is the most common reason a member never gets in.

## Step 1: set up email first

EmDash sends each invite by email. It needs an email provider to do that.

1. In the dashboard, open **Settings**, then the **Email Settings** card.
2. Look at the **Email Pipeline** box on that page.
   - **"Email provider active"** with a provider name under it means EmDash can send. If the name is `emdash-console-email`, read [On a local test site](#on-a-local-test-site) below: that one sends nothing.
   - **"No email provider configured"** means invites cannot go out by email.
3. To add a provider, pick one of these:
   - **SMTP, built into EmDash.** Under **Email Provider**, choose **SMTP**, fill in the server, port, username and password from your email service (for example Brevo, Office 365, Fastmail or Amazon SES) and press **Save Settings**. No plugin needed. EmDash stores the password encrypted, so your site needs an `EMDASH_ENCRYPTION_KEY` (whoever set up the site adds it; see EmDash's [Email Setup](https://docs.emdashcms.com/guides/email/) guide).
   - **A provider plugin.** Open **Plugins**, then **Registry**, and search the name of your email service, for example **Resend**. Several Resend plugins are listed. They are made by other developers, not by EmDash or by us, so read the plugin's page before you install it. Install it, enter its API key on the plugin's settings page, then come back to **Settings**, **Email Settings** and select it under **Email Provider** if more than one is listed.
4. Under **Send Test Email**, type your own address and press **Send Test**. Open your inbox. When the test arrives, invites will too.

## Step 2: invite a member

1. Open **Users** and press **Invite User**.
2. Type the person's email address.
3. **Change the role to Subscriber.** The role box starts on **Author**, which can publish posts on your site. Open it and pick **Subscriber** ("Can view content"). A Subscriber can read your site, enroll and learn, and nothing more. Never give a learner a higher role.
4. Press **Send Invite**.

What you see next depends on step 1:

- **With an email provider:** a green message says "Invitation sent to" the address. The person gets an email with a link, sets up their sign-in, and can then enroll in any course.
- **Without one:** the box changes to "Invite Link Created" and shows the link with a **Copy invite link** button. Send that link to the person yourself, by your own email or chat. It works once and expires after 7 days.

The person does not appear under **Users** until they open the link and finish setting up their account. That is expected: "Invitation sent" means the invite exists, not that they joined. Each member appears under **Enrollments** once they enroll in a course.

## On a local test site

When you run your site on your own computer with `npm run dev` (Node), EmDash switches on a stand-in email provider called `emdash-console-email`. **It sends nothing.** Settings still says "Email provider active", and Invite User still says "Invitation sent", but the email only goes to the terminal window where the site is running.

To get the invite link on a local site:

- Look in that terminal for a block that starts with `[dev-email] Email sent` and copy the link after "Click this link to create your account". It looks like `http://localhost:4321/_emdash/admin/invite/accept?token=...`.
- Or open `/_emdash/api/dev/emails` on your local site. It lists the last 100 emails the stand-in caught, newest first, with the same link in each.

Open the link in a private window (you are signed in as the admin in your normal one) to finish the member's sign-up. On your live site the stand-in never runs, so set up step 1 there before inviting anyone.

## Can people sign up by themselves?

Not yet. EmDash has a setting that lets anyone with an email address at your allowed domains sign up by themselves (**Settings**, **Self-Signup Domains**), but it does not work in EmDash 1.5. EmDash is fixing it (emdash-cms/emdash#4863). Once EmDash releases that fix, self-signup will work with Learnomy and this guide will add the steps.

Until then, invite each member as above.

## What a guest sees

A guest who opens an Open course can read every lesson. A guest who opens a Members course sees the lesson titles and a sign-in prompt that says members join by invitation and to ask you for one. See [What Members means](what-members-means.md).
