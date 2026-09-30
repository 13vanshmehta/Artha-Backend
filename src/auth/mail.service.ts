import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { ValidatedEnvConfig } from '../config/env.validation';
import { EmailRendererService } from '../email/email-renderer.service';
import {
  AccountDeletedEmailData,
  EmailChangedEmailData,
  ExpenseAddedEmailData,
  ExpenseReminderEmailData,
  GroupInvitationEmailData,
  NewSignInEmailData,
  PasswordChangedEmailData,
  PasswordResetEmailData,
  SettlementRecordedEmailData,
  VerificationConfirmedEmailData,
  VerificationOtpEmailData,
  WelcomeEmailData,
} from '../email/email.types';

export type MailKind =
  | 'OTP_VERIFICATION'
  | 'PASSWORD_RESET'
  | 'PASSWORD_RESET_CONFIRMATION'
  | 'WELCOME'
  | 'EMAIL_VERIFIED_CONFIRMATION'
  | 'NEW_SIGN_IN'
  | 'EMAIL_CHANGED'
  | 'GROUP_INVITATION'
  | 'EXPENSE_ADDED'
  | 'SETTLEMENT_RECORDED'
  | 'EXPENSE_REMINDER'
  | 'ACCOUNT_DELETED';

export interface OutboxMailMessage {
  to: string;
  subject: string;
  kind: MailKind;
  sentAt: Date;
  html?: string;
  text?: string;
  /**
   * Populated ONLY in isolated non-production test/local-outbox mode
   * so automated tests can read the generated OTP or reset token without
   * ever returning secrets in API responses or logs.
   */
  testOnlySecret?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly localOutbox: OutboxMailMessage[] = [];

