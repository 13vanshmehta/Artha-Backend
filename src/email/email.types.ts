/**
 * Artha Email System Type Definitions
 */

export interface EmailSystemConfig {
  appName: string;
  appUrl: string;
  supportEmail: string;
  logoUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export interface WelcomeEmailData {
  displayName: string;
  email: string;
  exploreUrl?: string;
}

export interface VerificationOtpEmailData {
  displayName: string;
  otp: string;
  expiresInMinutes: number;
}

export interface VerificationConfirmedEmailData {
  displayName: string;
  email: string;
  appUrl?: string;
}

export interface PasswordResetEmailData {
  displayName: string;
  resetToken: string;
  expiresInMinutes: number;
  resetUrl?: string;
}

export interface PasswordChangedEmailData {
  displayName: string;
  changedAt?: Date | string;
  securityUrl?: string;
}

export interface NewSignInEmailData {
  displayName: string;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  signedInAt?: Date | string;
  securityUrl?: string;
}

export interface EmailChangedEmailData {
  displayName: string;
  oldEmail: string;
  newEmail: string;
  changedAt?: Date | string;
  securityUrl?: string;
}

export interface GroupInvitationEmailData {
  recipientName: string;
  inviterName: string;
  groupName: string;
  role?: string;
  inviteUrl?: string;
  expiresInDays?: number;
}

export interface ExpenseAddedEmailData {
  recipientName: string;
  groupName: string;
  addedByName: string;
  merchant: string;
  category: string;
  amount: number;
  currency?: string;
  splitShareAmount?: number;
  notes?: string;
  viewUrl?: string;
}

export interface SettlementRecordedEmailData {
  recipientName: string;
  groupName?: string;
  amount: number;
  currency?: string;
  status: 'RECORDED' | 'PENDING' | 'COMPLETED';
  payerName?: string;
  payeeName?: string;
  viewUrl?: string;
}

export interface ExpenseReminderEmailData {
  recipientName: string;
  groupName: string;
  outstandingAmount: number;
  currency?: string;
  viewUrl?: string;
}

export interface AccountDeletedEmailData {
  displayName: string;
  effectiveDate?: Date | string;
  supportEmail?: string;
}

export type EmailTemplateMap = {
  welcome: WelcomeEmailData;
  verification_otp: VerificationOtpEmailData;
  verification_confirmed: VerificationConfirmedEmailData;
  password_reset: PasswordResetEmailData;
  password_changed: PasswordChangedEmailData;
  new_sign_in: NewSignInEmailData;
  email_changed: EmailChangedEmailData;
  group_invitation: GroupInvitationEmailData;
  expense_added: ExpenseAddedEmailData;
  settlement_recorded: SettlementRecordedEmailData;
  expense_reminder: ExpenseReminderEmailData;
  account_deleted: AccountDeletedEmailData;
};

export type EmailTemplateKey = keyof EmailTemplateMap;
