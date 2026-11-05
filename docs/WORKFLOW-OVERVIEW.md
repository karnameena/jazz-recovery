# Jazz Recovery website and billing workflow

## Customer access

1. Registration creates the account and, when eligible, records the seven-day trial in PostgreSQL.
2. The website asks the authenticated billing API for the current access state. PostgreSQL dates and subscription records are authoritative.
3. Users with an active trial or verified active subscription continue to the recovery dashboard.
4. When the trial has expired and no verified subscription is active, the website presents the Subscription page.
5. Billing API outages do not cause a client-side access decision or falsely activate/deactivate a subscription.

## Plans and payments

- Monthly plan: ₹49, using the configured monthly Razorpay payment link.
- Annual plan: ₹399, using the configured annual Razorpay payment link.
- A payment intent is recorded before redirecting to Razorpay.
- Opening a payment link or returning from Razorpay never activates a subscription. A trusted server-side payment verification integration is required before activation.
- Discount codes are annual-only and support 10%, 20%, and 50% discounts. Discount amounts are calculated by the backend in paise.
- The supplied fixed-price payment links cannot collect a discounted amount. A discounted intent remains pending dynamic checkout configuration and no subscription is granted.

## Billing administration

- The first billing administrator is designated from the server using `npm run bootstrap-billing-admin` and the private `JAZZ_BILLING_ADMIN_BOOTSTRAP_SECRET`.
- Bootstrap is one-time: once an administrator exists, the script refuses to replace that account. The secret never enters website JavaScript, browser storage or an API request.
- Admin APIs independently verify the billing administrator record in PostgreSQL.
- Administrators can create, edit, enable, disable and safely delete discount codes; edit trial/subscription dates; review payment intents and audit events; and permanently delete non-administrator user accounts after exact-username confirmation.
- Every privileged change is recorded in `billing_audit`.

## Persistence

PostgreSQL is the only supported runtime database. The server refuses to start unless `JAZZ_DB_ENGINE=postgres` and `DATABASE_URL` are configured. Migrations are additive and run through the PostgreSQL migration runner.
