import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { ValidatedEnvConfig } from '../config/env.validation';

export interface OutboxMailMessage {
  to: string;
  subject: string;
  kind: 'OTP_VERIFICATION' | 'PASSWORD_RESET' | 'PASSWORD_RESET_CONFIRMATION';
  sentAt: Date;
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

  async sendVerificationOtpEmail(params: {
    to: string;
    displayName: string;
    otp: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = 'Verify your Artha account';
    const text = [
      `Hi ${params.displayName},`,
      '',
      `Your Artha verification code is: ${params.otp}`,
      `This single-use code expires in ${params.expiresInMinutes} minutes.`,
      '',
      'If you did not create an Artha account, you can safely ignore this email.',
    ].join('\n');

    await this.deliver({
      to: params.to,
      subject,
      text,
      kind: 'OTP_VERIFICATION',
      secretForTestOutbox: params.otp,
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    displayName: string;
    resetToken: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = 'Reset your Artha password';
    const text = [
      `Hi ${params.displayName},`,
      '',
      'We received a request to reset your Artha password.',
      `Enter the following password reset token in the Artha app: ${params.resetToken}`,
      `This token expires in ${params.expiresInMinutes} minutes and can only be used once.`,
      '',
      'If you did not request a password reset, no action is needed.',
    ].join('\n');

    await this.deliver({
      to: params.to,
      subject,
      text,
      kind: 'PASSWORD_RESET',
      secretForTestOutbox: params.resetToken,
    });
  }

  async sendPasswordResetCompletedEmail(params: {
    to: string;
    displayName: string;
  }): Promise<void> {
    const subject = 'Your Artha password was changed';
    const text = [
      `Hi ${params.displayName},`,
      '',
      'Your Artha account password was recently changed and all existing sessions have been signed out for your protection.',
      'If you did not perform this change, please contact Artha Security immediately.',
    ].join('\n');

    await this.deliver({
      to: params.to,
      subject,
      text,
      kind: 'PASSWORD_RESET_CONFIRMATION',
    });
  }

  private async deliver(params: {
    to: string;
    subject: string;
    text: string;
    kind: OutboxMailMessage['kind'];
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
        testOnlySecret: params.secretForTestOutbox,
      });
    }

    if (this.transporter && nodeEnv !== 'test') {
      try {
        await this.transporter.sendMail({
          from,
          to: params.to,
          subject: params.subject,
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
    kind?: OutboxMailMessage['kind'],
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
