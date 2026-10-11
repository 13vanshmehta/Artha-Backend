import { EMAIL_DESIGN_TOKENS } from './email.tokens';
import { escapeHtml } from './email.utils';

const tokens = EMAIL_DESIGN_TOKENS;

/**
 * Standard title and subtitle for inside the email card.
 */
export function renderEmailHeading(title: string, subtitle?: string): string {
  return `
    <h1 style="margin: 0 0 ${subtitle ? '8px' : '20px'} 0; font-size: 22px; font-weight: 700; color: ${tokens.colors.primaryNavy}; line-height: 1.3; letter-spacing: -0.2px;">
      ${escapeHtml(title)}
    </h1>
    ${
      subtitle
        ? `<p style="margin: 0 0 24px 0; font-size: 14px; color: ${tokens.colors.textSecondary}; line-height: 1.5;">${escapeHtml(subtitle)}</p>`
        : ''
    }
  `;
}

/**
 * Clean, prominent CTA button.
 */
export function renderCtaButton(label: string, url: string): string {
  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
      <tr>
        <td align="center" style="border-radius: ${tokens.dimensions.borderRadiusButton}; background-color: ${tokens.colors.primaryNavy};">
          <a href="${escapeHtml(url)}" target="_blank" style="display: inline-block; padding: 13px 28px; font-size: 14px; font-weight: 600; color: ${tokens.colors.textInverse}; text-decoration: none; border-radius: ${tokens.dimensions.borderRadiusButton}; line-height: 1.2;">
            ${escapeHtml(label)} &rarr;
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Clean, minimalist OTP verification box.
 */
export function renderOtpBox(code: string, expiryNote?: string): string {
  return `
    <div style="margin: 28px 0; text-align: center;">
      <div style="display: inline-block; background-color: ${tokens.colors.lightBlueSurface}; border: 1px solid ${tokens.colors.infoBorder}; border-radius: 8px; padding: 18px 36px;">
        <span style="font-family: ${tokens.typography.codeFontFamily}; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: ${tokens.colors.primaryNavy}; display: inline-block;">
          ${escapeHtml(code)}
        </span>
      </div>
      ${
        expiryNote
          ? `<p style="margin: 10px 0 0 0; font-size: 13px; color: ${tokens.colors.textSecondary};">${escapeHtml(expiryNote)}</p>`
          : ''
      }
    </div>
  `;
}

/**
 * Clean information, security, or warning panel.
 */
export function renderInfoPanel(
  content: string,
  variant: 'info' | 'security' | 'warning' | 'success' = 'info',
): string {
  let bgColor: string = tokens.colors.infoSurface;
  let borderColor: string = tokens.colors.infoBorder;
  let textColor: string = tokens.colors.textPrimary;
  let label = 'Note:';

  if (variant === 'security') {
    bgColor = tokens.colors.infoSurface;
    borderColor = tokens.colors.infoBorder;
    textColor = tokens.colors.primaryNavy;
    label = 'Security Notice:';
  } else if (variant === 'warning') {
    bgColor = tokens.colors.warningSurface;
    borderColor = tokens.colors.warningBorder;
    textColor = tokens.colors.warning;
    label = 'Important:';
  } else if (variant === 'success') {
    bgColor = tokens.colors.successSurface;
    borderColor = tokens.colors.successBorder;
    textColor = tokens.colors.success;
    label = 'Confirmed:';
  }

  return `
    <div style="background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 6px; padding: 14px 16px; margin: 24px 0; font-size: 13px; line-height: 1.5; color: ${textColor};">
      <strong>${label}</strong> ${escapeHtml(content)}
    </div>
  `;
}

/**
 * Clean key-value details table for expense records, device details, or dates.
 */
export function renderDetailsTable(
  rows: { label: string; value: string; isBold?: boolean }[],
): string {
  const renderedRows = rows
    .map(
      (r, idx) => `
      <tr style="border-bottom: ${idx < rows.length - 1 ? `1px solid ${tokens.colors.divider}` : 'none'};">
        <td style="padding: 10px 0; font-size: 13px; color: ${tokens.colors.textSecondary}; vertical-align: top; width: 40%;">
          ${escapeHtml(r.label)}
        </td>
        <td style="padding: 10px 0; font-size: 13px; color: ${tokens.colors.textPrimary}; font-weight: ${r.isBold ? '600' : '400'}; text-align: right; vertical-align: top; width: 60%;">
          ${escapeHtml(r.value)}
        </td>
      </tr>
    `,
    )
    .join('');

  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FBFDFF; border: 1px solid ${tokens.colors.border}; border-radius: 8px; padding: 6px 16px; margin: 20px 0;">
      ${renderedRows}
    </table>
  `;
}

/**
 * Subtle divider.
 */
export function renderDivider(): string {
  return `<hr style="border: 0; border-top: 1px solid ${tokens.colors.divider}; margin: 24px 0;" />`;
}
