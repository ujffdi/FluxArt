# Use billing route for account and credits surface

FluxArt will use `/workspace/billing` as the canonical route for the Account and Credits Surface, with `/workspace/account` redirecting there. The billing route already owns payment return and mock payment flows, so keeping it canonical avoids splitting account state, credit purchase, and order recovery across two user-facing pages.
