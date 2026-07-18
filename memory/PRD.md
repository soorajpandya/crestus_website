# Veloura — PRD

## Original Problem Statement
"Build Me A website for Mens and Women Clothing store. not for the children or kids."

## User Choices
- Full e-commerce (cart, checkout, orders)
- Razorpay payments (LIVE keys provided by user, stored in backend/.env)
- Google social login (Emergent-managed auth)
- Sample products for now; user will provide real products later
- Myntra-inspired premium aesthetic (magenta #F41CB2 accents, white space, product-first, 3:4 imagery)

## Architecture
- FastAPI + MongoDB (motor) backend, all routes under /api
- React (CRA) + Tailwind + shadcn frontend; framer-motion + lenis smooth scroll + react-fast-marquee
- Auth: Emergent Google OAuth → session_token httpOnly cookie (7-day), collections: users, user_sessions
- Payments: Razorpay order create (server-side amount from DB prices) → checkout.js modal → signature verification → order marked paid
- Cart: client-side localStorage (veloura_cart)
- Products seeded on startup if collection empty (16 items, men/women)

## User Personas
- Shoppers (men/women adults) browsing and purchasing clothing

## Implemented (June 2026)
- Home: kinetic masked line-by-line hero reveal, dual parallax editorial images, marquee bands, featured grid, category banners, numbered manifesto (01–03)
- Shop page with All/Men/Women filters (/shop?c=men|women)
- Product detail: 3:4 spotlight image, size selector, add to bag
- Cart drawer (Sheet) with qty controls, remove, subtotal
- Checkout: auth-gated, address form, Razorpay modal payment + verification
- Orders page with status badges (paid/pending/failed)
- Google login via Emergent auth (header sign-in, dropdown with orders/logout)
- Tested: iteration_1 — 15/15 backend, all frontend flows pass

## Backlog
- P0: Replace sample products with user's real catalog (user will provide)
- P1: Product search; multiple images per product; inventory/stock tracking
- P1: Razorpay webhook for payment confirmation resilience
- P2: Wishlist, product reviews, discount codes, email order confirmations (Resend)

## Notes
- Razorpay keys are LIVE — real money moves on payment. Swap to test keys in backend/.env for safe testing.
- Test session credentials in /app/memory/test_credentials.md; auth testing playbook at /app/auth_testing.md
