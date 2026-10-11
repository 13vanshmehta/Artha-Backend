# Artha Transactional Email System

**Artha — Know. Spend. Grow.**

This document details the architecture, design tokens, templates, preview tools, and configuration for Artha's branded transactional email system.

---

## 1. Brand Identity & Design Principles

All emails are styled with a clean, minimalist fintech aesthetic consistent with Artha's mobile interface.

* **Primary Navy (`#102A56`)**: Used for headings, brand logo wordmark, primary CTA buttons, and key emphasis.
* **Secondary Blue (`#2878D4`)**: Used for links, subtle badges, and secondary highlights.
* **Light Blue Surface (`#EAF4FF`)**: Used for OTP verification containers and highlighted callouts.
* **Neutrals**: `#F4F7FB` email background, `#FFFFFF` crisp card container, `#E5EAF2` borders, and `#172033` primary text.
* **Cross-Client Compatibility**: Table-based responsive structure targeting max 580px width, fully tested for Apple Mail, Gmail (web, iOS, Android), Outlook, and Yahoo.
* **Dual-Format Delivery**: Every email is generated with both responsive HTML and a clean, structured plain-text fallback.
* **Security & Privacy First**: All user-controlled variables (names, group names, notes, merchants) are HTML-escaped. Secrets are never exposed in links, logs, or image URLs.

---

## 2. Available Email Templates & Trigger Events

| Template Key | Default Subject | Triggering Backend Event | Type |
| :--- | :--- | :--- | :--- |
| `welcome` | Welcome to Artha — let's get started! | Dispatched after first successful email verification or first-time OAuth account creation (`confirmEmailVerification`, `loginWithGoogle`, `loginWithApple`). | Transactional / Onboarding |
| `verification_otp` | Your Artha verification code | User initiates registration or requests a new OTP (`register`, `sendEmailVerification`). | Transactional (Security) |
| `verification_confirmed` | Your Artha email is verified | Dispatched when user submits valid verification code (`confirmEmailVerification`). | Transactional (Security) |
| `password_reset` | Reset your Artha password | User requests password reset via email (`forgotPassword`). | Transactional (Security) |
| `password_changed` | Your Artha password was changed | User successfully changes password (`changePassword`, `resetPassword`). | Transactional (Security) |
| `new_sign_in` | New sign-in to your Artha account | New session created on a new device or platform (`login`). | Transactional (Security) |
| `email_changed` | Your Artha email address was changed | User updates their primary account email. | Transactional (Security) |
| `group_invitation` | You've been invited to an Artha expense group | User added to a collaborative expense group (`FinanceController.addGroupMember`). | Transactional / Collaborative |
| `expense_added` | A new expense was added to your Artha group | Member adds an expense to a shared group (`FinanceController.createExpense`). | Notification |
| `settlement_recorded` | Your Artha expense settlement is updated | Internal group settlement recorded between members. | Notification |
| `expense_reminder` | A reminder about your shared expenses | Group balance reminder dispatched to members with pending shares. | Notification |
| `account_deleted` | Your Artha account was closed | User confirms account deletion (`deleteAccount`). | Transactional (Account Lifecycle) |

---

## 3. Local Developer Previews

In non-production environments (`NODE_ENV !== 'production'`), developers can visually review and test every email template in a web browser without sending real emails.

### Endpoints
* **List All Available Templates**:
  ```http
  GET /api/v1/email/previews
  ```
  Returns a JSON list of all 12 templates, subjects, preheaders, and preview links.

* **Render HTML Preview in Browser**:
  ```http
  GET /api/v1/email/previews/:templateKey
  ```
  Example: `http://localhost:3000/api/v1/email/previews/welcome` or `http://localhost:3000/api/v1/email/previews/expense_added`.

* **Render Plaintext Version**:
  ```http
  GET /api/v1/email/previews/:templateKey?format=text
  ```

> [!NOTE]
> The preview endpoint is automatically disabled and returns `404 Not Found` in production (`NODE_ENV === 'production'`).

---

## 4. Environment Configuration

Configure email delivery and branding parameters in `.env.local` or environment variables:

```bash
# Email Provider
# Options: "smtp" | "local-outbox" (local-outbox captures messages in memory; rejected in production)
EMAIL_PROVIDER="smtp"
EMAIL_FROM="Artha Security <no-reply@artha.app>"

# Branding & URLs
APP_NAME="Artha"
APP_URL="https://artha.app"
SUPPORT_EMAIL="aartha.app@gmail.com"
EMAIL_LOGO_URL="https://raw.githubusercontent.com/13vanshmehta/Artha-App/main/src/assets/branding/artha_icon_blue.png"

# SMTP Settings (Gmail, AWS SES, SendGrid, Resend SMTP, or Mailgun)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-specific-password"
```

---

## 5. How to Add a New Email Template

1. **Define the Data Interface**: In `src/email/email.types.ts`, define `YourNewEmailData` and register it in `EmailTemplateMap`:
   ```ts
   export interface YourNewEmailData {
     displayName: string;
     customField: string;
   }
   ```
2. **Implement the Renderer**: In `src/email/email-templates.ts`:
   ```ts
   export function renderYourNewTemplate(data: YourNewEmailData, config: EmailSystemConfig): RenderedEmail {
     const subject = 'Your Subject';
     const preheader = 'Short snippet preview text';
     const contentHtml = `...`;
     const text = `...`;
     const html = renderEmailLayout({ title: subject, preheader, contentHtml, config });
     return { subject, preheader, html, text };
   }
   ```
3. **Register in `EmailRendererService`**: Add a case in `render()` and sample mock data in `getSamplePreviewData()`.
4. **Add Dispatcher in `MailService`**: Add a typed method in `src/auth/mail.service.ts` to call `this.renderer.render(...)` and `this.deliver(...)`.
5. **Add Automated Unit Tests**: Add assertions in `src/email/email.spec.ts`.

---

## 6. Testing & Safe Delivery

* **Unit Testing**: Run `npm test` to verify all 12 templates render HTML, plain text, and escaped inputs without hitting external networks.
* **Test Outbox**: In `NODE_ENV === 'test'` or `EMAIL_PROVIDER === 'local-outbox'`, messages are routed to an in-memory queue. Automated tests inspect `mailService.getLatestTestOutboxMessage(email, kind)` to verify delivery without sending live emails.
* **Production Safety**: Secrets such as OTP codes and reset tokens are only stored in `testOnlySecret` in non-production modes and are never logged or exposed in production headers or templates.
