import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../auth/mail.service';
import { ValidatedEnvConfig } from '../config/env.validation';
import { EmailPreviewController } from './email-preview.controller';
import { EmailRendererService } from './email-renderer.service';
import { EMAIL_DESIGN_TOKENS } from './email.tokens';
import { EmailTemplateKey } from './email.types';
import { escapeHtml, formatEmailCurrency, formatEmailDate } from './email.utils';

describe('Artha Transactional Email System (Unit)', () => {
  let configService: ConfigService<ValidatedEnvConfig, true>;
  let rendererService: EmailRendererService;
  let previewController: EmailPreviewController;
  let mailService: MailService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          NODE_ENV: 'test',
          APP_NAME: 'Artha',
          APP_URL: 'https://artha.app',
          SUPPORT_EMAIL: 'aartha.app@gmail.com',
          EMAIL_LOGO_URL: 'https://artha.app/assets/logo.png',
          EMAIL_PROVIDER: 'local-outbox',
          EMAIL_FROM: 'Artha Security <aartha.app@gmail.com>',
        };
        return map[key];
      }),
    } as unknown as ConfigService<ValidatedEnvConfig, true>;

    rendererService = new EmailRendererService(configService);
    previewController = new EmailPreviewController(rendererService, configService);
    mailService = new MailService(configService, rendererService);
  });

  describe('1. Brand Identity & Design Tokens', () => {
    it('defines the core Artha navy and light blue palette', () => {
      expect(EMAIL_DESIGN_TOKENS.colors.primaryNavy).toBe('#102A56');
      expect(EMAIL_DESIGN_TOKENS.colors.secondaryBlue).toBe('#2878D4');
      expect(EMAIL_DESIGN_TOKENS.colors.lightBlueSurface).toBe('#EAF4FF');
      expect(EMAIL_DESIGN_TOKENS.branding.appName).toBe('Artha');
      expect(EMAIL_DESIGN_TOKENS.branding.tagline).toBe('Know. Spend. Grow.');
    });

    it('formats currencies accurately with Indian Rupee defaults and unicode symbols', () => {
      expect(formatEmailCurrency(1250, 'INR')).toBe('₹1,250.00');
      expect(formatEmailCurrency(45.5, 'USD')).toBe('$45.50');
      expect(formatEmailCurrency(99, 'EUR')).toBe('€99.00');
      expect(formatEmailCurrency(100.25, 'GBP')).toBe('£100.25');
      expect(formatEmailCurrency(500, 'SGD')).toBe('SGD 500.00');
    });

    it('formats dates consistently in UTC', () => {
      const fixedDate = new Date('2026-09-30T10:00:00.000Z');
      expect(formatEmailDate(fixedDate)).toContain('30 Sep 2026');
      expect(formatEmailDate('invalid-date')).toBe('');
    });
  });

  describe('2. Security: HTML Escaping & Injection Prevention', () => {
    it('escapes dangerous HTML characters in untrusted user inputs', () => {
      const raw = '<script>alert("XSS & danger")</script>';
      const safe = escapeHtml(raw);
      expect(safe).toBe(
        '&lt;script&gt;alert(&quot;XSS &amp; danger&quot;)&lt;/script&gt;',
      );
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('sanitizes user-supplied values in rendered templates', () => {
      const maliciousPayload = '<script>alert("steal")</script>';
      const rendered = rendererService.render('welcome', {
        displayName: maliciousPayload,
        email: 'attacker@evil.com',
      });

      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;alert');
    });
  });

  describe('3. Template Rendering: All 12 Email Types', () => {
    const allKeys: EmailTemplateKey[] = [
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

    it('successfully renders every template in the catalog with HTML and plain text', () => {
      for (const key of allKeys) {
        const sampleData = rendererService.getSamplePreviewData(key);
        const rendered = rendererService.render(key, sampleData);

        expect(rendered.subject).toBeTruthy();
        expect(rendered.preheader).toBeTruthy();
        expect(rendered.html).toContain('<!DOCTYPE html>');
        expect(rendered.html).toContain('Artha');
        expect(rendered.html).toContain('Know. Spend. Grow.');
        expect(rendered.text).toBeTruthy();
        expect(rendered.text.length).toBeGreaterThan(20);
      }
    });

    it('renders welcome email with onboarding guidance and explore link', () => {
      const rendered = rendererService.render('welcome', {
        displayName: 'Aarav',
        email: 'aarav@artha.app',
        exploreUrl: 'https://artha.app/explore',
      });
      expect(rendered.subject).toBe("Welcome to Artha — let's get started!");
      expect(rendered.html).toContain('Welcome, Aarav!');
      expect(rendered.html).toContain('https://artha.app/explore');
      expect(rendered.text).toContain('Welcome to Artha, Aarav!');
    });

    it('renders verification OTP email with prominent code badge and expiry notice', () => {
      const rendered = rendererService.render('verification_otp', {
        displayName: 'Priya',
        otp: '654321',
        expiresInMinutes: 10,
      });
      expect(rendered.subject).toBe('Your Artha verification code');
      expect(rendered.html).toContain('654321');
      expect(rendered.html).toContain('Valid for 10 minutes');
      expect(rendered.text).toContain('Your Artha verification code is: 654321');
    });

    it('renders password reset email without leaking secrets in the link', () => {
      const rendered = rendererService.render('password_reset', {
        displayName: 'Vansh',
        resetToken: 'rst_998877',
        expiresInMinutes: 30,
        resetUrl: 'https://artha.app/reset?token=rst_998877',
      });
      expect(rendered.subject).toBe('Reset your Artha password');
      expect(rendered.html).toContain('rst_998877');
      expect(rendered.html).toContain('Expires in 30 minutes');
      expect(rendered.text).toContain('rst_998877');
    });

    it('renders new sign-in security notification with device details', () => {
      const rendered = rendererService.render('new_sign_in', {
        displayName: 'Priya',
        deviceName: 'Pixel 9 Pro',
        platform: 'Android 15',
        ipAddress: '49.36.120.10',
      });
      expect(rendered.subject).toBe('New sign-in to your Artha account');
      expect(rendered.html).toContain('Pixel 9 Pro');
      expect(rendered.html).toContain('Android 15');
      expect(rendered.html).toContain('49.36.120.10');
      expect(rendered.text).toContain('Pixel 9 Pro');
    });

    it('renders group invitation email with inviter and group details', () => {
      const rendered = rendererService.render('group_invitation', {
        recipientName: 'Rohan',
        inviterName: 'Priya Sharma',
        groupName: 'Manali Vacation',
        role: 'Admin',
      });
      expect(rendered.subject).toBe("You've been invited to an Artha expense group");
      expect(rendered.html).toContain('Manali Vacation');
      expect(rendered.html).toContain('Priya Sharma');
      expect(rendered.text).toContain('Manali Vacation');
    });

    it('renders expense added email with currency and share details', () => {
      const rendered = rendererService.render('expense_added', {
        recipientName: 'Rohan',
        groupName: 'Manali Vacation',
        addedByName: 'Priya',
        merchant: 'Mountain Cafe',
        category: 'Food',
        amount: 2500,
        currency: 'INR',
        splitShareAmount: 625,
      });
      expect(rendered.subject).toBe('A new expense was added to your Artha group');
      expect(rendered.html).toContain('Mountain Cafe');
      expect(rendered.html).toContain('₹2,500.00');
      expect(rendered.html).toContain('₹625.00');
      expect(rendered.text).toContain('Mountain Cafe');
    });

    it('renders account deleted confirmation email', () => {
      const rendered = rendererService.render('account_deleted', {
        displayName: 'User A',
      });
      expect(rendered.subject).toBe('Your Artha account was closed');
      expect(rendered.html).toContain('permanently deleted');
      expect(rendered.text).toContain('Your Artha account was closed');
    });
  });

  describe('4. Developer Preview Controller', () => {
    it('lists all 12 templates in non-production environments', () => {
      const result = previewController.listPreviews();
      expect(result.templates.length).toBe(12);
      expect(result.templates[0]).toHaveProperty('key');
      expect(result.templates[0]).toHaveProperty('subject');
      expect(result.templates[0]).toHaveProperty('previewHtmlUrl');
    });

    it('renders individual HTML preview for a valid template key', () => {
      const html = previewController.renderPreview('welcome');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Welcome');
    });

    it('renders plaintext preview wrapped in <pre> when format=text', () => {
      const textOutput = previewController.renderPreview('welcome', 'text');
      expect(textOutput).toContain('<pre');
      expect(textOutput).toContain('Welcome to Artha');
    });

    it('throws 404 for nonexistent template keys', () => {
      expect(() =>
        previewController.renderPreview('non_existent_key'),
      ).toThrow(NotFoundException);
    });

    it('blocks preview endpoints in production mode', () => {
      const prodConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          return 'mock';
        }),
      } as unknown as ConfigService<ValidatedEnvConfig, true>;

      const prodController = new EmailPreviewController(
        rendererService,
        prodConfigService,
      );

      expect(() => prodController.listPreviews()).toThrow(NotFoundException);
      expect(() => prodController.renderPreview('welcome')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('5. MailService Delivery & Local Outbox Integration', () => {
    beforeEach(() => {
      mailService.clearTestOutbox();
    });

    it('records OTP verification message with HTML and text in local outbox', async () => {
      await mailService.sendVerificationOtpEmail({
        to: 'priya@artha.app',
        displayName: 'Priya Sharma',
        otp: '891023',
        expiresInMinutes: 10,
      });

      const message = mailService.getLatestTestOutboxMessage(
        'priya@artha.app',
        'OTP_VERIFICATION',
      );
      expect(message).toBeDefined();
      expect(message?.to).toBe('priya@artha.app');
      expect(message?.subject).toBe('Your Artha verification code');
      expect(message?.testOnlySecret).toBe('891023');
      expect(message?.html).toContain('891023');
      expect(message?.text).toContain('891023');
    });

    it('records Password Reset message with secret in local outbox', async () => {
      await mailService.sendPasswordResetEmail({
        to: 'user@artha.app',
        displayName: 'User',
        resetToken: 'reset_token_secret_123',
        expiresInMinutes: 30,
      });

      const message = mailService.getLatestTestOutboxMessage(
        'user@artha.app',
        'PASSWORD_RESET',
      );
      expect(message).toBeDefined();
      expect(message?.testOnlySecret).toBe('reset_token_secret_123');
      expect(message?.html).toContain('reset_token_secret_123');
      expect(message?.text).toContain('reset_token_secret_123');
    });

    it('records Welcome and Verification Confirmed emails', async () => {
      await mailService.sendEmailVerificationConfirmedEmail({
        to: 'newuser@artha.app',
        email: 'newuser@artha.app',
        displayName: 'New User',
      });
      await mailService.sendWelcomeEmail({
        to: 'newuser@artha.app',
        email: 'newuser@artha.app',
        displayName: 'New User',
      });

      const confirmMsg = mailService.getLatestTestOutboxMessage(
        'newuser@artha.app',
        'EMAIL_VERIFIED_CONFIRMATION',
      );
      expect(confirmMsg).toBeDefined();

      const welcomeMsg = mailService.getLatestTestOutboxMessage(
        'newuser@artha.app',
        'WELCOME',
      );
      expect(welcomeMsg).toBeDefined();
      expect(welcomeMsg?.subject).toBe("Welcome to Artha — let's get started!");
    });

    it('records Group Invitation and Expense Added emails', async () => {
      await mailService.sendGroupInvitationEmail({
        to: 'friend@artha.app',
        recipientName: 'Friend',
        inviterName: 'Host',
        groupName: 'Weekend Trip',
      });

      const inviteMsg = mailService.getLatestTestOutboxMessage(
        'friend@artha.app',
        'GROUP_INVITATION',
      );
      expect(inviteMsg).toBeDefined();
      expect(inviteMsg?.html).toContain('Weekend Trip');

      await mailService.sendExpenseAddedEmail({
        to: 'friend@artha.app',
        recipientName: 'Friend',
        groupName: 'Weekend Trip',
        addedByName: 'Host',
        merchant: 'Dinner Place',
        category: 'Food',
        amount: 1800,
        currency: 'INR',
      });

      const expenseMsg = mailService.getLatestTestOutboxMessage(
        'friend@artha.app',
        'EXPENSE_ADDED',
      );
      expect(expenseMsg).toBeDefined();
      expect(expenseMsg?.html).toContain('Dinner Place');
      expect(expenseMsg?.html).toContain('₹1,800.00');
    });
  });
});
