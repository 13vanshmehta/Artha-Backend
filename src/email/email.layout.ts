import { EMAIL_DESIGN_TOKENS } from './email.tokens';
import { EmailSystemConfig } from './email.types';
import { escapeHtml } from './email.utils';

export interface EmailLayoutOptions {
  title: string;
  preheader: string;
  contentHtml: string;
  config: EmailSystemConfig;
}

export function renderEmailLayout(options: EmailLayoutOptions): string {
  const { title, preheader, contentHtml, config } = options;
  const tokens = EMAIL_DESIGN_TOKENS;

  const appName = escapeHtml(config.appName || tokens.branding.appName);
  const tagline = escapeHtml(tokens.branding.tagline);
  const supportEmail = escapeHtml(
    config.supportEmail || tokens.branding.defaultSupportEmail,
  );
  const logoUrl = config.logoUrl || tokens.branding.defaultLogoUrl;
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(title)}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
      background-color: ${tokens.colors.emailBackground};
    }
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
        max-width: 100% !important;
      }
      .card-body {
        padding: 28px 20px !important;
      }
      .details-table td {
        padding-left: 14px !important;
        padding-right: 14px !important;
      }
    }
    /* Lock the design to the light palette — prevents Gmail/Outlook/Apple Mail
       "smart" dark mode from re-coloring individual elements and breaking the
       layout (borders/dividers surviving while backgrounds invert). */
    :root {
      color-scheme: light;
      supported-color-schemes: light;
    }
    [data-ogsc] .bg-page,
    [data-ogsb] .bg-page {
      background-color: ${tokens.colors.emailBackground} !important;
    }
    [data-ogsc] .bg-card,
    [data-ogsb] .bg-card {
      background-color: ${tokens.colors.cardBackground} !important;
      border-color: ${tokens.colors.border} !important;
    }
    [data-ogsc] .bg-surface,
    [data-ogsb] .bg-surface {
      background-color: #FBFDFF !important;
      border-color: ${tokens.colors.border} !important;
    }
    [data-ogsc] .hairline,
    [data-ogsb] .hairline {
      border-color: ${tokens.colors.divider} !important;
    }
    [data-ogsc] .bg-navy,
    [data-ogsb] .bg-navy {
      background-color: ${tokens.colors.primaryNavy} !important;
    }
    [data-ogsc] .bg-otp,
    [data-ogsb] .bg-otp {
      background-color: ${tokens.colors.lightBlueSurface} !important;
      border-color: ${tokens.colors.infoBorder} !important;
    }
    [data-ogsc] .bg-panel-info,
    [data-ogsb] .bg-panel-info {
      background-color: ${tokens.colors.infoSurface} !important;
      border-color: ${tokens.colors.infoBorder} !important;
    }
    [data-ogsc] .bg-panel-warning,
    [data-ogsb] .bg-panel-warning {
      background-color: ${tokens.colors.warningSurface} !important;
      border-color: ${tokens.colors.warningBorder} !important;
    }
    [data-ogsc] .bg-panel-success,
    [data-ogsb] .bg-panel-success {
      background-color: ${tokens.colors.successSurface} !important;
      border-color: ${tokens.colors.successBorder} !important;
    }
    [data-ogsc] .text-navy { color: ${tokens.colors.primaryNavy} !important; }
    [data-ogsc] .text-primary { color: ${tokens.colors.textPrimary} !important; }
    [data-ogsc] .text-secondary { color: ${tokens.colors.textSecondary} !important; }
    [data-ogsc] .text-muted { color: ${tokens.colors.textMuted} !important; }
    [data-ogsc] .text-inverse { color: ${tokens.colors.textInverse} !important; }
    [data-ogsc] .text-warning { color: ${tokens.colors.warning} !important; }
    [data-ogsc] .text-success { color: ${tokens.colors.success} !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${tokens.colors.emailBackground};font-family:${tokens.typography.fontFamily};">
  <!-- Preheader text for inbox snippet -->
  <div style="display:none;font-size:1px;color:${tokens.colors.emailBackground};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="bg-page" style="background-color:${tokens.colors.emailBackground};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container" style="max-width:${tokens.dimensions.containerMaxWidth};margin:0 auto;">
          <!-- Header with Logo & Brand -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="vertical-align:middle;">
                    ${
                      logoUrl
                        ? `<img src="${escapeHtml(logoUrl)}" alt="${appName}" width="34" height="34" style="display:block;border-radius:8px;margin-bottom:8px;" />`
                        : ''
                    }
                    <div class="text-navy" style="font-size: 20px; font-weight: 700; color: ${tokens.colors.primaryNavy}; letter-spacing: -0.3px;">
                      ${appName}
                    </div>
                    <div class="text-secondary" style="font-size: 11px; font-weight: 500; color: ${tokens.colors.textSecondary}; letter-spacing: 0.8px; text-transform: uppercase; margin-top: 2px;">
                      ${tagline}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td class="bg-card" style="background-color:${tokens.colors.cardBackground};border-radius:${tokens.dimensions.borderRadiusCard};border:1px solid ${tokens.colors.border};box-shadow: 0 1px 3px rgba(16,42,86,0.04);overflow:hidden;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td class="card-body text-primary" style="padding: 36px 32px; color:${tokens.colors.textPrimary};font-size:15px;line-height:1.6;">
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" class="text-secondary" style="padding-top: 24px; padding-bottom: 12px; font-size: 12px; line-height: 1.6; color: ${tokens.colors.textSecondary};">
              <p style="margin: 0 0 6px 0;">
                This is a secure transactional message from <strong>${appName}</strong>.
              </p>
              <p style="margin: 0 0 8px 0;">
                Need assistance? Reach our team at <a href="mailto:${supportEmail}" style="color:${tokens.colors.secondaryBlue};text-decoration:none;font-weight:500;">${supportEmail}</a>.
              </p>
              <p class="text-muted" style="margin: 0; color: ${tokens.colors.textMuted}; font-size: 11px;">
                &copy; ${currentYear} ${appName}. Know. Spend. Grow. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
