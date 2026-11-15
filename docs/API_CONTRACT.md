# ARTHA PERSONAL EXPENSE TRACKER (PET) — API CONTRACT
**Version:** 1.1.0  
**Status:** Unified Single Source of Truth  
**Last Updated:** 2026-11-15  

This document serves as the binding API contract between Frontend and Backend engineering agents for Artha Personal Expense Tracker. All endpoints, request fields, response envelopes, and enums defined here are harmonized.

---

## 1. Global Standards & Envelopes

### Base URL
- Production: `https://api.artha.app/api/v1`
- Local / Development: `http://localhost:3000/api/v1` (Android Emulator: `http://10.0.2.2:3000/api/v1`)

### Headers
- `Authorization: Bearer <accessToken>` (Required for all protected endpoints)
- `Content-Type: application/json`

### Success Envelope
Every response adheres to the global NestJS `TransformInterceptor`:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-11-15T15:30:00.000Z",
    "correlationId": "cor-12345"
  }
}
```

---

## 2. Common Enums

### TransactionType
- `EXPENSE`
- `INCOME`
- `TRANSFER`
- `REFUND`
- `ADJUSTMENT`

### AccountType
- `CASH`
- `BANK`
- `WALLET`
- `CREDIT_CARD`
- `OTHER`

### PaymentMethod
- `CASH`
- `UPI`
- `DEBIT_CARD`
- `CREDIT_CARD`
- `BANK_TRANSFER`
- `WALLET`
- `OTHER`

### AdjustmentDirection
- `INCREASE`
- `DECREASE`

### Named Periods (Period)
- `TODAY`, `YESTERDAY`, `LAST_3_DAYS`, `THIS_WEEK`, `LAST_7_DAYS`, `THIS_MONTH`, `LAST_MONTH`, `LAST_30_DAYS`, `THIS_QUARTER`, `THIS_HALF_YEAR`, `THIS_YEAR`, `THIS_FINANCIAL_YEAR`, `CUSTOM`

---

## 3. Endpoints

### 3.1 Accounts
- `GET /accounts`: Returns `{ accounts: AccountView[] }` (creates a default Cash account on first use).
- `POST /accounts`: `{ name, type, currency?, openingBalanceMinor? (or initialBalanceMinor?), isDefault? }` -> `{ account: AccountView }`

### 3.2 Categories
- `GET /categories`: Returns `{ categories: CategoryView[] }` (system + custom categories).
- `POST /categories`: `{ name, icon?, color?, type? }` -> `{ category: CategoryView }`

### 3.3 Transactions
- `GET /transactions/recent`: Returns `{ days: [{ date, label, items }] }` for 3 calendar days (Today, Yesterday, 2 Days Ago) in the user's timezone.
- `GET /transactions`: Cursor pagination, text search (`search`), and filters (`type`, `sourceAccountId`, `destinationAccountId`, `paymentMethod`, `from`, `to`, `sort`, `cursor`, `limit`).
- `POST /transactions`:
  - `clientTransactionId`: string (unique client UUID for idempotency replay detection)
  - `type`: `TransactionType`
  - `amountMinor`: string / integer (paise) OR `amount`: number
  - `occurredAt`: ISO-8601 string
  - `sourceAccountId`: string (required for EXPENSE, TRANSFER; forbidden for others)
  - `destinationAccountId`: string (required for INCOME, TRANSFER, REFUND; forbidden for others)
  - `accountId`: string (required for ADJUSTMENT; forbidden for others)
  - `direction`: `INCREASE` | `DECREASE` (required for ADJUSTMENT; forbidden for others)
  - `categoryId`: string (required for EXPENSE, INCOME; forbidden for TRANSFER, ADJUSTMENT)
  - `paymentMethod`: `PaymentMethod` (required for EXPENSE; omitted for INCOME, TRANSFER, REFUND, ADJUSTMENT)
  - `payee`: string (optional, merchant/source)
  - `note`: string (optional for EXPENSE, INCOME, TRANSFER, REFUND; required reason for ADJUSTMENT)
  - `reason`: string (optional alias for note)
  - `relatedTransactionId`: string (optional, for REFUND)
- `GET /transactions/:id`: Fetch single transaction.
- `PATCH /transactions/:id`: Update editable fields.
- `DELETE /transactions/:id`: Soft-delete transaction (reverses account balance effect).
- `POST /transactions/:id/restore`: Restores soft-deleted transaction (Undo flow).

### 3.4 Home Dashboard
- `GET /home`: Returns:
  - `month`: `{ from, to, incomeMinor, expenseMinor, refundsMinor, netSpendingMinor, netFlowMinor }`
  - `todaySpending`: `{ expenseMinor, refundsMinor, netSpendingMinor }`
  - `topExpenseCategories`: `CategoryBreakdownView[]`
  - `recentTransactions`: `TransactionView[]`
  - `accounts`: `AccountView[]`
  - `totalBalanceMinor`: string

### 3.5 Analytics & Insights
- `GET /summary`: Returns totals, breakdown, series, and average daily spend for requested period or from/to dates.

---

## 4. Money Representation & Financial Calculations
- All monetary amounts in database and over the wire are base-10 strings of integer minor units (paise for INR). Example: ₹500.25 -> `"50025"`.
- Never routed through floating-point IEEE-754 numbers in network payloads.
- Client utility `frontend/src/utils/money.ts`:
  - `decimalInputToPaiseMinor(input)`: User decimal currency input -> string paise
  - `paiseMinorToDecimal(minor)`: String paise -> decimal for charts
  - `formatPaise(minor, options)`: Formats string paise -> localized display currency string (e.g. `"₹500.25"`)
  - `comparePaise(a, b)`: BigInt amount comparison
  - `addPaise(...amounts)`: Safe summation
  - `subPaise(a, b)`: Safe subtraction

---

## 5. Mock Data Replacement Mapping Table

| Legacy Mock Source | Replacement Endpoint / Architecture | Target Client Service | Status |
| :--- | :--- | :--- | :--- |
| `src/mock/transactions.mock.ts` | `GET /transactions/recent`, `GET /transactions`, `POST /transactions` | `src/api/transactions.ts` | **Fully Replaced** |
| `src/mock/categories.mock.ts` | `GET /categories`, `POST /categories` | `src/api/categories.ts` | **Fully Replaced** |
| `src/mock/insights.mock.ts` | `GET /home`, `GET /summary` | `src/api/home.ts`, `src/api/analytics.ts` | **Fully Replaced** |
| `src/data/mockData.ts` | `GET /home`, `GET /transactions/recent`, `GET /accounts` | Cleaned up & Removed | **Fully Removed** |
| Hardcoded balances (₹120k / ₹35.5k) | Real user balances from `GET /home` & `GET /accounts` | Sourced from `totalBalanceMinor` | **Fully Replaced** |

