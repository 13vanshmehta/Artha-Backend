import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvConfig } from '../config/env.validation';
import {
  renderAccountDeletedTemplate,
  renderEmailChangedTemplate,
  renderExpenseAddedTemplate,
  renderExpenseReminderTemplate,
  renderGroupInvitationTemplate,
  renderNewSignInTemplate,
  renderPasswordChangedTemplate,
  renderPasswordResetTemplate,
  renderSettlementRecordedTemplate,
  renderVerificationConfirmedTemplate,
  renderVerificationOtpTemplate,
  renderWelcomeTemplate,
} from './email-templates';
import { EMAIL_DESIGN_TOKENS } from './email.tokens';
import {
  EmailSystemConfig,
  EmailTemplateKey,
  EmailTemplateMap,
  RenderedEmail,
} from './email.types';

@Injectable()
export class EmailRendererService {
  private readonly config: EmailSystemConfig;

  constructor(
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
  ) {
    const tokens = EMAIL_DESIGN_TOKENS;
    this.config = {
      appName:
        (this.configService.get('APP_NAME' as unknown as keyof ValidatedEnvConfig) as string) ||
        tokens.branding.appName,
      appUrl:
        (this.configService.get('APP_URL' as unknown as keyof ValidatedEnvConfig) as string) ||
        tokens.branding.defaultAppUrl,
      supportEmail:
        (this.configService.get(
          'SUPPORT_EMAIL' as unknown as keyof ValidatedEnvConfig,
        ) as string) || tokens.branding.defaultSupportEmail,
      logoUrl:
        (this.configService.get(
          'EMAIL_LOGO_URL' as unknown as keyof ValidatedEnvConfig,
        ) as string) || tokens.branding.defaultLogoUrl,
    };
  }

  getConfig(): EmailSystemConfig {
    return { ...this.config };
  }

  render<K extends EmailTemplateKey>(
    templateKey: K,
    data: EmailTemplateMap[K],
  ): RenderedEmail {
    switch (templateKey) {
      case 'welcome':
        return renderWelcomeTemplate(data as EmailTemplateMap['welcome'], this.config);
      case 'verification_otp':
        return renderVerificationOtpTemplate(
          data as EmailTemplateMap['verification_otp'],
          this.config,
        );
      case 'verification_confirmed':
        return renderVerificationConfirmedTemplate(
          data as EmailTemplateMap['verification_confirmed'],
          this.config,
        );
      case 'password_reset':
        return renderPasswordResetTemplate(
          data as EmailTemplateMap['password_reset'],
          this.config,
        );
      case 'password_changed':
        return renderPasswordChangedTemplate(
          data as EmailTemplateMap['password_changed'],
          this.config,
        );
      case 'new_sign_in':
        return renderNewSignInTemplate(
          data as EmailTemplateMap['new_sign_in'],
          this.config,
        );
      case 'email_changed':
        return renderEmailChangedTemplate(
          data as EmailTemplateMap['email_changed'],
          this.config,
        );
      case 'group_invitation':
        return renderGroupInvitationTemplate(
          data as EmailTemplateMap['group_invitation'],
          this.config,
        );
      case 'expense_added':
        return renderExpenseAddedTemplate(
          data as EmailTemplateMap['expense_added'],
          this.config,
        );
      case 'settlement_recorded':
        return renderSettlementRecordedTemplate(
          data as EmailTemplateMap['settlement_recorded'],
          this.config,
        );
      case 'expense_reminder':
        return renderExpenseReminderTemplate(
          data as EmailTemplateMap['expense_reminder'],
          this.config,
        );
      case 'account_deleted':
        return renderAccountDeletedTemplate(
          data as EmailTemplateMap['account_deleted'],
          this.config,
        );
      default:
        throw new Error(`Unknown email template: ${String(templateKey)}`);
    }
  }

  /**
   * Provides representative, realistic mock preview data for developers to test
   * and view all templates locally without sending real emails.
   */
  getSamplePreviewData<K extends EmailTemplateKey>(
    templateKey: K,
  ): EmailTemplateMap[K] {
    const samples: EmailTemplateMap = {
      welcome: {
        displayName: 'Priya Sharma',
        email: 'priya.sharma@example.com',
        exploreUrl: 'https://artha.app/app',
      },
      verification_otp: {
        displayName: 'Priya Sharma',
        otp: '482910',
        expiresInMinutes: 10,
      },
      verification_confirmed: {
        displayName: 'Priya Sharma',
        email: 'priya.sharma@example.com',
        appUrl: 'https://artha.app/app',
      },
      password_reset: {
        displayName: 'Priya Sharma',
        resetToken: '931084',
        expiresInMinutes: 30,
        resetUrl: 'https://artha.app/reset-password?token=931084',
      },
      password_changed: {
        displayName: 'Priya Sharma',
        changedAt: new Date(),
        securityUrl: 'https://artha.app/settings/security',
      },
      new_sign_in: {
        displayName: 'Priya Sharma',
        deviceName: 'iPhone 15 Pro',
        platform: 'iOS 18.2',
        ipAddress: '103.21.124.89',
        signedInAt: new Date(),
        securityUrl: 'https://artha.app/settings/security',
      },
      email_changed: {
        displayName: 'Priya Sharma',
        oldEmail: 'priya.old@example.com',
        newEmail: 'priya.sharma@example.com',
        changedAt: new Date(),
      },
      group_invitation: {
        recipientName: 'Aarav Patel',
        inviterName: 'Priya Sharma',
        groupName: 'Goa Trip 2026',
        role: 'Member',
        inviteUrl: 'https://artha.app/groups/goa-2026',
        expiresInDays: 7,
      },
      expense_added: {
        recipientName: 'Aarav Patel',
        groupName: 'Goa Trip 2026',
        addedByName: 'Priya Sharma',
        merchant: 'Fisherman’s Wharf Restaurant',
        category: 'Food & Dining',
        amount: 3450,
        currency: 'INR',
        splitShareAmount: 862.5,
        notes: 'Seafood dinner with team drinks',
        viewUrl: 'https://artha.app/expenses/rec_12345',
      },
      settlement_recorded: {
        recipientName: 'Aarav Patel',
        groupName: 'Flat 402 Expenses',
        amount: 1500,
        currency: 'INR',
        status: 'RECORDED',
        payerName: 'Aarav Patel',
        payeeName: 'Rohan Verma',
        viewUrl: 'https://artha.app/groups/flat-402',
      },
      expense_reminder: {
        recipientName: 'Aarav Patel',
        groupName: 'Flat 402 Expenses',
        outstandingAmount: 2400,
        currency: 'INR',
        viewUrl: 'https://artha.app/groups/flat-402',
      },
      account_deleted: {
        displayName: 'Priya Sharma',
        effectiveDate: new Date(),
        supportEmail: 'aartha.app@gmail.com',
      },
    };

    return samples[templateKey];
  }

  getAllTemplateKeys(): EmailTemplateKey[] {
    return [
      'welcome',
      'verification_otp',
      'verification_confirmed',
      'password_reset',
      'password_changed',
      'new_sign_in',
      'email_changed',
      'group_invitation',
      'expense_added',
      'settlement_recorded',
      'expense_reminder',
      'account_deleted',
    ];
  }
}
