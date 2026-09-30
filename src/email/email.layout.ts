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
        padding: 24px 20px !important;
      }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${tokens.colors.emailBackground};font-family:${tokens.typography.fontFamily};">
  <!-- Preheader text for inbox snippet -->
  <div style="display:none;font-size:1px;color:${tokens.colors.emailBackground};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${tokens.colors.emailBackground};">
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
                    <div style="font-size: 20px; font-weight: 700; color: ${tokens.colors.primaryNavy}; letter-spacing: -0.3px;">
                      ${appName}
                    </div>
                    <div style="font-size: 11px; font-weight: 500; color: ${tokens.colors.textSecondary}; letter-spacing: 0.8px; text-transform: uppercase; margin-top: 2px;">
                      ${tagline}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td style="background-color:${tokens.colors.cardBackground};border-radius:${tokens.dimensions.borderRadiusCard};border:1px solid ${tokens.colors.border};box-shadow: 0 1px 3px rgba(16,42,86,0.04);overflow:hidden;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td class="card-body" style="padding: 36px 32px; color:${tokens.colors.textPrimary};font-size:15px;line-height:1.6;">
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 24px; padding-bottom: 12px; font-size: 12px; line-height: 1.6; color: ${tokens.colors.textSecondary};">
              <p style="margin: 0 0 6px 0;">
                This is a secure transactional message from <strong>${appName}</strong>.
              </p>
              <p style="margin: 0 0 8px 0;">
                Need assistance? Reach our team at <a href="mailto:${supportEmail}" style="color:${tokens.colors.secondaryBlue};text-decoration:none;font-weight:500;">${supportEmail}</a>.
              </p>
              <p style="margin: 0; color: ${tokens.colors.textMuted}; font-size: 11px;">
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
