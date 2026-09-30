import {
  renderCtaButton,
  renderDetailsTable,
  renderEmailHeading,
  renderInfoPanel,
  renderOtpBox,
} from './email.components';
import { renderEmailLayout } from './email.layout';
import {
  AccountDeletedEmailData,
  EmailChangedEmailData,
  EmailSystemConfig,
  ExpenseAddedEmailData,
  ExpenseReminderEmailData,
  GroupInvitationEmailData,
  NewSignInEmailData,
  PasswordChangedEmailData,
  PasswordResetEmailData,
  RenderedEmail,
  SettlementRecordedEmailData,
  VerificationConfirmedEmailData,
  VerificationOtpEmailData,
  WelcomeEmailData,
} from './email.types';
import { escapeHtml, formatEmailCurrency, formatEmailDate } from './email.utils';

export function renderWelcomeTemplate(
  data: WelcomeEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = "Welcome to Artha — let's get started!";
  const preheader =
    'Start understanding, tracking, and growing your finances today.';
  const exploreUrl = data.exploreUrl || config.appUrl;

  const contentHtml = `
    ${renderEmailHeading(
      `Welcome, ${data.displayName}!`,
      'Your journey to financial clarity starts here.',
    )}
    <p style="margin: 0 0 16px 0;">
      Thank you for creating an account with <strong>${escapeHtml(config.appName)}</strong>. We designed Artha to help you track spending effortlessly, understand where your money goes, and make confident financial decisions.
    </p>
    <p style="margin: 0 0 16px 0;">
      Here is what you can do right away:
    </p>
    <ul style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.6; color: #475569;">
      <li style="margin-bottom: 8px;"><strong>Track Expenses:</strong> Categorize daily spending with clean visual analytics.</li>
      <li style="margin-bottom: 8px;"><strong>Collaborate Seamlessly:</strong> Split expenses with friends, family, or housemates without spreadsheet headaches.</li>
      <li style="margin-bottom: 8px;"><strong>Protect Your Data:</strong> Enjoy secure sessions, optional device biometric lock, and end-to-end privacy.</li>
    </ul>

    ${renderCtaButton('Explore Artha', exploreUrl)}

    ${renderInfoPanel(
      'Tip: You can enable Biometric or PIN unlock in Account Settings to keep Artha private on this device.',
      'info',
    )}
  `;

  const text = [
    `Welcome to Artha, ${data.displayName}!`,
    '',
    'Your journey to financial clarity starts here. We designed Artha to help you track spending effortlessly, understand where your money goes, and make confident financial decisions.',
    '',
    'Key features:',
    '- Track Expenses: Categorize daily spending with clean visual analytics.',
    '- Collaborate Seamlessly: Split group expenses with friends and housemates.',
    '- Protect Your Data: Secure sessions with optional biometric app lock.',
    '',
    `Open Artha: ${exploreUrl}`,
    '',
    `Need help? Contact our support team at ${config.supportEmail}.`,
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderVerificationOtpTemplate(
  data: VerificationOtpEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'Your Artha verification code';
  const preheader = `${data.otp} is your Artha verification code. Expires in ${data.expiresInMinutes} minutes.`;

  const contentHtml = `
    ${renderEmailHeading(
      'Verify your email address',
      'Please enter this code in the Artha app to complete your sign-up.',
    )}
    <p style="margin: 0 0 8px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      Use the following single-use verification code to confirm your email address and activate your Artha workspace:
    </p>

    ${renderOtpBox(
      data.otp,
      `Valid for ${data.expiresInMinutes} minutes. Never share this code with anyone.`,
    )}

    ${renderInfoPanel(
      'If you did not request this verification code or create an Artha account, you can safely disregard this email.',
      'security',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    `Your Artha verification code is: ${data.otp}`,
    `This single-use code expires in ${data.expiresInMinutes} minutes.`,
    '',
    'Enter this code in the Artha app to verify your account.',
    'Never share this code with anyone. Artha representatives will never ask for your code.',
    '',
    'If you did not create an Artha account, you can safely ignore this email.',
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderVerificationConfirmedTemplate(
  data: VerificationConfirmedEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'Your Artha email is verified';
  const preheader = 'Your email address has been verified. Welcome to Artha!';
  const appUrl = data.appUrl || config.appUrl;

  const contentHtml = `
    ${renderEmailHeading(
      'Email verified successfully',
      'Your email address is now confirmed.',
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      Your email address <strong>${escapeHtml(data.email)}</strong> has been verified. Your Artha account is fully active and ready to use.
    </p>

    ${renderCtaButton('Open Artha', appUrl)}

    ${renderInfoPanel(
      'Your account is secured with rotating session tokens. You can also configure Biometric or PIN unlock in Account Settings.',
      'success',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    `Your email address (${data.email}) has been successfully verified.`,
    'Your Artha account is fully active.',
    '',
    `Open Artha: ${appUrl}`,
    '',
    'Thank you for choosing Artha.',
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderPasswordResetTemplate(
  data: PasswordResetEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'Reset your Artha password';
  const preheader = `Reset token expires in ${data.expiresInMinutes} minutes.`;
  const resetUrl = data.resetUrl;

  const contentHtml = `
    ${renderEmailHeading(
      'Reset your password',
      'We received a request to reset your Artha password.',
    )}
    <p style="margin: 0 0 8px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      We received a request to reset the password for your Artha account. Use the secure single-use token below in the Artha app to choose a new password:
    </p>

    ${renderOtpBox(
      data.resetToken,
      `Expires in ${data.expiresInMinutes} minutes. Single-use only.`,
    )}

    ${
      resetUrl
        ? `<div style="text-align: center; margin: 16px 0 24px 0;">
             <p style="font-size: 13px; color: #64748B; margin-bottom: 8px;">Or click the button below to continue:</p>
             ${renderCtaButton('Reset Password', resetUrl)}
           </div>`
        : ''
    }

    ${renderInfoPanel(
      'If you did not request a password reset, you can safely ignore this email. Your current password remains secure and unchanged.',
      'security',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    'We received a request to reset your Artha account password.',
    `Your single-use password reset token is: ${data.resetToken}`,
    `This token expires in ${data.expiresInMinutes} minutes.`,
    '',
    resetUrl ? `Or visit: ${resetUrl}\n\n` : '',
    'If you did not request a password reset, no action is needed. Your password remains unchanged.',
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderPasswordChangedTemplate(
  data: PasswordChangedEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'Your Artha password was changed';
  const preheader = 'Your account password has been updated.';
  const dateStr = data.changedAt ? formatEmailDate(data.changedAt) : 'Just now';

  const contentHtml = `
    ${renderEmailHeading(
      'Password updated',
      'Your account security credentials were changed.',
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      Your Artha account password was successfully updated on <strong>${escapeHtml(dateStr)}</strong>.
    </p>
    <p style="margin: 0 0 16px 0;">
      For your security, all active sessions and signed-in devices have been logged out. You can now log back in using your new password.
    </p>

    ${renderInfoPanel(
      `If you did not make this change, please contact Artha Support immediately at ${config.supportEmail} to secure your account.`,
      'warning',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    `Your Artha account password was successfully changed (${dateStr}).`,
    'All existing sessions have been signed out for your protection.',
    '',
    `If you did not make this change, contact Artha Support immediately at ${config.supportEmail}.`,
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderNewSignInTemplate(
  data: NewSignInEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'New sign-in to your Artha account';
  const preheader = 'A new device signed in to your Artha account.';
  const dateStr = data.signedInAt
    ? formatEmailDate(data.signedInAt)
    : formatEmailDate(new Date());

  const rows = [
    { label: 'Time (UTC)', value: dateStr },
    { label: 'Device / Client', value: data.deviceName || 'Mobile App' },
    { label: 'Platform', value: data.platform || 'Unknown' },
    ...(data.ipAddress ? [{ label: 'IP Address', value: data.ipAddress }] : []),
  ];

  const contentHtml = `
    ${renderEmailHeading(
      'New sign-in detected',
      'We noticed a new login to your Artha account.',
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      Your Artha account was recently signed into from a new device or session.
    </p>

    ${renderDetailsTable(rows)}

    <p style="margin: 16px 0 0 0; font-size: 14px; color: #475569;">
      If this was you, no action is required.
    </p>

    ${renderInfoPanel(
      `If you do not recognize this activity, please change your password immediately and review active sessions in Account Settings, or email ${config.supportEmail}.`,
      'security',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    'A new sign-in was detected on your Artha account:',
    `- Time: ${dateStr}`,
    `- Device: ${data.deviceName || 'Mobile App'}`,
    `- Platform: ${data.platform || 'Unknown'}`,
    ...(data.ipAddress ? [`- IP Address: ${data.ipAddress}`] : []),
    '',
    `If this was not you, change your password immediately and contact ${config.supportEmail}.`,
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderEmailChangedTemplate(
  data: EmailChangedEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'Your Artha email address was changed';
  const preheader = 'Your account email address has been updated.';
  const dateStr = data.changedAt
    ? formatEmailDate(data.changedAt)
    : formatEmailDate(new Date());

  const rows = [
    { label: 'Previous Email', value: data.oldEmail },
    { label: 'New Email', value: data.newEmail, isBold: true },
    { label: 'Date & Time', value: dateStr },
  ];

  const contentHtml = `
    ${renderEmailHeading(
      'Email address updated',
      'Your primary login email address was changed.',
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      The email address associated with your Artha account was recently changed.
    </p>

    ${renderDetailsTable(rows)}

    ${renderInfoPanel(
      `If you did not request this change, please contact ${config.supportEmail} immediately to secure your account and restore access.`,
      'warning',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    'Your Artha account email address was changed.',
    `- Previous Email: ${data.oldEmail}`,
    `- New Email: ${data.newEmail}`,
    `- Date: ${dateStr}`,
    '',
    `If you did not authorize this, contact ${config.supportEmail} immediately.`,
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderGroupInvitationTemplate(
  data: GroupInvitationEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = "You've been invited to an Artha expense group";
  const preheader = `${data.inviterName} invited you to join "${data.groupName}" on Artha.`;
  const inviteUrl = data.inviteUrl || config.appUrl;

  const rows = [
    { label: 'Group Name', value: data.groupName, isBold: true },
    { label: 'Invited By', value: data.inviterName },
    { label: 'Assigned Role', value: data.role || 'Member' },
    ...(data.expiresInDays
      ? [{ label: 'Invitation Validity', value: `${data.expiresInDays} days` }]
      : []),
  ];

  const contentHtml = `
    ${renderEmailHeading(
      'Group Expense Invitation',
      `${data.inviterName} invited you to collaborate on Artha.`,
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      You have been invited to join the expense group <strong>${escapeHtml(data.groupName)}</strong>. On Artha, group members can record shared expenses, track balances in real-time, and settle up easily.
    </p>

    ${renderDetailsTable(rows)}

    ${renderCtaButton('View Invitation', inviteUrl)}

    <p style="font-size: 13px; color: #64748B; margin: 16px 0 0 0;">
      If you already have the Artha app installed on iOS or Android, opening this link will launch the app directly.
    </p>
  `;

  const text = [
    `Hi ${data.recipientName},`,
    '',
    `${data.inviterName} invited you to join the expense group "${data.groupName}" on Artha.`,
    `- Group Name: ${data.groupName}`,
    `- Invited By: ${data.inviterName}`,
    `- Role: ${data.role || 'Member'}`,
    '',
    `Open invitation: ${inviteUrl}`,
    '',
    'On Artha, group members can record shared expenses, view balances, and settle up easily.',
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderExpenseAddedTemplate(
  data: ExpenseAddedEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const formattedAmount = formatEmailCurrency(data.amount, data.currency);
  const subject = 'A new expense was added to your Artha group';
  const preheader = `${data.addedByName} added ${data.merchant} (${formattedAmount}) in ${data.groupName}.`;
  const viewUrl = data.viewUrl || config.appUrl;

  const rows = [
    { label: 'Group', value: data.groupName },
    { label: 'Merchant', value: data.merchant, isBold: true },
    { label: 'Category', value: data.category },
    { label: 'Total Amount', value: formattedAmount, isBold: true },
    { label: 'Paid By', value: data.addedByName },
    ...(data.splitShareAmount !== undefined
      ? [
          {
            label: 'Your Share',
            value: formatEmailCurrency(data.splitShareAmount, data.currency),
            isBold: true,
          },
        ]
      : []),
    ...(data.notes ? [{ label: 'Notes', value: data.notes }] : []),
  ];

  const contentHtml = `
    ${renderEmailHeading(
      'New Group Expense',
      `Recorded in ${data.groupName}`,
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      <strong>${escapeHtml(data.addedByName)}</strong> added a new expense to <strong>${escapeHtml(data.groupName)}</strong>.
    </p>

    ${renderDetailsTable(rows)}

    ${renderCtaButton('View Expense', viewUrl)}
  `;

  const text = [
    `Hi ${data.recipientName},`,
    '',
    `A new expense was added in "${data.groupName}" by ${data.addedByName}:`,
    `- Merchant: ${data.merchant}`,
    `- Category: ${data.category}`,
    `- Total Amount: ${formattedAmount}`,
    ...(data.splitShareAmount !== undefined
      ? [
          `- Your Share: ${formatEmailCurrency(data.splitShareAmount, data.currency)}`,
        ]
      : []),
    ...(data.notes ? [`- Notes: ${data.notes}`] : []),
    '',
    `View in Artha: ${viewUrl}`,
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderSettlementRecordedTemplate(
  data: SettlementRecordedEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const formattedAmount = formatEmailCurrency(data.amount, data.currency);
  const subject = 'Your Artha expense settlement is updated';
  const preheader = `A settlement of ${formattedAmount} has been recorded in Artha.`;
  const viewUrl = data.viewUrl || config.appUrl;

  const rows = [
    { label: 'Amount', value: formattedAmount, isBold: true },
    { label: 'Status', value: data.status },
    ...(data.groupName ? [{ label: 'Group', value: data.groupName }] : []),
    ...(data.payerName ? [{ label: 'Paid By', value: data.payerName }] : []),
    ...(data.payeeName ? [{ label: 'Paid To', value: data.payeeName }] : []),
  ];

  const contentHtml = `
    ${renderEmailHeading(
      'Settlement Updated',
      'A settlement transaction was recorded.',
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      A shared expense settlement has been updated in Artha.
    </p>

    ${renderDetailsTable(rows)}

    ${renderCtaButton('View Settlement', viewUrl)}

    ${renderInfoPanel(
      'Note: This is an internal expense tracking record recorded within Artha. It does not represent an automated bank transfer.',
      'info',
    )}
  `;

  const text = [
    `Hi ${data.recipientName},`,
    '',
    'A settlement has been recorded in Artha:',
    `- Amount: ${formattedAmount}`,
    `- Status: ${data.status}`,
    ...(data.groupName ? [`- Group: ${data.groupName}`] : []),
    ...(data.payerName ? [`- Paid By: ${data.payerName}`] : []),
    ...(data.payeeName ? [`- Paid To: ${data.payeeName}`] : []),
    '',
    `View in Artha: ${viewUrl}`,
    '',
    'Note: This is an expense-tracking record logged in Artha and does not represent a direct bank transfer.',
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderExpenseReminderTemplate(
  data: ExpenseReminderEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const formattedAmount = formatEmailCurrency(
    data.outstandingAmount,
    data.currency,
  );
  const subject = 'A reminder about your shared expenses';
  const preheader = `You have an outstanding balance in ${data.groupName}.`;
  const viewUrl = data.viewUrl || config.appUrl;

  const rows = [
    { label: 'Group', value: data.groupName, isBold: true },
    { label: 'Outstanding Balance', value: formattedAmount, isBold: true },
  ];

  const contentHtml = `
    ${renderEmailHeading(
      'Expense Balance Reminder',
      `Shared balance for ${data.groupName}`,
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.recipientName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      This is a friendly reminder regarding your pending balance in <strong>${escapeHtml(data.groupName)}</strong>.
    </p>

    ${renderDetailsTable(rows)}

    ${renderCtaButton('Review Group Expenses', viewUrl)}

    <p style="font-size: 13px; color: #64748B; margin: 16px 0 0 0;">
      You can review transaction breakdowns and settle balances directly in Artha.
    </p>
  `;

  const text = [
    `Hi ${data.recipientName},`,
    '',
    `This is a friendly reminder regarding your pending balance in "${data.groupName}".`,
    `- Outstanding Balance: ${formattedAmount}`,
    '',
    `Review in Artha: ${viewUrl}`,
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}

export function renderAccountDeletedTemplate(
  data: AccountDeletedEmailData,
  config: EmailSystemConfig,
): RenderedEmail {
  const subject = 'Your Artha account was closed';
  const preheader = 'Your account and personal data have been deleted.';
  const dateStr = data.effectiveDate
    ? formatEmailDate(data.effectiveDate)
    : formatEmailDate(new Date());

  const contentHtml = `
    ${renderEmailHeading(
      'Account Closed',
      'Your Artha account has been permanently deleted.',
    )}
    <p style="margin: 0 0 16px 0;">
      Hi ${escapeHtml(data.displayName)},
    </p>
    <p style="margin: 0 0 16px 0;">
      This email confirms that your Artha account was closed on <strong>${escapeHtml(dateStr)}</strong>.
    </p>
    <p style="margin: 0 0 16px 0;">
      In accordance with our data policy, your active sessions have been revoked and your personal data has been deleted from our systems.
    </p>

    ${renderInfoPanel(
      `If this was done in error or you have questions, please contact our support team at ${config.supportEmail}.`,
      'info',
    )}
  `;

  const text = [
    `Hi ${data.displayName},`,
    '',
    `Your Artha account was closed on ${dateStr}.`,
    'Your active sessions have been revoked and personal records removed.',
    '',
    `If you have questions, reach us at ${config.supportEmail}.`,
    '',
    'Thank you for using Artha.',
  ].join('\n');

  const html = renderEmailLayout({
    title: subject,
    preheader,
    contentHtml,
    config,
  });

  return { subject, preheader, html, text };
}
