require('dotenv').config();
const express = require('express');
const { Resend } = require('resend');

const app = express();

// JSON com limite maior (caso você mande HTML grande ou payload maior no futuro)
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

// Resend client (reutiliza)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Pode ser apenas um email (ex: onboarding@resend.dev) OU "Nome <email>".
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
// Se RESEND_FROM for apenas email, este nome será usado no "display name".
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || 'Cicero Nascimento - ROTAS';

// Branding padrão (pode sobrescrever via payload.emailBranding)
const BRAND_PRIMARY = process.env.BRAND_PRIMARY || '#111111';
const BRAND_SECONDARY = process.env.BRAND_SECONDARY || '#F2C200';
const BRAND_LOGO_URL = process.env.BRAND_LOGO_URL || '';

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildFromHeader() {
  const from = String(RESEND_FROM || '').trim();
  // Se já vier no formato "Nome <email>", respeita.
  if (from.includes('<') && from.includes('>')) return from;
  // Caso contrário, aplica o nome.
  return `${RESEND_FROM_NAME} <${from || 'onboarding@resend.dev'}>`;
}

function renderReportEmailHtml(payload) {
  const senderName = payload?.emailBranding?.senderDisplayName || RESEND_FROM_NAME;
  const primary = payload?.emailBranding?.primaryColorHex || BRAND_PRIMARY;
  const secondary = payload?.emailBranding?.secondaryColorHex || BRAND_SECONDARY;
  const logoUrl = payload?.emailBranding?.logoUrl || BRAND_LOGO_URL;
  const logoBase64Png = payload?.emailBranding?.logoBase64Png || null;

  const exportedBy = payload?.export?.exportedBy?.operatorName || payload?.exportedBy || 'Não informado';
  const generatedAt = payload?.generatedAt || '';
  const pdfUrl = payload?.export?.pdfUrl || payload?.pdfUrl || '';

  // Resumo (lista)
  const summaryLines = [];
  if (payload?.route?.routeName) summaryLines.push(`Rota: ${payload.route.routeName}`);
  if (payload?.route?.unit) summaryLines.push(`Unidade: ${payload.route.unit}`);
  if (payload?.route?.shift) summaryLines.push(`Turno: ${payload.route.shift}`);

  const okPercent = payload?.checklists?.okPercent;
  if (typeof okPercent === 'number') summaryLines.push(`Checklist OK: ${okPercent}%`);

  const openPend = payload?.status?.openPendencies;
  const closedPend = payload?.status?.closedPendencies;
  if (typeof openPend === 'number' && typeof closedPend === 'number') {
    summaryLines.push(`Pendências: ${openPend} abertas / ${closedPend} fechadas`);
  }

  const openIssues = payload?.status?.openIssues;
  const closedIssues = payload?.status?.closedIssues;
  if (typeof openIssues === 'number' && typeof closedIssues === 'number') {
    summaryLines.push(`Ocorrências: ${openIssues} abertas / ${closedIssues} fechadas`);
  }

  const topOcc = Array.isArray(payload?.topOccurrences) ? payload.topOccurrences.slice(0, 3) : [];

  const summaryHtml = summaryLines.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">
        ${summaryLines.map((li) => `<li style="margin:4px 0;">${escapeHtml(li)}</li>`).join('')}
      </ul>`
    : `<div style="color:#555; margin-top:8px;">Sem resumo disponível.</div>`;

  const topOccHtml = topOcc.length
    ? `<div style="margin-top:12px;">
         <div style="font-weight:700; margin-bottom:6px;">Top 3 ocorrências</div>
         <ol style="margin:0; padding-left:18px;">
           ${topOcc
             .map(
               (o) => `<li style="margin:6px 0;">
                 <b>${escapeHtml(o.title || 'Ocorrência')}</b>
                 ${o.details ? `<div style="color:#555;">${escapeHtml(o.details)}</div>` : ''}
               </li>`,
             )
             .join('')}
         </ol>
       </div>`
    : '';

  const pdfButton = pdfUrl
    ? `<a href="${pdfUrl}" style="display:inline-block; background:${primary}; color:#fff; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:700;">
         Abrir/baixar PDF
       </a>`
    : `<div style="color:#a00; font-weight:700;">PDF ainda não disponível (upload pendente)</div>`;

  const logoSrc = logoBase64Png ? `data:image/png;base64,${logoBase64Png}` : logoUrl;

  return `
  <div style="font-family: Arial, sans-serif; background:#f6f7f9; padding:24px;">
    <div style="max-width:680px; margin:0 auto; background:#fff; border-radius:14px; overflow:hidden; border:1px solid #e7e7e7;">
      <div style="padding:18px 18px 10px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          ${logoSrc ? `<img src="${logoSrc}" alt="Logo" style="height:30px; display:block;" />` : ''}
          <div>
            <div style="font-size:14px; color:#555;">${escapeHtml(senderName)}</div>
            <div style="font-size:18px; font-weight:800;">Relatório ROTAS</div>
          </div>
        </div>
        <div style="font-size:12px; color:#777; text-align:right;">
          ${generatedAt ? escapeHtml(generatedAt) : ''}
        </div>
      </div>

      <div style="height:4px; background:${secondary};"></div>

      <div style="padding:18px;">
        <div style="color:#333;">
          Exportado por <b>${escapeHtml(exportedBy)}</b>.
        </div>

        <div style="margin-top:14px; padding:12px; background:#fafafa; border:1px solid #eee; border-radius:12px;">
          <div style="font-weight:800;">Resumo</div>
          ${summaryHtml}
          ${topOccHtml}
        </div>

        <div style="margin-top:16px;">
          ${pdfButton}
        </div>

        <div style="margin-top:14px; font-size:12px; color:#777;">
          Envio automático do ROTAS (fim de turno e exportações manuais).
        </div>
      </div>
    </div>
  </div>
  `.trim();
}

function renderReportEmailText(payload) {
  const exportedBy = payload?.export?.exportedBy?.operatorName || payload?.exportedBy || 'Não informado';
  const pdfUrl = payload?.export?.pdfUrl || payload?.pdfUrl || '(ainda não disponível)';
  const okPercent = payload?.checklists?.okPercent;
  const unit = payload?.route?.unit;
  const shift = payload?.route?.shift;

  const lines = ['Relatório ROTAS', `Exportado por: ${exportedBy}`];
  if (unit) lines.push(`Unidade: ${unit}`);
  if (shift) lines.push(`Turno: ${shift}`);
  if (typeof okPercent === 'number') lines.push(`Checklist OK: ${okPercent}%`);
  lines.push(`PDF: ${pdfUrl}`);
  return lines.join('\n');
}

app.get('/', (req, res) => {
  res.status(200).send('Servidor de email via API funcionando.');
});

// health check (bom para ping/keep-alive)
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/send-email', async (req, res) => {
  try {
    if (!RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: 'RESEND_API_KEY não configurada.' });
    }

    const { to, subject, message, html } = req.body || {};

    const recipients = asArray(to);

    if (!recipients.length) {
      return res.status(400).json({ ok: false, error: 'Campo obrigatório: to (string ou array).' });
    }
    if (!subject || String(subject).trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Campo obrigatório: subject.' });
    }
    if ((!message || String(message).trim().length === 0) && (!html || String(html).trim().length === 0)) {
      return res.status(400).json({ ok: false, error: 'Obrigatório: message (texto) ou html.' });
    }

    const resend = new Resend(RESEND_API_KEY);

    // Normaliza strings (ajuda a evitar caracteres “quebrados”)
    const safeSubject = String(subject).normalize('NFC');
    const safeText = message ? String(message).normalize('NFC') : undefined;
    const safeHtml = html ? String(html).normalize('NFC') : undefined;

    const payload = {
      from: buildFromHeader(),
      to: recipients,
      subject: safeSubject,
      text: safeText,
      html: safeHtml,
    };

    const response = await resend.emails.send(payload);

    return res.status(200).json({
      ok: true,
      sentTo: recipients.length,
      data: response,
    });
  } catch (error) {
    // Resend costuma retornar erro estruturado às vezes
    const msg = error?.message || String(error);
    console.error('Erro /send-email:', msg, error);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ✅ Endpoint novo: recebe o JSON do relatório (resumo + link do PDF) e envia e-mail com layout
// O app deve chamar este endpoint quando exportar o PDF manualmente e no fim do turno.
app.post('/api/reports/notify', async (req, res) => {
  try {
    if (!RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: 'RESEND_API_KEY não configurada.' });
    }

    const body = req.body || {};
    const recipients = asArray(body.to || process.env.REPORTS_TO_EMAIL);

    if (!recipients.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Informe "to" no body ou defina REPORTS_TO_EMAIL no ambiente.' });
    }

    // Logs mínimos para confirmar que o backend está lendo o resumo
    console.log('[REPORT_NOTIFY] eventType:', body?.eventType);
    console.log('[REPORT_NOTIFY] exportedBy:', body?.export?.exportedBy?.operatorName || body?.exportedBy);
    console.log('[REPORT_NOTIFY] pdfUrl:', body?.export?.pdfUrl || body?.pdfUrl);

    const unit = body?.route?.unit || 'Unidade';
    const shift = body?.route?.shift || 'Turno';
    const subject = body?.subject
      ? String(body.subject).normalize('NFC')
      : `Relatório ROTAS • ${String(unit).normalize('NFC')} • ${String(shift).normalize('NFC')}`;

    const resend = new Resend(RESEND_API_KEY);
    const html = renderReportEmailHtml(body).normalize('NFC');
    const text = renderReportEmailText(body).normalize('NFC');

    const response = await resend.emails.send({
      from: buildFromHeader(),
      to: recipients,
      subject,
      html,
      text,
    });

    return res.status(200).json({ ok: true, sentTo: recipients.length, data: response });
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('Erro /api/reports/notify:', msg, error);
    return res.status(500).json({ ok: false, error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});