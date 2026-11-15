# AGENTS COORDINATION CHANGELOG
This changelog documents shared milestones, schema definitions, and contract updates between Frontend and Backend engineering agents.

## [2026-11-15] - PET Contract Alignment & Integration Complete
- **Author:** Frontend Engineering Agent & Backend Engineering Agent
- **Status:** Integrated & Verified
- **Updates:**
  - Contract harmonized to `Version 1.1.0` in `docs/API_CONTRACT.md`.
  - Harmonized endpoints:
    - `GET /accounts`, `POST /accounts`
    - `GET /categories`, `POST /categories`
    - `GET /transactions/recent` (3 calendar days in user timezone)
    - `GET /transactions` (Cursor pagination, search, sorting, filtering)
    - `POST /transactions` (`clientTransactionId` idempotency, multi-type support, account validation)
    - `GET /transactions/:id`, `PATCH /transactions/:id`, `DELETE /transactions/:id`, `POST /transactions/:id/restore`
    - `GET /home` (Real monthly totals, today's spending, top categories, recent transactions, total balance)
    - `GET /summary` (Period analytics: day, week, month, quarter, half_year, year, financial year, custom)
  - Frontend implementations:
    - Mock data completely removed from production UI (removed dummy ₹120,000 / ₹35,500 fallbacks, removed hardcoded transactions).
    - Dynamic PE Tracker header date replaces static November 2026 with midnight rollover check.
    - Balanced 48dp height for Search Bar and Add Button.
    - Removed horizontal filter chips from PE Tracker to eliminate page swipe gesture conflict.
    - Real 3-day grouped list on PE Tracker with daily spending totals.
    - Dedicated History & Insights screen with period selector, Indian Financial Year support, cursor pagination, search, sort, and horizontal bar charts.
    - Universal Transaction modal supporting EXPENSE, INCOME (with mandatory account destination check), TRANSFER (preventing same source/dest), REFUND, and ADJUSTMENT.
    - Inline custom category creation with persistence to backend.
    - Idempotency with `clientTransactionId`.
    - Soft delete with Undo toast and restore endpoint via `toast.action`.
    - Duplicate transaction flow.
    - Full transparent normalizers in `frontend/src/api/` for minor-unit integer strings (`amountMinor`, `incomeMinor`, `expenseMinor`, `netSpendingMinor`, `netFlowMinor`, `totalBalanceMinor`, `averageDailySpendMinor`) across `/home`, `/summary`, and `/transactions`.
    - Pruned dead obsolete mock files (`frontend/src/data/mockData.ts`).
    - Verified strict TypeScript compliance (`npx tsc --noEmit`: 0 errors).
    - Verified test suite: 11 test suites, 92 passing unit tests.
    - Implemented centralized money utilities in `frontend/src/utils/money.ts` (`decimalInputToPaiseMinor`, `paiseMinorToDecimal`, `formatPaise`, `comparePaise`, `addPaise`, `subPaise`).
    - Enforced minor-unit paise strings (`amountMinor`) across all financial requests without floating-point conversion issues.
    - Documented Section 4 (Money Representation) and Section 5 (Mock Replacement Mapping Table) in `docs/API_CONTRACT.md`.

## [2026-11-15] - Transaction Form UX Refinement (FE & BE)
- **Author:** Frontend & Backend Engineering Agents
- **Status:** Completed & Verified
- **Field Behavior & UX Updates:**
  - **Income:** Removed Payment Method completely. Uses human label `Received Into` mapping to `destinationAccountId`. Does not send `paymentMethod`.
  - **Expense:** Uses human label `Paid From` mapping to `sourceAccountId`. Displays semantic `Payment Method` with options (UPI, Cash, Debit Card, Credit Card, Bank Transfer, Wallet, Other).
  - **Transfer:** Displays `Transfer From` and `Transfer To` with arrow separator. Omits Payment Method and Category. Validates `sourceAccountId !== destinationAccountId`.
  - **Refund:** Uses human label `Received Into` mapping to `destinationAccountId`. Omits Payment Method. Shows optional original transaction reference.
  - **Adjustment:** Uses label `Account`, `Direction` (Increase / Decrease), and required `Reason` field. Omits Payment Method and Category.
  - **Account Selection & UX:** Displays actual user-owned accounts with distinct emojis (`💵 Cash`, `🏦 HDFC Savings`, `👛 Paytm Wallet`, `💳 HDFC Credit Card`, etc.).
  - **Add Account Flow:** Added `+ Add Account` trigger on every account selector. Allows creating real accounts via `POST /accounts` on the backend, automatically invalidates accounts query, and auto-selects newly created account.
  - **Backend Support:** Added `reason` as an alias for `note` (required for ADJUSTMENT) and `initialBalanceMinor` alias for `openingBalanceMinor`. Sanitizes `accountId` as `sourceAccountId` for Expense/Transfer and `destinationAccountId` for Income/Refund.
  - **Verification:** 11 frontend test suites (96 tests passing), 6 backend test suites (59 tests passing), 0 TypeScript errors.