  constructor(
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
    private readonly renderer: EmailRendererService,
  ) {
    const provider = this.configService.get('EMAIL_PROVIDER', { infer: true });
    const smtpUser = this.configService.get('SMTP_USER', { infer: true });
    const smtpPass = this.configService.get('SMTP_PASS', { infer: true });
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });

    if (provider === 'smtp' && smtpUser && smtpPass && nodeEnv !== 'test') {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get('SMTP_HOST', { infer: true }),
        port: this.configService.get('SMTP_PORT', { infer: true }),
        secure: this.configService.get('SMTP_SECURE', { infer: true }),
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    }
  }

  async sendVerificationOtpEmail(
    params: { to: string } & VerificationOtpEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('verification_otp', {
      displayName: params.displayName,
      otp: params.otp,
      expiresInMinutes: params.expiresInMinutes,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'OTP_VERIFICATION',
      secretForTestOutbox: params.otp,
    });
  }

  async sendPasswordResetEmail(
    params: { to: string } & PasswordResetEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('password_reset', {
      displayName: params.displayName,
      resetToken: params.resetToken,
      expiresInMinutes: params.expiresInMinutes,
      resetUrl: params.resetUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'PASSWORD_RESET',
      secretForTestOutbox: params.resetToken,
    });
  }

  async sendPasswordResetCompletedEmail(
    params: { to: string } & PasswordChangedEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('password_changed', {
      displayName: params.displayName,
      changedAt: params.changedAt,
      securityUrl: params.securityUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'PASSWORD_RESET_CONFIRMATION',
    });
  }

  async sendWelcomeEmail(
    params: { to: string } & WelcomeEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('welcome', {
      displayName: params.displayName,
      email: params.email,
      exploreUrl: params.exploreUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'WELCOME',
    });
  }

  async sendEmailVerificationConfirmedEmail(
    params: { to: string } & VerificationConfirmedEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('verification_confirmed', {
      displayName: params.displayName,
      email: params.email,
      appUrl: params.appUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'EMAIL_VERIFIED_CONFIRMATION',
    });
  }

  async sendNewSignInEmail(
    params: { to: string } & NewSignInEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('new_sign_in', {
      displayName: params.displayName,
      deviceName: params.deviceName,
      platform: params.platform,
      ipAddress: params.ipAddress,
      signedInAt: params.signedInAt,
      securityUrl: params.securityUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'NEW_SIGN_IN',
    });
  }

  async sendEmailChangedEmail(
    params: { to: string } & EmailChangedEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('email_changed', {
      displayName: params.displayName,
      oldEmail: params.oldEmail,
      newEmail: params.newEmail,
      changedAt: params.changedAt,
      securityUrl: params.securityUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'EMAIL_CHANGED',
    });
  }

  async sendGroupInvitationEmail(
    params: { to: string } & GroupInvitationEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('group_invitation', {
      recipientName: params.recipientName,
      inviterName: params.inviterName,
      groupName: params.groupName,
      role: params.role,
      inviteUrl: params.inviteUrl,
      expiresInDays: params.expiresInDays,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'GROUP_INVITATION',
    });
  }

  async sendExpenseAddedEmail(
    params: { to: string } & ExpenseAddedEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('expense_added', {
      recipientName: params.recipientName,
      groupName: params.groupName,
      addedByName: params.addedByName,
      merchant: params.merchant,
      category: params.category,
      amount: params.amount,
      currency: params.currency,
      splitShareAmount: params.splitShareAmount,
      notes: params.notes,
      viewUrl: params.viewUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'EXPENSE_ADDED',
    });
  }

  async sendSettlementRecordedEmail(
    params: { to: string } & SettlementRecordedEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('settlement_recorded', {
      recipientName: params.recipientName,
      groupName: params.groupName,
      amount: params.amount,
      currency: params.currency,
      status: params.status,
      payerName: params.payerName,
      payeeName: params.payeeName,
      viewUrl: params.viewUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'SETTLEMENT_RECORDED',
    });
  }

  async sendExpenseReminderEmail(
    params: { to: string } & ExpenseReminderEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('expense_reminder', {
      recipientName: params.recipientName,
      groupName: params.groupName,
      outstandingAmount: params.outstandingAmount,
      currency: params.currency,
      viewUrl: params.viewUrl,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'EXPENSE_REMINDER',
    });
  }

  async sendAccountDeletedEmail(
    params: { to: string } & AccountDeletedEmailData,
  ): Promise<void> {
    const rendered = this.renderer.render('account_deleted', {
      displayName: params.displayName,
      effectiveDate: params.effectiveDate,
      supportEmail: params.supportEmail,
    });

    await this.deliver({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'ACCOUNT_DELETED',
    });
  }

  private async deliver(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
    kind: MailKind;
    secretForTestOutbox?: string;
  }): Promise<void> {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    const from = this.configService.get('EMAIL_FROM', { infer: true });

    if (nodeEnv !== 'production') {
      if (this.localOutbox.length >= 200) {
        this.localOutbox.shift();
      }
      this.localOutbox.push({
        to: params.to.toLowerCase(),
        subject: params.subject,
        kind: params.kind,
        sentAt: new Date(),
        html: params.html,
        text: params.text,
        testOnlySecret: params.secretForTestOutbox,
      });
    }

    if (this.transporter && nodeEnv !== 'test') {
      try {
        await this.transporter.sendMail({
          from,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        });
        return;
      } catch {
        if (nodeEnv === 'production') {
          throw new Error('Transactional email delivery failed.');
        }
        this.logger.warn(
          `SMTP delivery failed in ${nodeEnv} mode; message stored in local outbox (kind=${params.kind}).`,
        );
      }
    }
  }

  getLatestTestOutboxMessage(
    email: string,
    kind?: MailKind,
  ): OutboxMailMessage | undefined {
    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new Error('Test outbox is strictly disabled in production.');
    }
    const normalized = email.trim().toLowerCase();
    for (let i = this.localOutbox.length - 1; i >= 0; i--) {
      const msg = this.localOutbox[i];
      if (msg.to === normalized && (!kind || msg.kind === kind)) {
        return msg;
      }
    }
    return undefined;
  }

  clearTestOutbox(): void {
    this.localOutbox.length = 0;
  }
}
