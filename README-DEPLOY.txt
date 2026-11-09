C&J GROUP BOOKINGS FIX — DEPLOYMENT NOTES

WHAT THIS PACKAGE DOES
- Keeps the existing C&J customer website and Web3Forms email notifications.
- Saves every new booking to Netlify Blobs through /api/cj-bookings.
- Shows saved bookings in dashboard.html, with search, department/status filters and shared status updates.
- Protects the bookings list and status updates with a dashboard password.

FILES
- public/index.html: customer-facing C&J website / booking form
- public/dashboard.html: management dashboard
- netlify/functions/cj-bookings.mjs: secure booking API
- netlify.toml and package.json: Netlify configuration

IMPORTANT DEPLOYMENT STEPS
1. Deploy the CONTENTS of this folder to the same Netlify site that serves the customer booking page. This package contains no imported customer records and is safe to keep in a public source repository. The customer site must be at / and the dashboard will be at /dashboard.html.
2. In Netlify, open Site configuration (or Project configuration) > Environment variables.
3. Add CJ_ADMIN_PASSWORD with a strong, unique password that you keep private. Do not put this password in the HTML file or share it publicly.
4. Trigger a fresh deploy after setting the environment variable.
5. Open https://YOUR-SITE.netlify.app/dashboard.html, choose Bookings, and sign in using CJ_ADMIN_PASSWORD.
6. Test a booking on the public site. It should appear in the dashboard after refreshing.

SECURITY / PRIVACY
- Customer booking data is stored in Netlify Blobs and is only returned by the function after the dashboard password is checked.
- Do not remove the password check or make the bookings endpoint public.
- Only new bookings submitted after this version is deployed will be saved to the shared bookings list. Earlier email notifications are not imported into the public repository.
- The function source is outside the public publish folder and is not served as a static website file. The function contains no customer booking records.
- This dashboard file continues to store local income/staff entries in the browser as before; this change makes bookings shared, not all dashboard records.

NOTES
- The Web3Forms public access key is used only for the customer booking notification form. It is not the secret dashboard password.
- If the Netlify site currently has a different index page or the dashboard lives on a separate Netlify site, deploy both pages and the function together on the site that serves the booking form, or update the site routing accordingly.
